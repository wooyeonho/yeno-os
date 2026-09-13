from pathlib import Path


def patch(path, old, new, marker=None):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    if (marker or new) in text:
        return
    if text.count(old) != 1:
        raise SystemExit(f'{path}: expected one replacement, found {text.count(old)}')
    file.write_text(text.replace(old, new), encoding='utf-8')


# A research job at step 2 already owns its settled answer and only needs to
# persist bytes. Let that one checkpoint run even when the AI module is off.
patch(
    'runtime/server.mjs',
    " const jobModule=job=>job.type==='code'&&['generate','repair'].includes(job.codeTask?.mode)?'ai':moduleFor(job.type);",
    " const localResearchCompletion=job=>{const assistant=job.agentJournal?.history?.findLast(message=>message.role==='assistant');return job.type==='agent'&&!!job.researchRequest&&job.step===2&&typeof job.draft==='string'&&job.draft.trim().length>0&&job.callLimit===1&&job.agentJournal?.calls?.length===1&&job.agentJournal.calls[0].status==='settled'&&typeof assistant?.content==='string'&&assistant.content.trim().length>0&&Array.isArray(assistant.toolCalls)&&assistant.toolCalls.length===0;};\n const jobModule=job=>job.type==='code'&&['generate','repair'].includes(job.codeTask?.mode)?'ai':moduleFor(job.type);",
    marker='const localResearchCompletion=job=>',
)
patch(
    'runtime/server.mjs',
    "     if(blocked||budget||(!s.modules[jobModule(job)]&&!job.questId)){job.status='paused';job.pauseReason=blocked||(budget?'dailyBudget':'moduleDisabled');touch(job);save();continue;}",
    "     if(blocked||budget||(!localResearchCompletion(job)&&!s.modules[jobModule(job)]&&!job.questId)){job.status='paused';job.pauseReason=blocked||(budget?'dailyBudget':'moduleDisabled');touch(job);save();continue;}",
    marker='!localResearchCompletion(job)&&!s.modules[jobModule(job)]',
)

# Public job records intentionally omit codeTask. Reuse the already calculated,
# bounded execution classification instead of reclassifying them as unknown.
patch(
    'runtime/lib/independent-core.mjs',
    "  if (!job || typeof job !== 'object' || Array.isArray(job)) {\n    return result('unclassified', null, 'blocked', 'job record is not an object');\n  }\n  if (job.type === 'code') {",
    "  if (!job || typeof job !== 'object' || Array.isArray(job)) {\n    return result('unclassified', null, 'blocked', 'job record is not an object');\n  }\n  const existing = job.execution;\n  if (existing && existing.schemaVersion === 1\n      && ['local-core', 'model-call', 'development-model-call', 'unclassified'].includes(existing.kind)\n      && [true, false, null].includes(existing.requiresModel)\n      && typeof existing.trigger === 'string' && typeof existing.reason === 'string') {\n    return { ...existing };\n  }\n  if (job.type === 'code') {",
    marker='const existing = job.execution;',
)

patch(
    'runtime/test/independent-core.test.mjs',
    "  const settled = autopilotState(false); settled.jobs.push(settledResearchJob(track));\n  assert.deepEqual(planAutopilot(settled, { config, at: '2026-09-13T00:10:00.000Z' }), { kind: 'resume', jobId: settled.jobs[0].id });",
    "  const settled = autopilotState(false); settled.jobs.push(settledResearchJob(track, { step: 2 }));\n  settled.jobs[0].draft = '새 호출 없이 저장할 검증 전 연구 초안';\n  assert.deepEqual(planAutopilot(settled, { config, at: '2026-09-13T00:10:00.000Z' }), { kind: 'resume', jobId: settled.jobs[0].id });",
    marker="settled.jobs[0].draft = '새 호출 없이 저장할 검증 전 연구 초안';",
)
