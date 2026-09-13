import { createServer } from "node:http";
import { addEvidence, activateSkill, addLedgerEntry, approveQuest, assessSkill, clearStop, completeRun, createProject, createQuest, extractSkill, proposeQuests, rankQuestCandidates, recordProviderChecks, requestStop, retryRun, startQuest, summarizeState } from "./core.js";
import { liveProviderChecks, providerStatuses } from "./providers.js";
import { openStore } from "./store.js";

const MAX_BODY_BYTES = 1_000_000;

const MOBILE_HTML = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Black Hole Control</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #090b12; color: #f2f4f8; }
    * { box-sizing: border-box; }
    body { margin: 0; background: radial-gradient(circle at 20% 0%, #252a49, #090b12 48%); min-height: 100vh; }
    main { max-width: 760px; margin: 0 auto; padding: 18px; }
    header { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    h1 { margin: 0; font-size: 1.35rem; letter-spacing: .02em; }
    .muted { color: #aab2c5; font-size: .87rem; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .card { background: rgba(18, 22, 36, .92); border: 1px solid #303750; border-radius: 16px; padding: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.18); }
    .metric { font-size: 1.5rem; font-weight: 700; margin-top: 4px; }
    .wide { grid-column: 1 / -1; }
    button, input { width: 100%; border: 1px solid #455070; border-radius: 10px; padding: 11px 12px; background: #13192a; color: #f2f4f8; }
    button { cursor: pointer; background: #4e65d8; border-color: #6e83ec; font-weight: 650; }
    button.danger { background: #8f2f4d; border-color: #c35c79; }
    button.secondary { background: #27304b; border-color: #4b587c; }
    .row { display: flex; gap: 8px; }
    .row > * { flex: 1; }
    pre { white-space: pre-wrap; word-break: break-word; color: #cbd4ec; font-size: .78rem; max-height: 300px; overflow: auto; }
    .status { display: inline-block; border-radius: 999px; padding: 3px 8px; font-size: .74rem; background: #27304b; }
    .ok { color: #9ce7bf; }
    .warn { color: #ffd48a; }
    @media (max-width: 480px) { .grid { grid-template-columns: 1fr; } .wide { grid-column: auto; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div><h1>◉ Black Hole</h1><div class="muted">퀘스트 · 증거 · 스킬 · 성장</div></div>
      <span id="mode" class="status">연결 중</span>
    </header>
    <section class="card" style="margin-bottom:10px">
      <label class="muted" for="token">원격 접속 토큰(설정한 경우)</label>
      <input id="token" type="password" autocomplete="off" placeholder="로컬 접속은 비워두세요" />
      <div class="row" style="margin-top:8px"><button class="secondary" onclick="refresh()">새로고침</button><button class="danger" onclick="stopAll()">전체 중단</button></div>
    </section>
    <section class="grid">
      <div class="card"><div class="muted">진행 중 실행</div><div id="running" class="metric">-</div></div>
      <div class="card"><div class="muted">활성 스킬</div><div id="skills" class="metric">-</div></div>
      <div class="card"><div class="muted">완료 퀘스트</div><div id="quests" class="metric">-</div></div>
      <div class="card"><div class="muted">기록 비용</div><div id="cost" class="metric">-</div></div>
      <div class="card wide"><div class="muted">현재 실행</div><pre id="current">불러오는 중…</pre></div>
      <div class="card wide"><div class="muted">다음 결정이 필요한 퀘스트</div><pre id="pending">불러오는 중…</pre></div>
      <div class="card wide"><div class="muted">공급자 상태</div><pre id="providers">불러오는 중…</pre></div>
    </section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const headers = () => { const token = $('token').value.trim(); return token ? { Authorization: 'Bearer ' + token } : {}; };
    async function get(path) { const r = await fetch(path, { headers: headers() }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
    async function refresh() {
      try {
        const [state, providers] = await Promise.all([get('/api/state'), get('/api/providers')]);
        $('mode').textContent = state.stopRequested ? '중단 요청됨' : '정상';
        $('mode').className = 'status ' + (state.stopRequested ? 'warn' : 'ok');
        $('running').textContent = state.counts.runningRuns;
        $('skills').textContent = state.counts.activeSkills;
        $('quests').textContent = state.metrics.completedQuests;
        $('cost').textContent = '$' + Number(state.metrics.totalCostUsd || 0).toFixed(4);
        $('current').textContent = state.currentRuns.length ? JSON.stringify(state.currentRuns, null, 2) : '현재 실행 없음';
        $('pending').textContent = state.pendingQuests.length ? JSON.stringify(state.pendingQuests, null, 2) : '대기 퀘스트 없음';
        $('providers').textContent = JSON.stringify(providers.map(p => ({ id: p.id, status: p.status, model: p.model })), null, 2);
      } catch (error) { $('mode').textContent = '확인 필요'; $('mode').className = 'status warn'; $('current').textContent = error.message; }
    }
    async function stopAll() { await fetch('/api/stop', { method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, body: '{}' }); await refresh(); }
    refresh(); setInterval(refresh, 5000);
  </script>
</body>
</html>`;

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function text(res, status, value, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  res.end(value);
}

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error("request body too large");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const body = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("request body must be valid JSON");
    error.code = "INVALID_JSON";
    throw error;
  }
}

function isLoopback(host) {
  return ["127.0.0.1", "localhost", "::1"].includes(host);
}

function authIsValid(req, accessToken, host) {
  if (isLoopback(host)) return true;
  if (!accessToken) return false;
  return req.headers.authorization === `Bearer ${accessToken}`;
}

function statusForError(error) {
  if (["INVALID_JSON", "BODY_TOO_LARGE", "INVALID_QUEST", "INVALID_GOAL_CONTRACT"].includes(error.code)) return 400;
  if (["APPROVAL_REQUIRED", "QUEST_BLOCKED", "SKILL_ACTIVATION_BLOCKED"].includes(error.code)) return 409;
  if (String(error.message || "").includes("not found")) return 404;
  return 500;
}

export async function createBlackHoleServer({ dataDir = process.env.BLACK_HOLE_DATA_DIR || "data", host = process.env.BLACK_HOLE_HOST || "127.0.0.1", accessToken = process.env.BLACK_HOLE_ACCESS_TOKEN || null } = {}) {
  if (!isLoopback(host) && (!accessToken || accessToken.length < 16)) {
    throw new Error("BLACK_HOLE_ACCESS_TOKEN with at least 16 characters is required for non-loopback access");
  }
  const store = await openStore(dataDir);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS" });
      return res.end();
    }
    if (url.pathname === "/" && req.method === "GET") return text(res, 200, MOBILE_HTML, "text/html; charset=utf-8");
    if (!url.pathname.startsWith("/api/")) return text(res, 404, "Not found");
    if (!authIsValid(req, accessToken, host)) return json(res, 401, { error: "unauthorized" });
    try {
      let match;
      if (url.pathname === "/api/health" && req.method === "GET") {
        return json(res, 200, { ok: true, system: store.snapshot().system, stopRequested: store.snapshot().runtime.stopRequested });
      }
      if (url.pathname === "/api/state" && req.method === "GET") return json(res, 200, summarizeState(store.snapshot()));
      if (url.pathname === "/api/providers" && req.method === "GET") return json(res, 200, providerStatuses());
      if (url.pathname === "/api/providers/check" && req.method === "POST") {
        const body = await readJson(req);
        const checks = await liveProviderChecks({ providerIds: body.providerIds });
        await store.transact("provider.checked", (state) => recordProviderChecks(state, checks));
        return json(res, 200, checks);
      }

      if (url.pathname === "/api/quests/propose" && req.method === "POST") {
        const body = await readJson(req);
        const candidates = rankQuestCandidates(proposeQuests(body), {
          evidenceStrength: Array.isArray(body.evidence) && body.evidence.length ? 0.5 : 0.1,
          budgetCeilingUsd: Number(body.budgetUsd) || 1,
          userDirected: Boolean(body.userDirected),
          expectedValue: body.expectedValue,
          reusability: body.reusability,
          assetFormation: body.assetFormation,
          interventionReduction: body.interventionReduction,
        });
        const saved = await store.transact("quest.proposed", (state) => {
          state.quests.push(...candidates);
          return candidates.map((quest) => quest.id);
        });
        return json(res, 201, { questIds: saved.result, candidates });
      }
      if (url.pathname === "/api/quests" && req.method === "POST") {
        const quest = createQuest(await readJson(req));
        await store.transact("quest.created", (state) => { state.quests.push(quest); return quest.id; });
        return json(res, 201, quest);
      }
      if (url.pathname === "/api/projects" && req.method === "POST") {
        const project = createProject(await readJson(req));
        await store.transact("project.registered", (state) => { state.projects.push(project); return project.id; });
        return json(res, 201, project);
      }
      match = url.pathname.match(/^\/api\/ledgers\/(wealth|honor|fame)$/);
      if (match && req.method === "POST") {
        const [, ledgerName] = match;
        const body = await readJson(req);
        const saved = await store.transact("ledger.entry_added", (state) => addLedgerEntry(state, ledgerName, body));
        return json(res, 201, saved.result);
      }

      match = url.pathname.match(/^\/api\/quests\/([^/]+)\/(approve|start)$/);
      if (match && req.method === "POST") {
        const [, questId, action] = match;
        const body = await readJson(req);
        const saved = await store.transact(`quest.${action}`, (state) => {
          if (action === "approve") return approveQuest(state, questId, body.approvedBy || "mobile_user");
          return startQuest(state, questId, { budgetAvailableUsd: body.budgetAvailableUsd, maxConcurrentRuns: body.maxConcurrentRuns });
        });
        return json(res, 200, saved.result);
      }
      match = url.pathname.match(/^\/api\/runs\/([^/]+)\/(evidence|complete|stop|retry)$/);
      if (match && req.method === "POST") {
        const [, runId, action] = match;
        const body = await readJson(req);
        const saved = await store.transact(`run.${action}`, (state) => {
          if (action === "evidence") return addEvidence(state, runId, body);
          if (action === "complete") return completeRun(state, runId, body);
          if (action === "stop") return requestStop(state, runId);
          clearStop(state);
          return retryRun(state, runId, { budgetAvailableUsd: body.budgetAvailableUsd, maxConcurrentRuns: body.maxConcurrentRuns });
        });
        return json(res, 200, saved.result);
      }
      if (url.pathname === "/api/stop" && req.method === "POST") {
        const saved = await store.transact("runtime.stop_requested", (state) => requestStop(state));
        return json(res, 200, { stopRequested: true, affectedRuns: saved.result });
      }
      if (url.pathname === "/api/resume" && req.method === "POST") {
        await store.transact("runtime.stop_cleared", (state) => clearStop(state));
        return json(res, 200, { stopRequested: false });
      }
      match = url.pathname.match(/^\/api\/skills\/([^/]+)\/(extract|activate|assess)$/);
      if (match && req.method === "POST") {
        const [, skillId, action] = match;
        const body = await readJson(req);
        const saved = await store.transact(`skill.${action}`, (state) => {
          if (action === "assess") {
            const skill = state.skills.find((candidate) => candidate.id === skillId);
            if (!skill) throw new Error(`Skill not found: ${skillId}`);
            return assessSkill(skill);
          }
          if (action === "activate") return activateSkill(state, skillId, body);
          return extractSkill(state, body.runId, body);
        });
        return json(res, 200, saved.result);
      }
      return json(res, 404, { error: "route not found" });
    } catch (error) {
      return json(res, statusForError(error), { error: error.message, code: error.code || "INTERNAL_ERROR", details: error.details || error.gate || undefined });
    }
  });
  return { server, store, host };
}

export async function startServer(options = {}) {
  const { server, store, host } = await createBlackHoleServer(options);
  const requestedPort = options.port ?? process.env.BLACK_HOLE_PORT ?? 8787;
  const port = Number(requestedPort);
  await new Promise((resolve) => server.listen(port, host, resolve));
  return { server, store, host, port: server.address()?.port || port };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().then(({ host, port }) => {
    console.log(`Black Hole listening on http://${host}:${port}`);
    console.log("Data and event log are persisted under BLACK_HOLE_DATA_DIR (default: data/).");
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
