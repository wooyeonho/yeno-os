from pathlib import Path


def patch(path, old, new, marker=None):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    if (marker or new) in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one replacement, found {count}')
    file.write_text(text.replace(old, new), encoding='utf-8')


# Only a persisted step-2 draft is local-only. Earlier checkpoints may still
# collect evidence or invoke a provider and therefore stay blocked without an
# explicitly authorized model path.
patch(
    'runtime/lib/autopilot.mjs',
    "    // A settled answer can finish locally. Any path that would create a new\n    // provider call needs explicit background authorization, which production\n    // provider configuration deliberately never grants.\n    if(finalAnswer)return true;\n    return backgroundModelCallsAllowed(ctx)&&!!ctx.config.ready&&calls(job).length===0&&aiAvailable(ctx);",
    "    if(!backgroundModelCallsAllowed(ctx))return false;\n    return !!ctx.config.ready&&(calls(job).length===0?aiAvailable(ctx):finalAnswer);",
    marker="return !!ctx.config.ready&&(calls(job).length===0?aiAvailable(ctx):finalAnswer);",
)

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

# The public boundary wrapper is already present on the merged branch. Fail
# rather than silently weakening the code-workshop classification.
independent = Path('runtime/lib/independent-core.mjs').read_text(encoding='utf-8')
if "job?.type==='code'&&!job.codeTask&&typeof job.code?.mode==='string'" not in independent:
    raise SystemExit('public code execution boundary wrapper is missing')

patch(
    'runtime/test/independent-core.test.mjs',
    "  const settled = autopilotState(false); settled.jobs.push(settledResearchJob(track));\n  assert.deepEqual(planAutopilot(settled, { config, at: '2026-09-13T00:10:00.000Z' }), { kind: 'resume', jobId: settled.jobs[0].id });",
    "  const settled = autopilotState(false); settled.jobs.push(settledResearchJob(track, { step: 2 }));\n  settled.jobs[0].draft = '새 호출 없이 저장할 검증 전 연구 초안';\n  assert.deepEqual(planAutopilot(settled, { config, at: '2026-09-13T00:10:00.000Z' }), { kind: 'resume', jobId: settled.jobs[0].id });",
    marker="settled.jobs[0].draft = '새 호출 없이 저장할 검증 전 연구 초안';",
)
