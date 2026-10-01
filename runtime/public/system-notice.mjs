// Display-only projections of server-validated records. These shape checks
// reject incomplete inputs; they do not replace the runtime's proof validators.
// Return plain text: consumers must use textContent or their existing esc().
const GRADES = Object.freeze(['E', 'D', 'C', 'B', 'A', 'S']);
const TITLES = Object.freeze(['일반병', '정예병', '기사', '정예기사', '원수', '대원수']);
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = value => typeof value === 'string' && value.trim().length > 0;
const hash = value => typeof value === 'string' && HASH.test(value);
const uuid = value => typeof value === 'string' && UUID.test(value);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export const rankTitle = grade => TITLES[GRADES.indexOf(grade)] ?? null;

// promotions is the actual Solo Leveling trail, never a browser's seen-grade
// diff. Successful checks have no reason: the quoted reason then describes
// the NEXT grade's restriction, not an invented justification for promotion.
export function gradeChangeNotice(history, name) {
  if (!record(history) || history.version !== 1 || !text(name) || !text(history.skillId)
    || !hash(history.fingerprint) || !record(history.checks) || !Array.isArray(history.promotions)) return null;
  const change = history.promotions.at(-1), current = GRADES.indexOf(history.grade);
  if (!exact(change, ['from', 'to', 'kind', 'at', 'evidenceFingerprint']) || current < 0
    || change.to !== history.grade || !timestamp(change.at) || !hash(change.evidenceFingerprint)) return null;
  const previous = GRADES.indexOf(change.from);
  if (previous < 0 || previous === current) return null;
  for (let index = 1; index < GRADES.length; index++) {
    const check = history.checks[GRADES[index]];
    if (!record(check) || check.met !== (index <= current)
      || (check.met ? !timestamp(check.at) : !text(check.reason))) return null;
  }
  const nextReason = history.checks[GRADES[current + 1]]?.reason;
  const destination = `${rankTitle(history.grade)}(${history.grade})`;
  switch (change.kind) {
    case 'promotion':
      if (previous >= current) return null;
      return `[시스템] 조건을 충족하였습니다. 그림자 '${name}'이(가) ${destination}로 승급합니다.${nextReason ? ` — 다음 등급 제한 사유: 「${nextReason}」` : ''}`;
    case 'demotion':
      if (previous <= current || !text(nextReason)) return null;
      return `[시스템] 등급 조건을 충족하지 못했습니다. 그림자 '${name}'이(가) ${rankTitle(change.from)}(${change.from})에서 ${destination}로 강등됩니다. — 사유: 「${nextReason}」`;
    default:
      return null;
  }
}

export function shadowJoinNotice(entry, roster) {
  if (!record(roster) || roster.version !== 1 || !hash(roster.fingerprint) || !Array.isArray(roster.entries)
    || !record(entry) || !uuid(entry.id) || !hash(entry.fingerprint) || !text(entry.name)
    || !['scout', 'researcher', 'builder', 'verifier'].includes(entry.role) || entry.skillId !== `shadow:${entry.role}`
    || !uuid(entry.bornFromMissionId) || !timestamp(entry.bornAt) || !Array.isArray(entry.missions)
    || entry.missions[0] !== entry.bornFromMissionId || !entry.missions.every(uuid)) return null;
  const member = roster.entries.find(candidate => record(candidate) && candidate.id === entry.id);
  if (!member || !['name', 'role', 'skillId', 'bornFromMissionId', 'bornAt', 'renamedBy', 'fingerprint'].every(key => member[key] === entry[key])
    || !Array.isArray(member.missions) || member.missions.length !== entry.missions.length
    || !entry.missions.every((mission, index) => mission === member.missions[index])) return null;
  return `[시스템] "일어나라." — '${entry.name}'가 그림자군단에 합류했습니다.`;
}

// getCapabilityStatus is the public projection of the validated registry.
// There is currently no persisted noAbility/star event or extraction-attempt
// counter. Inactive imports and manual disables must never impersonate them.
export function kirbyCapabilityNotice(capability) {
  if (!record(capability) || !text(capability.id) || !text(capability.name) || !record(capability.source)
    || !['native', 'owner', 'external'].includes(capability.source.kind) || !text(capability.source.author)
    || !Array.isArray(capability.versions) || capability.versions.length === 0
    || ['noAbility', 'copyAbility', 'star'].some(key => Object.hasOwn(capability, key))) return null;
  const versions = capability.versions;
  if (versions.some(version => !record(version) || !hash(version.hash) || !timestamp(version.importedAt)
    || typeof version.verified !== 'boolean' || !Number.isInteger(version.fixtureCount) || version.fixtureCount < 2
    || (version.verified ? !timestamp(version.verifiedAt) : version.verifiedAt !== null))) return null;
  if (capability.activeHash !== null) {
    const active = versions.find(version => version.hash === capability.activeHash);
    if (capability.status !== 'active' || !active?.verified) return null;
    return `카피! '${capability.name}' 모자를 썼습니다.`;
  }
  if (capability.status !== 'inactive') return null;
  if (capability.previousHash !== null) {
    if (!versions.some(version => version.hash === capability.previousHash && version.verified)) return null;
    return `'${capability.name}' 능력은 비활성 상태입니다.`;
  }
  const latest = versions.at(-1);
  const stage = latest.verified ? '시험을 통과했습니다. 활성화 대기 중입니다.' : '시험 통과·활성화 전입니다.';
  return `흡입! ${capability.source.author} — '${capability.name}'을(를) 가져왔습니다. ${stage}`;
}
