import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSkillHistory} from '../lib/solo-leveling.mjs';
import {initialCapabilities, importCapability, verifyCapability, activateCapability, disableCapability, getCapabilityStatus} from '../lib/capabilities.mjs';
import {autoAcquireCapability} from '../lib/kirby.mjs';
import {initialShadowRoster, extractShadows, renameShadow} from '../lib/shadow-roster.mjs';
import {rankTitle, gradeChangeNotice, shadowJoinNotice, kirbyCapabilityNotice} from '../public/system-notice.mjs';

const at = '2026-09-29T00:00:00.000Z';
const uuid = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const manifest = JSON.parse(readFileSync(new URL('../capabilities/ledger-digest.json', import.meta.url)));
const digest = value => value.repeat(64);
function history(count, previous = null) {
  const records = Array.from({length: count}, (_, index) => ({at, action: 'run', id: 'scout', hash: digest('a'), runId: uuid(index + 1), inputSha256: digest(String(index + 1)), outputSha256: digest('b')}));
  return buildSkillHistory(previous, {
    registry: {entries: [{id: 'scout'}], history: records}, skillId: 'scout',
    executions: records.map(record => ({jobId: record.runId, skillId: 'scout', status: 'completed', executionVerified: true, authorizedBy: 'owner', at})),
  });
}
function acquired() {
  return getCapabilityStatus(autoAcquireCapability(initialCapabilities(), manifest, {at}).registry)[0];
}
function extracted() {
  const missionId = uuid(10), roles = ['scout', 'researcher', 'builder', 'verifier', 'semanticVerifier'];
  const jobs = roles.map((role, index) => ({id: uuid(index + 20), status: 'completed', shadowAssignment: {missionId, role}, artifacts: [{id: uuid(index + 30)}], createdAt: at, updatedAt: at}));
  jobs[3].verifyResult = {verified: true};
  jobs[4].semanticVerdict = {version: 1, missionId, builderJobId: jobs[2].id, verifierJobId: jobs[3].id, artifactRefs: [jobs[2].artifacts[0].id], verdict: 'pass', createdAt: at};
  const state = {shadowArise:{attempts:[],majorMarks:[{missionId,requestId:uuid(99),at}]},jobs, artifacts: {[jobs[2].artifacts[0].id]: {id: jobs[2].artifacts[0].id, jobId: jobs[2].id, sha256: digest('a')}}};
  return extractShadows(initialShadowRoster(), state, missionId, at).roster;
}

test('rank_titles_are_display_only_and_keep_the_original_six_grades', () => {
  assert.deepEqual(['E', 'D', 'C', 'B', 'A', 'S'].map(rankTitle), ['일반병', '정예병', '기사', '정예기사', '원수', '대원수']);
  for (const value of [null, 'SS', 'constructor', '__proto__']) assert.equal(rankTitle(value), null);
});

test('grade_change_renders_system_style_with_original_reason_quoted', () => {
  const current = history(2), before = structuredClone(current);
  const notice = gradeChangeNotice(current, '정찰자 1호');
  assert.match(notice, /^\[시스템\] 조건을 충족하였습니다\./);
  assert.match(notice, /'정찰자 1호'.*기사\(C\)로 승급합니다/);
  assert.ok(notice.includes(`다음 등급 제한 사유: 「${current.checks.B.reason}」`));
  assert.deepEqual(current, before);
});

test('demotion_quotes_the_unmodified_original_unmet_check_reason', () => {
  const current = history(1, history(2));
  const notice = gradeChangeNotice(current, '정찰자 1호');
  assert.match(notice, /기사\(C\).*정예병\(D\)로 강등됩니다/);
  assert.ok(notice.endsWith(`— 사유: 「${current.checks.C.reason}」`));
  assert.doesNotMatch(notice, /승급합니다|조건을 충족하였습니다/);
});

test('grade_notices_require_an_existing_consistent_promotion_record', () => {
  const current = history(2);
  const malformed = [null, {}, {from: 'E', to: 'C', kind: 'promotion', reason: 'claim'}, {...current, promotions: []}, {...current, grade: 'S'}, {...current, promotions: [{...current.promotions[0], kind: 'demotion'}]}, {...current, checks: {...current.checks, C: {met: false, reason: 'not met'}}}];
  for (const value of malformed) assert.equal(gradeChangeNotice(value, '정찰자'), null);
  assert.equal(gradeChangeNotice(history(0), '정찰자'), null);
});

test('arise_renders_only_a_member_of_the_actual_extracted_roster', () => {
  const roster = extracted(), entry = roster.entries[0];
  const notice = shadowJoinNotice(entry, roster);
  assert.equal(notice, `[시스템] "일어나라." — '${entry.name}'가 그림자군단에 합류했습니다.`);
  assert.equal(shadowJoinNotice(entry, initialShadowRoster()), null);
  assert.equal(shadowJoinNotice({...entry, name: '위조'}, roster), null);
});

