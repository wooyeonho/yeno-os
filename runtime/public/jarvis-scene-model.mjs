export const DRIVE_COLOR = Object.freeze({
  greed:'#c98500',gluttony:'#3987e5',envy:'#199e70',pride:'#9085e9',
  lust:'#d55181',wrath:'#e66767',sloth:'#d95926',
});

export function measuredDriveTint(drives, dominantDriveId, neutral) {
  const measured = Array.isArray(drives) ? drives.find(drive=>drive.driveId===dominantDriveId) : null;
  return typeof measured?.pressure==='number' && Number.isFinite(measured.pressure) && measured.pressure>0
    ? DRIVE_COLOR[dominantDriveId] || neutral : neutral;
}

export function heartbeatChanged(previous, next) {
  return previous !== null && typeof next === 'string' && next.length > 0 && next !== previous;
}

export function composeFromCore(core) {
  if (core.activity === 'waiting_owner') return '여기서부터는 되돌릴 수 없어. 마지막은 네가 정해줘.';
  const target = core.missionGoal || core.focusProjectName;
  if (target && ['planning','executing','verifying'].includes(core.activity)) return `${target} — 그 일을 진행하고 있어.`;
  if (core.activity === 'idle') return '조용한 박동. 그래도 나는 깨어 있어. 말 걸면 바로 움직일게.';
  return '여기 있어.';
}
