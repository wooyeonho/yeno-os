import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DRIVE_IDS} from '../lib/seven-drives.mjs';
import {emptySignals, scoreMotivation, MISSING_MEASUREMENTS} from '../lib/motivation.mjs';
import * as drives from '../lib/drive-state.mjs';

const at = '2026-09-29T00:00:00.000Z';
function decision(overrides = {}) {
  const signals = emptySignals(overrides), components = scoreMotivation(signals);
  const dominantDrives = [...DRIVE_IDS].sort((a, b) => components[b] - components[a] || DRIVE_IDS.indexOf(a) - DRIVE_IDS.indexOf(b)).filter(id => components[id] > 0).slice(0, 2);
  const motivation = {version: 1, decidedAt: at, goal: '합성 곡선 검증', successCriterion: '실제 신호로 일곱 곡선을 비교', dominantDrives, score: Math.round(Object.values(components).reduce((a, b) => a + b, 0) * 100) / 100, components, signals, missingMeasurements: [...MISSING_MEASUREMENTS]};
  const top = {motivation};
  return {top, candidates: [top]};
}
const next = overrides => drives.advanceHungerV2(drives.initialDriveState(), decision(overrides), at).hunger;
const legacyState = () => {
  const hunger = Object.fromEntries(DRIVE_IDS.map(id => [id, 50]));
  const updatedAt = '1970-01-01T00:00:00.000Z';
  const fingerprint = createHash('sha256').update(JSON.stringify(DRIVE_IDS.map(id => [id, hunger[id]])) + updatedAt).digest('hex');
  return {version: 1, hunger, updatedAt, fingerprint};
};

test('seven_curves_differ_under_same_signals', () => {
  const selected = decision({assetGap: 2, knowledgeGap: 1, coverageGap: 1, verificationGap: 2, deliveryGap: 1, ownFailures: 1, estimatedCalls: 1});
  let state = drives.initialDriveState();
  const curves = Object.fromEntries(DRIVE_IDS.map(id => [id, [state.hunger[id]]]));
  for (let i = 0; i < 10; i++) {
    state = drives.advanceHungerV2(state, selected, new Date(Date.parse(at) + i * 1000).toISOString());
    for (const id of DRIVE_IDS) curves[id].push(state.hunger[id]);
  }
  assert.equal(new Set(Object.values(curves).map(curve => JSON.stringify(curve))).size, 7);
  assert.equal(drives.DRIVE_STATE_HUNGER_VERSION, 3);
});

test('greed_decays_slowest_when_fed', () => {
  const hunger = next({assetGap: 20, knowledgeGap: 20});
  assert.equal(hunger.greed, 38);
  assert.equal(hunger.gluttony, 20);
});

test('gluttony_rises_proportionally_to_knowledge_gap_up_to_18', () => {
  const hunger = [0, 1, 2, 3, 4].map(knowledgeGap => next({assetGap: 100, verificationGap: 100, knowledgeGap}).gluttony);
  assert.deepEqual(hunger, [50, 56, 62, 68, 68]);
});

test('wrath_never_rises_without_failure_signals', () => {
  assert.equal(next({assetGap: 4, knowledgeGap: 4, missingArtifacts: 100}).wrath, 50);
  for (const key of ['ownFailures', 'repairNeed', 'unknownCalls']) assert.equal(next({assetGap: 100, knowledgeGap: 100, [key]: 1}).wrath, 64);
});

test('lust_rises_immediately_on_any_delivery_gap_and_drops_fastest', () => {
  const hunger = next({assetGap: 100, verificationGap: 100, knowledgeGap: 1, deliveryGap: 0.01, repairNeed: 1, estimatedCalls: 1});
  assert.equal(hunger.lust, 65);
  assert.ok(hunger.lust > hunger.gluttony && hunger.lust > hunger.wrath && hunger.lust > hunger.sloth);
  assert.equal(next({deliveryGap: 100}).lust, 10);
  // E1's +18 gluttony cap can exceed lust's immediate +15; lust is not a global maximum.
  assert.ok(next({assetGap: 100, verificationGap: 100, knowledgeGap: 4, deliveryGap: 1}).gluttony > hunger.lust);
});