test('unsupported_arise_failed_storage_cap_and_kirby_events_are_rejected', () => {
  for (const type of ['arise_failed', 'stored', 'recalled', 'roster_cap', 'noAbility', 'copyAbility', 'star']) {
    const event = {type, name: '주장', reason: '주장', attempts: 2, maxAttempts: 3, verified: true};
    assert.equal(shadowJoinNotice(event, extracted()), null);
    assert.equal(kirbyCapabilityNotice(event), null);
  }
});

test('kirby_inhale_requires_a_real_import_and_does_not_claim_copy', () => {
  const capability = getCapabilityStatus(importCapability(initialCapabilities(), manifest, {at}).registry)[0];
  const notice = kirbyCapabilityNotice(capability);
  assert.match(notice, /^흡입! BLACKHOLE/);
  assert.match(notice, /시험 통과·활성화 전/);
  assert.doesNotMatch(notice, /카피!|무능력|별맛/);
});

test('kirby_copy_requires_the_active_version_to_have_passed_fixtures', () => {
  const capability = acquired(), original = structuredClone(capability);
  const notice = kirbyCapabilityNotice(capability);
  assert.equal(notice, `카피! '${manifest.name}' 모자를 썼습니다.`);
  assert.deepEqual(capability, original);
  for (const mutation of [{activeHash: digest('f')}, {status: 'inactive'}, {versions: capability.versions.map(version => ({...version, verified: false}))}, {versions: capability.versions.map(version => ({...version, verifiedAt: null}))}, {versions: capability.versions.map(version => ({...version, fixtureCount: 0}))}]) {
    assert.equal(kirbyCapabilityNotice({...capability, ...mutation}), null);
  }
});

test('future_kirby_flags_cannot_override_a_real_capability_status', () => {
  const capability = acquired();
  for (const field of ['noAbility', 'copyAbility', 'star']) {
    assert.equal(kirbyCapabilityNotice({...capability, [field]: true}), null);
  }
  assert.equal(kirbyCapabilityNotice({id: manifest.id, name: manifest.name, acquired: true, stage: 'active'}), null);
});

test('verified_but_inactive_capability_waits_for_activation_without_a_hat', () => {
  const imported = importCapability(initialCapabilities(), manifest, {at});
  const verified = verifyCapability(imported.registry, manifest.id, imported.result.hash, {at});
  const notice = kirbyCapabilityNotice(getCapabilityStatus(verified.registry)[0]);
  assert.match(notice, /시험을 통과했습니다.*활성화 대기/);
  assert.doesNotMatch(notice, /카피!|모자를 썼/);
});

test('disabled_capability_does_not_invent_a_star_or_repeat_an_inhale', () => {
  const imported = importCapability(initialCapabilities(), manifest, {at});
  const verified = verifyCapability(imported.registry, manifest.id, imported.result.hash, {at});
  const active = activateCapability(verified.registry, manifest.id, imported.result.hash, {at});
  const disabled = disableCapability(active.registry, manifest.id, {at});
  const notice = kirbyCapabilityNotice(getCapabilityStatus(disabled.registry)[0]);
  assert.match(notice, /비활성 상태/);
  assert.doesNotMatch(notice, /흡입!|카피!|능력 별|다시 주울/);
});

test('failed_fixture_is_an_inactive_import_without_inventing_noAbility', () => {
  const broken = structuredClone(manifest);
  broken.fixtures[0].expectedRows = [];
  const result = autoAcquireCapability(initialCapabilities(), broken, {at});
  assert.equal(result.result.acquired, false);
  const notice = kirbyCapabilityNotice(getCapabilityStatus(result.registry)[0]);
  assert.doesNotMatch(notice, /카피!|무능력|별맛|모자를 썼/);
  assert.match(notice, /시험 통과·활성화 전/);
});

test('owner_names_and_sources_are_preserved_as_plain_text_without_coercion', () => {
  const name = '<img src=x onerror=alert(1)>';
  assert.ok(gradeChangeNotice(history(2), name).includes(name));
  assert.ok(kirbyCapabilityNotice({...acquired(), name}).includes(name));
  const roster = extracted(), renamed = renameShadow(roster, roster.entries[0].id, '<b>정찰자</b>', at);
  assert.ok(shadowJoinNotice(renamed.entries[0], renamed).includes('<b>정찰자</b>'));
  const trap = {toString() {throw new Error('owner object executed');}};
  assert.equal(kirbyCapabilityNotice({...acquired(), name: trap}), null);
  assert.equal(kirbyCapabilityNotice({...acquired(), source: {...manifest.source, author: trap}}), null);
  assert.equal(gradeChangeNotice(history(2), trap), null);
});
