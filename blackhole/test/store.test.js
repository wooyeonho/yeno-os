import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveQuest, createQuest, startQuest } from "../src/core.js";
import { openStore } from "../src/store.js";

test("store persists state and recovers a running run on restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "black-hole-test-"));
  const first = await openStore(dir);
  const quest = createQuest({
    title: "저장 시험",
    objective: "상태와 이벤트가 디스크에 남는지 확인",
    successCriteria: ["재시작 후 상태 보존"],
    evidencePlan: ["상태 파일", "이벤트 로그"],
    requiredPermissions: ["read_workspace"],
  });
  await first.transact("quest.created", (state) => { state.quests.push(quest); });
  await first.transact("quest.approved", (state) => approveQuest(state, quest.id, "test"));
  const started = await first.transact("quest.started", (state) => startQuest(state, quest.id));
  const second = await openStore(dir);
  assert.equal(second.snapshot().quests[0].id, quest.id);
  assert.equal(second.snapshot().runs[0].id, started.result.id);
  assert.equal(second.snapshot().runs[0].status, "interrupted");
  assert.match(await readFile(join(dir, "black-hole.events.jsonl"), "utf8"), /runtime\.recovered/);
});