test('envy_rises_extra_when_not_dominant_and_the_gap_is_larger', () => {
  const near = next({assetGap: 10, verificationGap: 7, coverageGap: 1});
  const far = next({assetGap: 20, verificationGap: 14, coverageGap: 1});
  assert.ok(far.envy > near.envy);
  assert.ok(near.envy > 52);
  assert.equal(next({coverageGap: 100}).envy, 20);
});

test('pride_only_rises_for_its_verification_gap_and_only_feeding_reduces_it', () => {
  assert.equal(next({assetGap: 100, knowledgeGap: 100}).pride, 50);
  assert.ok(next({assetGap: 100, knowledgeGap: 100, verificationGap: 1}).pride > 50);
  assert.equal(next({verificationGap: 100}).pride, 20);
});

test('sloth_rises_with_work_and_falls_with_reuse', () => {
  const signals = {assetGap: 100, knowledgeGap: 100};
  assert.equal(next({...signals, estimatedCalls: 0}).sloth, 50);
  assert.equal(next({...signals, estimatedCalls: 0.5}).sloth, 56);
  assert.equal(next({...signals, estimatedCalls: 1}).sloth, 62);
  assert.equal(next({...signals, estimatedCalls: 1, reuseArtifacts: 4}).sloth, 46);
});

test('v1_reproduction_unchanged', () => {
  const selected = decision({assetGap: 2, knowledgeGap: 3, verificationGap: 1, reuseArtifacts: 2});
  const result = drives.advanceHungerV1(legacyState(), selected, at);
  assert.deepEqual(result.hunger, {greed: 20, gluttony: 20, envy: 52, pride: 53, lust: 52, wrath: 52, sloth: 55.5});
  const expectedFingerprint = createHash('sha256').update(JSON.stringify(DRIVE_IDS.map(id => [id, result.hunger[id]])) + at).digest('hex');
  assert.equal(result.fingerprint, expectedFingerprint);
  assert.equal(drives.validateDriveState(result), true);
});

test('old_state_restores_without_mutation_then_next_decision_upgrades', () => {
  const state = legacyState(), before = JSON.stringify(state);
  assert.equal(drives.validateDriveState(state), true);
  assert.equal(JSON.stringify(state), before);
  const result = drives.advanceHungerV2(state, decision({assetGap: 3}), at);
  assert.equal(result.version, 2);
  assert.equal(JSON.stringify(state), before);
  assert.throws(() => drives.validateDriveState({...result, version: 1}), /fingerprint/);
  assert.throws(() => drives.validateDriveState({...state, version: 2}), /fingerprint/);
});

test('new_debate_binds_the_seven_value_snapshot_and_preserves_old_entries', () => {
  const old = {at, source: 'owner', goal: '과거 결정', jobId: null, questId: null, voices: DRIVE_IDS.slice(0, 3).map(driveId => ({driveId, text: '기존 문장 그대로', weightedScore: 0})), stateFingerprint: legacyState().fingerprint};
  const before = JSON.stringify(old);
  const result = drives.recordDriveDecision({driveState: legacyState(), driveDebates: [old]}, decision({assetGap: 3}), {at, source: 'owner'});
  assert.equal(result.debate.version, 3);
  assert.deepEqual(result.debate.hungerSnapshot, result.driveState.hunger);
  assert.notEqual(result.debate.hungerSnapshot, result.driveState.hunger);
  assert.equal(JSON.stringify(result.driveDebates[0]), before);
  assert.equal('hungerSnapshot' in result.driveDebates[0], false);
  const tampered = structuredClone(result.debate);
  tampered.hungerSnapshot.greed += 1;
  assert.throws(() => drives.validateDriveDebates([tampered]), /fingerprint/);
  assert.throws(() => drives.validateDriveDebates([{...result.debate, hungerSnapshot: null}]), TypeError);
});
