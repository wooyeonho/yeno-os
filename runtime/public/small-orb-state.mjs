export const SMALL_ORB_LABELS = Object.freeze({
  working: '작업 중', searching: '근거 확인 중', solving: '검증 중',
  listening: '승인 대기', composing: '산출물 작성 중', shaping: '능력 변화 중',
  still: '움직임 없음',
});

// Only durable server facts may select a moving mode. An absent or ambiguous
// source is visually still. The order prevents a stale job from overriding a
// newer core-wide stop or owner gate.
export function smallOrbState({online, emergencyStop, core, jobs = []} = {}) {
  if (!online || emergencyStop || !core || ['paused', 'stopped', 'idle'].includes(core.activity)) return 'still';
  if (core.activity === 'waiting_owner' || core.pendingApprovalCount > 0) return 'listening';
  if (core.activity === 'verifying') return 'solving';
  if (core.activity === 'planning') return 'working';
  if (core.activity === 'executing' && jobs.some(job => job.status === 'running')) return 'working';
  return 'still';
}
