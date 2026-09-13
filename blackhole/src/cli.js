#!/usr/bin/env node

import { addEvidence, activateSkill, addLedgerEntry, approveQuest, assessSkill, clearStop, completeRun, createProject, createQuest, extractSkill, proposeQuests, rankQuestCandidates, recordProviderChecks, requestStop, retryRun, startQuest, summarizeState } from "./core.js";
import { liveProviderChecks, providerStatuses } from "./providers.js";
import { openStore } from "./store.js";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const stripped = value.slice(2);
    const equalIndex = stripped.indexOf("=");
    if (equalIndex >= 0) {
      flags[stripped.slice(0, equalIndex)] = stripped.slice(equalIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[stripped] = next;
      index += 1;
    } else {
      flags[stripped] = true;
    }
  }
  return { positional, flags };
}

function flag(flags, name, fallback = undefined) {
  return Object.hasOwn(flags, name) ? flags[name] : fallback;
}

function boolFlag(flags, name) {
  return flag(flags, name, false) === true || String(flag(flags, name, "")).toLowerCase() === "true";
}

function numberFlag(flags, name, fallback) {
  const value = Number(flag(flags, name, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function help() {
  console.log(`Black Hole OS 0.1.0

Usage:
  npm run blackhole -- init
  npm run blackhole -- status
  npm run blackhole -- propose "검증할 고객 문제" [--budget 0] [--duration 60]
  npm run blackhole -- approve <questId>
  npm run blackhole -- start <questId>
  npm run blackhole -- evidence <runId> --summary "무엇을 확인했는가"
  npm run blackhole -- complete <runId> --output "artifact path or result" --independent --quality 0.9
  npm run blackhole -- extract <runId> --name "재사용 스킬"
  npm run blackhole -- activate <skillId> --approved-by "연호님" --tests-passed --license-reviewed --secrets-removed --isolation-pass
  npm run blackhole -- assess <skillId>
  npm run blackhole -- retry <runId>
  npm run blackhole -- stop [runId]
  npm run blackhole -- resume
  npm run blackhole -- providers
  npm run blackhole -- check [--live] [providerId ...]
  npm run blackhole -- project:create --name "프로젝트 이름" --objective "목표" --criteria "기준1|기준2"
  npm run blackhole -- ledger:add <wealth|honor|fame> --summary "확인된 외부 성과" --evidence-id evidence_<id> --verified

Environment:
  BLACK_HOLE_DATA_DIR=data
  BLACK_HOLE_HOST=127.0.0.1
  BLACK_HOLE_PORT=8787
  BLACK_HOLE_ACCESS_TOKEN=<16+ chars for non-loopback access>
`);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0] || "help";
  const dataDir = process.env.BLACK_HOLE_DATA_DIR || "data";
  const store = await openStore(dataDir);

  if (command === "help" || command === "--help" || command === "-h") return help();
  if (command === "init") return print({ ok: true, system: store.snapshot().system, paths: store.paths() });
  if (command === "status") return print(summarizeState(store.snapshot()));
  if (command === "providers") return print(providerStatuses());
  if (command === "check") {
    const requested = positional.slice(1);
    const providerIds = requested.length ? requested : undefined;
    if (!boolFlag(flags, "live")) return print(providerStatuses());
    const checks = await liveProviderChecks({ providerIds });
    await store.transact("provider.checked", (state) => recordProviderChecks(state, checks));
    return print(checks);
  }

  if (command === "propose") {
    const problem = positional.slice(1).join(" ").trim();
    const candidates = proposeQuests({
      problem,
      budgetUsd: numberFlag(flags, "budget", 0),
      durationMinutes: numberFlag(flags, "duration", 60),
      permissions: String(flag(flags, "permission", "read_workspace")).split(",").map((item) => item.trim()).filter(Boolean),
      evidence: String(flag(flags, "evidence", "")).split("|").map((item) => item.trim()).filter(Boolean),
    });
    const ranked = rankQuestCandidates(candidates, {
      evidenceStrength: candidates[0].evidenceBasis.length ? 0.5 : 0.1,
      budgetCeilingUsd: numberFlag(flags, "budget", 0) || 1,
      userDirected: boolFlag(flags, "user-directed"),
    });
    await store.transact("quest.proposed", (state) => { state.quests.push(...ranked); return ranked.map((quest) => quest.id); });
    return print({ saved: ranked.length, topCandidate: ranked[0], candidates: ranked });
  }

  const id = positional[1];
  if (["approve", "start", "retry", "evidence", "complete", "extract", "activate", "assess"].includes(command) && !id) {
    throw new Error(`${command} requires an id`);
  }
  if (command === "approve") {
    const saved = await store.transact("quest.approved", (state) => approveQuest(state, id, String(flag(flags, "by", "cli_user"))));
    return print(saved.result);
  }
  if (command === "start") {
    const saved = await store.transact("quest.started", (state) => startQuest(state, id, { budgetAvailableUsd: numberFlag(flags, "available-budget", Number.POSITIVE_INFINITY), maxConcurrentRuns: numberFlag(flags, "max-concurrent", 1) }));
    return print(saved.result);
  }
  if (command === "retry") {
    const saved = await store.transact("run.retried", (state) => { clearStop(state); return retryRun(state, id, { budgetAvailableUsd: numberFlag(flags, "available-budget", Number.POSITIVE_INFINITY), maxConcurrentRuns: numberFlag(flags, "max-concurrent", 1) }); });
    return print(saved.result);
  }
  if (command === "stop") {
    const saved = await store.transact("runtime.stop_requested", (state) => requestStop(state, id || null));
    return print({ stopRequested: true, affectedRuns: saved.result });
  }
  if (command === "resume") {
    const saved = await store.transact("runtime.stop_cleared", (state) => clearStop(state));
    return print({ stopRequested: saved.result === false ? false : saved.result });
  }
  if (command === "evidence") {
    const saved = await store.transact("run.evidence_added", (state) => addEvidence(state, id, {
      summary: flag(flags, "summary"),
      kind: flag(flags, "kind", "execution"),
      artifactPath: flag(flags, "artifact"),
      artifactHash: flag(flags, "hash"),
      toolCallId: flag(flags, "tool-call"),
      verified: boolFlag(flags, "verified"),
    }));
    return print(saved.result);
  }
  if (command === "complete") {
    const saved = await store.transact("run.completed", (state) => completeRun(state, id, {
      output: flag(flags, "output"),
      artifactPath: flag(flags, "artifact"),
      independent: boolFlag(flags, "independent"),
      qualityScore: numberFlag(flags, "quality", 0),
      newInput: boolFlag(flags, "new-input"),
      regressionPass: boolFlag(flags, "regression-pass"),
      recoveryPass: boolFlag(flags, "recovery-pass"),
      externalComparisonAdvantage: boolFlag(flags, "comparison-advantage"),
      customerValueVerified: boolFlag(flags, "customer-value"),
      evaluationNotes: flag(flags, "notes", ""),
      costUsd: numberFlag(flags, "cost", 0),
      interventionMinutes: numberFlag(flags, "intervention", 0),
      success: flag(flags, "success", "true") !== "false",
      failureReason: flag(flags, "failure-reason"),
    }));
    return print(saved.result);
  }
  if (command === "extract") {
    const saved = await store.transact("skill.extracted", (state) => extractSkill(state, id, {
      name: flag(flags, "name"),
      description: flag(flags, "description", ""),
      version: flag(flags, "version", "0.1.0"),
      inputContract: String(flag(flags, "input", "")).split("|").filter(Boolean),
      outputContract: String(flag(flags, "output-contract", "")).split("|").filter(Boolean),
      procedure: String(flag(flags, "procedure", "")).split("|").filter(Boolean),
      dependencies: String(flag(flags, "dependency", "")).split(",").filter(Boolean),
      permissions: String(flag(flags, "permission", "read_workspace")).split(",").filter(Boolean),
      scope: flag(flags, "scope", "limited"),
      licenseReviewed: boolFlag(flags, "license-reviewed"),
      secretsRemoved: boolFlag(flags, "secrets-removed"),
      isolationTestPass: boolFlag(flags, "isolation-pass"),
    }));
    return print(saved.result);
  }
  if (command === "activate") {
    const saved = await store.transact("skill.activated", (state) => activateSkill(state, id, {
      approvedBy: flag(flags, "approved-by"),
      testsPassed: boolFlag(flags, "tests-passed"),
      licenseReviewed: boolFlag(flags, "license-reviewed"),
      secretsRemoved: boolFlag(flags, "secrets-removed"),
      isolationTestPass: boolFlag(flags, "isolation-pass"),
    }));
    return print(saved.result);
  }
  if (command === "assess") {
    const state = store.snapshot();
    const skill = state.skills.find((candidate) => candidate.id === id);
    if (!skill) throw new Error(`Skill not found: ${id}`);
    return print({ skillId: id, ...assessSkill(skill) });
  }
  if (command === "project:create") {
    const project = createProject({
      name: flag(flags, "name"),
      path: flag(flags, "path"),
      goalContract: {
        objective: flag(flags, "objective"),
        successCriteria: String(flag(flags, "criteria", "")).split("|").filter(Boolean),
        evidencePlan: String(flag(flags, "evidence-plan", "input|output|independent check")).split("|").filter(Boolean),
        maxCostUsd: numberFlag(flags, "budget", 0),
        maxDurationMinutes: numberFlag(flags, "duration", 60),
        requiredPermissions: String(flag(flags, "permission", "read_workspace")).split(",").filter(Boolean),
      },
    });
    await store.transact("project.registered", (state) => { state.projects.push(project); return project.id; });
    return print(project);
  }
  if (command === "ledger:add") {
    const ledgerName = id;
    const saved = await store.transact("ledger.entry_added", (state) => addLedgerEntry(state, ledgerName, {
      summary: flag(flags, "summary"),
      value: flag(flags, "value"),
      unit: flag(flags, "unit"),
      evidenceIds: String(flag(flags, "evidence-id", "")).split(",").map((item) => item.trim()).filter(Boolean),
      verified: boolFlag(flags, "verified"),
    }));
    return print(saved.result);
  }
  if (command === "quest:create") {
    const quest = createQuest({
      title: flag(flags, "title"),
      objective: flag(flags, "objective"),
      driveId: flag(flags, "drive"),
      successCriteria: String(flag(flags, "criteria", "")).split("|").filter(Boolean),
      evidencePlan: String(flag(flags, "evidence-plan", "input|output|independent check")).split("|").filter(Boolean),
      maxCostUsd: numberFlag(flags, "budget", 0),
      maxDurationMinutes: numberFlag(flags, "duration", 60),
      requiredPermissions: String(flag(flags, "permission", "read_workspace")).split(",").filter(Boolean),
      riskLevel: flag(flags, "risk", "low"),
      externalSideEffects: boolFlag(flags, "external-side-effects"),
      sensitiveData: boolFlag(flags, "sensitive-data"),
    });
    await store.transact("quest.created", (state) => { state.quests.push(quest); return quest.id; });
    return print(quest);
  }
  throw new Error(`Unknown command: ${command}. Use help.`);
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, code: error.code || "CLI_ERROR", details: error.details || error.gate || undefined }, null, 2));
  process.exitCode = 1;
});
