import test from 'node:test';
import assert from 'node:assert/strict';
import {DRIVE_IDS, DRIVE_CANON} from '../lib/seven-drives.mjs';
import {rankMotivatedCandidates, emptySignals, scoreMotivation, MISSING_MEASUREMENTS, validateMotivation} from '../lib/motivation.mjs';
import {driveVoice, debateFor, initialDriveState} from '../lib/drive-state.mjs';

const at = '2026-09-29T00:00:00.000Z';
const candidate = signals => rankMotivatedCandidates({jobs: []}, [{action: {kind: 'quest', taskKey: 'synthetic-voice'}, goal: '합성 발화 검증', successCriterion: '실제 숫자만 말한다', signals}], at)[0];
function observedCandidate(overrides) {
  const signals = emptySignals(overrides), components = scoreMotivation(signals);
  const dominantDrives = [...DRIVE_IDS].sort((a, b) => components[b] - components[a] || DRIVE_IDS.indexOf(a) - DRIVE_IDS.indexOf(b)).filter(id => components[id] > 0).slice(0, 2);
  const motivation = {version: 1, decidedAt: at, goal: '합성 발화 검증', successCriterion: '실제 숫자만 말한다', dominantDrives, score: Math.round(Object.values(components).reduce((a, b) => a + b, 0) * 100) / 100, components, signals, missingMeasurements: [...MISSING_MEASUREMENTS]};
  validateMotivation(motivation);
  return {motivation};
}

test('each_voice_contains_its_real_numbers', () => {
  const selected = candidate({assetGap: 2, reuseArtifacts: 3, knowledgeGap: 4, coverageGap: 5, verificationGap: 6, deliveryGap: 7, repairNeed: 8, estimatedCalls: 1});
  const expected = {greed: ['3건', '2건'], gluttony: ['4건'], envy: ['5건'], pride: ['6건'], lust: ['7건'], wrath: ['8건', '실패 0건', '미확인 호출 0건'], sloth: ['1회', '3건']};
  for (const id of DRIVE_IDS) {
    const text = driveVoice(id, selected, 50);
    for (const number of expected[id]) assert.ok(text.includes(number), `${id}: ${text}`);
    assert.ok(text.includes(DRIVE_CANON.find(drive => drive.id === id).legacyName));
  }
});

test('top3_has_one_push_and_two_contests_with_real_component_differences', () => {
  const selected = candidate({assetGap: 3, knowledgeGap: 3, verificationGap: 3});
  const voices = debateFor([selected], initialDriveState().hunger, at);
  assert.match(voices[0].text, /\[push\]/);
  assert.ok(voices.slice(1).every(voice => /\[contest\]/.test(voice.text)));
  assert.ok(voices.slice(1).every(voice => /반대/.test(voice.text)));
  for (const voice of voices.slice(1)) {
    const own = selected.motivation.components[voice.driveId], leader = selected.motivation.components[voices[0].driveId];
    assert.ok(voice.text.includes(`기여 ${own}`));
    assert.ok(voice.text.includes(`차이 ${Math.round((own - leader) * 100) / 100}`));
    assert.deepEqual(Object.keys(voice).sort(), ['driveId', 'text', 'weightedScore']);
  }
});

test('voice_length_limit_kept_with_large_and_fractional_signal_numbers', () => {
  for (const signals of [{assetGap: 999999.9999999999, reuseArtifacts: 999999.9999999999, knowledgeGap: 999999.9999999999, coverageGap: 999999.9999999999, verificationGap: 999999.9999999999, deliveryGap: 999999.9999999999, repairNeed: 999999.9999999999, estimatedCalls: 0.9999999999999999}, {assetGap: 1, knowledgeGap: 1, verificationGap: 1, deliveryGap: 1, repairNeed: 1, reuseArtifacts: 1, estimatedCalls: 0.00000000000000001}]) {
    const selected = candidate(signals);
    for (const id of DRIVE_IDS) assert.ok(driveVoice(id, selected, 100).length <= 120);
    assert.ok(debateFor([selected], initialDriveState().hunger, at).every(voice => voice.text.length <= 120));
  }
});

test('fractional_failure_and_unknown_signals_keep_exact_numbers_in_bounded_contests', () => {
  for (const overrides of [
    {assetGap: 1, repairNeed: 0.0012345678901234567, ownFailures: 1.2345678901234567e-100, unknownCalls: 1.2345678901234567e-100, estimatedCalls: 1},
    {knowledgeGap: 999999.9999999999, repairNeed: 999999.9999999999, ownFailures: 0.12345678901234567, unknownCalls: 0.12345678901234567},
    {knowledgeGap: 999999.9999999999, repairNeed: 999999.9999999999, ownFailures: 2.2250738585072014e-308, unknownCalls: 2.2250738585072014e-308},
  ]) {
    const selected = observedCandidate(overrides);
    const hunger = Object.fromEntries(DRIVE_IDS.map(id => [id, id === 'gluttony' ? 100 : 0]));
    const voices = debateFor([selected], hunger, at), wrath = voices.find(voice => voice.driveId === 'wrath');
    assert.ok(wrath.text.length <= 120);
    for (const key of ['repairNeed', 'ownFailures', 'unknownCalls']) assert.ok(wrath.text.includes(String(selected.motivation.signals[key])));
    assert.match(wrath.text, /\[contest\]/);
    const rawDifference = Math.round((selected.motivation.components.wrath - selected.motivation.components[voices[0].driveId]) * 100) / 100;
    assert.ok(wrath.text.includes(`차이 ${rawDifference}`));
  }
});
