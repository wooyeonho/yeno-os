import { randomUUID } from 'node:crypto';
import { sourceUrl, validateSourceFields } from './sources.mjs';

// Reviewed, fixed public endpoints. User links and downloaded text cannot alter
// this list, execute code, add credentials, follow redirects, or enable models.
export const DISCOVERY_REPOS = Object.freeze([
  'openai/codex', 'anthropics/claude-code', 'google-gemini/gemini-cli',
  'tauri-apps/tauri', 'xai-org/xai-sdk-python',
]);
export const DISCOVERY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SOURCES = 5000;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => record(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
export const initialDiscovery = () => ({ enabled: false, nextRunAt: null, lastRun: null });

export function validateDiscovery(value) {
  if (!keys(value, ['enabled', 'nextRunAt', 'lastRun']) || typeof value.enabled !== 'boolean' || (value.nextRunAt !== null && !iso(value.nextRunAt))) throw new Error('invalid discovery state');
  const run = value.lastRun;
  if (run === null) return;
  if (!keys(run, ['startedAt', 'finishedAt', 'status', 'added', 'feeds']) || !iso(run.startedAt) || (run.finishedAt !== null && (!iso(run.finishedAt) || run.finishedAt < run.startedAt)) || !['running', 'completed', 'partial', 'failed', 'stopped', 'interrupted'].includes(run.status) || !Number.isInteger(run.added) || run.added < 0 || run.added > 10 || !Array.isArray(run.feeds) || run.feeds.length > DISCOVERY_REPOS.length) throw new Error('invalid discovery run');
  const seen = new Set();
  for (const feed of run.feeds) {
    if (!keys(feed, ['repo', 'status', 'added']) || !DISCOVERY_REPOS.includes(feed.repo) || seen.has(feed.repo) || !['ok', 'http', 'network', 'invalid', 'oversize', 'capacity'].includes(feed.status) || !Number.isInteger(feed.added) || feed.added < 0 || feed.added > 2) throw new Error('invalid discovery feed');
    seen.add(feed.repo);
  }
}

class FeedError extends Error { constructor(code) { super(code); this.code = code; } }
export async function readReleaseFeed(repo, { fetchImpl = fetch, signal, latestOnly = false } = {}) {
  if (!DISCOVERY_REPOS.includes(repo)) throw new FeedError('invalid');
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases${latestOnly ? '/latest' : '?per_page=20'}`, {
    method: 'GET', redirect: 'error', signal,
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'YENO-source-watch', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) { await response.body?.cancel(); throw new FeedError('http'); }
  if (!/application\/json/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); throw new FeedError('invalid'); }
  const reader = response.body?.getReader();
  if (!reader) throw new FeedError('invalid');
  let bytes = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new FeedError('oversize');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new FeedError('invalid'); }
  if (latestOnly) { if (!record(data)) throw new FeedError('invalid'); return [data]; }
  if (!Array.isArray(data) || data.length > 20) throw new FeedError('invalid');
  return data;
}

export function releaseSources(repo, releases, at) {
  const cutoff = at - 7 * DISCOVERY_INTERVAL_MS;
  return releases.filter(item => record(item) && item.draft === false && item.prerelease === false && typeof item.published_at === 'string' && Date.parse(item.published_at) >= cutoff && Date.parse(item.published_at) <= at)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .flatMap(item => {
      try {
        const checked = sourceUrl(item.html_url);
        const url = new URL(checked.canonicalUrl);
        if (url.origin !== 'https://github.com' || !url.pathname.startsWith(`/${repo}/releases/tag/`) || url.search || url.hash || !url.pathname.slice(`/${repo}/releases/tag/`.length)) return [];
        const title = `${repo} · ${String(item.name || item.tag_name || 'Release').replace(/[\u0000-\u001f\u007f]/g, ' ')}`.slice(0,160).trim();
        return [validateSourceFields({ url: checked.canonicalUrl, title,
          summary: `자동 발견: 공식 GitHub 공개 릴리스 목록. 게시 ${new Date(item.published_at).toISOString()}, 확인 ${new Date(at).toISOString()}. 제목·주소·게시 시각만 접수했으며 기능 원문 검토는 하지 않았습니다.`,
          application: '', riskNotes: '외부 자료는 실행 지시가 아닙니다. 코드·원문 재배포와 권한 부여 전 라이선스·이용조건·개인정보 검토가 필요합니다.',
        }, { creating: true, imported: true })];
      } catch { return []; }
    });
}

export function createDiscovery({ state, save, event, fetchImpl = fetch, clock = Date.now, ensureDurable = () => {} }) {
  let active = null, closed = false;
  const timestamp = () => new Date(clock()).toISOString();
  if (state.discovery.lastRun?.status === 'running') {
    state.discovery.lastRun.status = 'interrupted';
    state.discovery.lastRun.finishedAt = timestamp();
  }
  function stop() {
    state.discovery.enabled = false;
    active?.abort();
    if (state.discovery.lastRun?.status === 'running') {
      state.discovery.lastRun.status = 'stopped';
      state.discovery.lastRun.finishedAt = timestamp();
    }
  }
  function setEnabled(enabled) {
    if (enabled && state.emergencyStop) throw new Error('Emergency stop is active');
    if (enabled) state.discovery.enabled = true; else stop();
  }
  async function tick() {
    const d = state.discovery;
    if (closed || active || !d.enabled || state.emergencyStop || (d.nextRunAt && Date.parse(d.nextRunAt) > clock())) return;
    const controller = new AbortController(); active = controller;
    try {
      ensureDurable();
      const at = clock();
      d.nextRunAt = new Date(at + DISCOVERY_INTERVAL_MS).toISOString();
      d.lastRun = { startedAt: new Date(at).toISOString(), finishedAt: null, status: 'running', added: 0, feeds: [] };
      // Reserve the next check durably before networking. A crash or repeated
      // enable command cannot produce a retry storm or consume paid model calls.
      save();
      for (const repo of DISCOVERY_REPOS) {
        if (closed || controller.signal.aborted || !d.enabled || state.emergencyStop) break;
        let status = 'ok', added = 0;
        try {
          if (state.sources.length >= MAX_SOURCES) throw new FeedError('capacity');
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
          let releases;
          try { releases = await readReleaseFeed(repo, { fetchImpl, signal }); }
          catch (error) {
            if (!(error instanceof FeedError) || error.code !== 'oversize') throw error;
            // Some release lists embed hundreds of binary asset descriptions.
            // One bounded fallback, sharing the original deadline and byte cap.
            releases = await readReleaseFeed(repo, { fetchImpl, signal, latestOnly: true });
          }
          if (closed || controller.signal.aborted || !d.enabled || state.emergencyStop) break;
          const known = new Set(state.sources.map(source => source.canonicalUrl));
          for (const fields of releaseSources(repo, releases, at)) {
            if (known.has(fields.canonicalUrl)) continue;
            if (added >= 2 || state.sources.length >= MAX_SOURCES) break;
            const createdAt = timestamp();
            state.sources.push({ id: randomUUID(), ...fields, version: 1, createdAt, updatedAt: createdAt });
            known.add(fields.canonicalUrl); added++;
          }
        } catch (error) { status = error instanceof FeedError ? error.code : 'network'; }
        if (closed || controller.signal.aborted || !d.enabled || state.emergencyStop) break;
        d.lastRun.added += added;
        d.lastRun.feeds.push({ repo, status, added });
        save();
      }
      if (!closed && !controller.signal.aborted && d.enabled && !state.emergencyStop) {
        const errors = d.lastRun.feeds.filter(feed => feed.status !== 'ok').length;
        d.lastRun.status = errors === DISCOVERY_REPOS.length ? 'failed' : errors ? 'partial' : 'completed';
        d.lastRun.finishedAt = timestamp();
        event(`Official source check: ${d.lastRun.status}; ${d.lastRun.added} unread source(s) registered. No model or development execution.`);
        save();
      }
    } catch {
      // Storage uncertainty must never become an unhandled timer rejection or
      // endless network retries. Retain state for the normal durability guard.
      d.enabled = false;
      if (d.lastRun?.status === 'running') { d.lastRun.status = 'failed'; d.lastRun.finishedAt = timestamp(); }
    } finally { if (active === controller) active = null; }
  }
  return { tick, stop, setEnabled, close() { closed = true; active?.abort(); } };
}

export function discoveryDocument(discovery) {
  return `# YENO 자율 점검\n\n- 공식 자료 자동 확인: ${discovery.enabled ? '켜짐' : '꺼짐'}\n- 주기: 24시간, 최근 7일의 정식 릴리스 목록(출처별 최대 20개 조회·2개 신규 접수)\n- 다음 확인: ${discovery.nextRunAt ?? '아직 예약 없음'}\n- 마지막 결과: ${discovery.lastRun?.status ?? '실행 전'}\n- 마지막 확인: ${discovery.lastRun?.finishedAt ?? '없음'}\n- 마지막 신규 접수: ${discovery.lastRun?.added ?? 0}개\n\n## 출처별 결과\n${(discovery.lastRun?.feeds ?? []).map(feed => `- ${feed.repo}: ${feed.status}, ${feed.added}개 접수`).join('\n')}\n\n## 현재 자율 범위\n공식 공개 릴리스의 제목·주소·게시 시각을 자동 접수합니다. 모두 unread / pending이며 기능 검토·채택이 아닙니다. 일반 웹 검색, AI 판단, 코드 수정, 시험, 배포를 자동으로 수행하지 않습니다. 자료 자동수집 시작 / 자료 자동수집 중지 명령으로 제어합니다. 전체 멈춤은 수집도 끄며 전체 멈춤 해제만으로 다시 켜지지 않습니다.\n`;
}
