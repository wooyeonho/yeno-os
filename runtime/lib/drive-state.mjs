import {driveCues,trackDriveAttempt,settleDriveOutcomes,outcomeSpeech,HUNGER_RULES_V3} from './drive-outcomes.mjs';
import {createHash} from 'node:crypto';
import {DRIVE_CANON,DRIVE_IDS} from './seven-drives.mjs';
import {validateMotivation} from './motivation.mjs';

const fixed = number => Math.round(number * 100) / 100;
const initialAt = '1970-01-01T00:00:00.000Z';
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const fingerprint = (hunger, updatedAt, version = 1) => createHash('sha256').update((version === 1 ? '' : `hunger-v${version}:`) + JSON.stringify(DRIVE_IDS.map(id => [id, hunger[id]])) + updatedAt).digest('hex');
const clamp = value => fixed(Math.max(0, Math.min(100, value)));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

export const DRIVE_STATE_HUNGER_VERSION = 3;
// E1 policy coefficients: these are declared priorities, never measured outcomes.
export const HUNGER_RULES_V2 = Object.freeze(Object.fromEntries(Object.entries({
  greed: {fed: -12, minRise: 2, maxRise: 12}, // Accumulation is least satiating.
  gluttony: {fed: -30, perGap: 6, maxRise: 18}, // Proportional appetite, capped at three gaps.
  envy: {fed: -30, minRise: 2, gapRise: 12}, // Fixed floor avoids cancelling the relative gap.
  pride: {fed: -30, minRise: 2, maxRise: 12}, // Only its own verification deficit can raise it.
  lust: {fed: -40, gapRise: 15}, // Any delivery gap reacts immediately; gluttony has the higher ceiling.
  wrath: {fed: -30, failureRise: 14}, // No failures, repairs or uncertainty means no rise.
  sloth: {fed: -30, perCall: 12, perReuse: 4, minRise: -12, maxRise: 12}, // Work raises appetite; reuse relieves it.
}).map(([id, rule]) => [id, Object.freeze(rule)])));

export function initialDriveState({version = DRIVE_STATE_HUNGER_VERSION} = {}) {
  if (![1, 2, DRIVE_STATE_HUNGER_VERSION].includes(version)) throw new TypeError('Invalid drive hunger version');
  const hunger = Object.fromEntries(DRIVE_IDS.map(id => [id, 50]));
  return {version, hunger, updatedAt: initialAt, fingerprint: fingerprint(hunger, initialAt, version)};
}

function validateHunger(hunger) {
  if (!exact(hunger, DRIVE_IDS)) throw new TypeError('Invalid drive hunger');
  for (const id of DRIVE_IDS) if (!Number.isFinite(hunger[id]) || hunger[id] < 0 || hunger[id] > 100 || fixed(hunger[id]) !== hunger[id]) throw new TypeError('Invalid drive hunger');
}

export function validateDriveState(value) {
  if (!exact(value, ['version', 'hunger', 'updatedAt', 'fingerprint']) || ![1, 2, DRIVE_STATE_HUNGER_VERSION].includes(value.version) || !iso(value.updatedAt)) throw new TypeError('Invalid drive state');
  validateHunger(value.hunger);
  if (value.fingerprint !== fingerprint(value.hunger, value.updatedAt, value.version)) throw new TypeError('Drive state fingerprint mismatch');
  return true;
}

function decisionMotivation(state, decision, at) {
  validateDriveState(state);
  if (!decision?.top?.motivation || !iso(at) || Date.parse(at) < Date.parse(state.updatedAt)) throw new TypeError('Invalid drive decision');
  const motivation = decision.top.motivation;
  validateMotivation(motivation);
  return motivation;
}

export function advanceHungerV1(state, decision, at) {
  const motivation = decisionMotivation(state, decision, at);
  if (state.version !== 1) throw new TypeError('Version 1 reproduction requires a version 1 state');
  const peak = Math.max(0, ...DRIVE_IDS.map(id => motivation.components[id]));
  const dominant = new Set(motivation.dominantDrives);
  const hunger = Object.fromEntries(DRIVE_IDS.map(id => {
    const delta = dominant.has(id) ? -30 : Math.max(2, Math.min(12, peak ? Math.max(0, motivation.components[id]) / peak * 12 : 2));
    return [id, clamp(state.hunger[id] + delta)];
  }));
  return {version: 1, hunger, updatedAt: at, fingerprint: fingerprint(hunger, at)};
}

export function advanceHungerV2(state, decision, at) {
  const {signals: s, components, dominantDrives} = decisionMotivation(state, decision, at);
  const ranked = DRIVE_IDS.map(id => components[id]).sort((a, b) => b - a);
  const peak = Math.max(0, ranked[0]), runnerUp = Math.max(0, ranked[1]);
  const hunger = Object.fromEntries(DRIVE_IDS.map(id => {
    const rule = HUNGER_RULES_V2[id];
    let delta = rule.fed;
    if (!dominantDrives.includes(id)) {
      switch (id) {
        case 'greed': delta = Math.max(rule.minRise, Math.min(rule.maxRise, peak ? Math.max(0, components[id]) / peak * rule.maxRise : rule.minRise)); break;
        case 'gluttony': delta = Math.min(rule.maxRise, s.knowledgeGap * rule.perGap); break;
        case 'envy': delta = rule.minRise + (peak ? Math.max(0, runnerUp - components[id]) / peak * rule.gapRise : 0); break;
        case 'pride': delta = s.verificationGap > 0 ? Math.max(rule.minRise, Math.min(rule.maxRise, components[id] / peak * rule.maxRise)) : 0; break;
        case 'lust': delta = s.deliveryGap > 0 ? rule.gapRise : 0; break;
        case 'wrath': delta = s.ownFailures + s.repairNeed + s.unknownCalls > 0 ? rule.failureRise : 0; break;
        case 'sloth': delta = Math.max(rule.minRise, Math.min(rule.maxRise, s.estimatedCalls * rule.perCall - s.reuseArtifacts * rule.perReuse)); break;
        default: throw new TypeError('Unknown drive');
      }
    }
    return [id, clamp(state.hunger[id] + delta)];
  }));
  return {version: 2, hunger, updatedAt: at, fingerprint: fingerprint(hunger, at, 2)};
}

const evidence = {
  greed: s => `더. 재사용 ${s.reuseArtifacts}건으론 부족해. 자산 공백 ${s.assetGap}건, 전부 갖겠어.`,
  gluttony: s => `오래된 근거 ${s.knowledgeGap}건. 다 삼킨다.`,
  envy: s => `검증 범위 공백 ${s.coverageGap}건. 뒤처진 채로는 못 있어.`,
  pride: s => `검증 공백 ${s.verificationGap}건. 이 상태로 내 이름을 걸 수 없다.`,
  lust: s => `전달 공백 ${s.deliveryGap}건. 지금 당장 보여주고 싶어.`,
  wrath: s => `수선 ${s.repairNeed}건, 실패 ${s.ownFailures}건, 미확인 호출 ${s.unknownCalls}건. 원인을 찾아 끝낸다.`,
  sloth: s => `예상 호출 ${s.estimatedCalls}회… 재사용 ${s.reuseArtifacts}건으로 대신하면 안 될까.`,
};
const compactEvidence = {
  greed: s => `더 갖겠어. 재사용 ${s.reuseArtifacts}건·자산 공백 ${s.assetGap}건.`,
  gluttony: s => `삼킨다. 오래된 근거 ${s.knowledgeGap}건.`,
  envy: s => `못 뒤처져. 범위 공백 ${s.coverageGap}건.`,
  pride: s => `내 이름을 걸어. 검증 공백 ${s.verificationGap}건.`,
  lust: s => `지금 보여줘. 전달 공백 ${s.deliveryGap}건.`,
  wrath: s => `수선${s.repairNeed}·실패${s.ownFailures}·미확인${s.unknownCalls}.`,
  sloth: s => `쉬고 싶어. 예상 ${s.estimatedCalls}회·재사용 ${s.reuseArtifacts}건.`,
};

export function driveVoice(driveId, candidate, hunger) {
  const drive = DRIVE_CANON.find(item => item.id === driveId);
  if (!drive || !candidate?.motivation || !Number.isFinite(hunger) || hunger < 0 || hunger > 100) throw new TypeError('Invalid drive voice');
  validateMotivation(candidate.motivation);
  const voice = `${drive.legacyName}: ${evidence[driveId](candidate.motivation.signals)}`;
  if (voice.length > 120) throw new TypeError('Drive voice exceeds limit');
  return voice;
}

export function debateFor(ranked, hunger, at) {
  if (!Array.isArray(ranked) || !ranked.length || !exact(hunger, DRIVE_IDS) || !iso(at)) throw new TypeError('Invalid drive debate input');
  validateHunger(hunger);
  const candidate = ranked[0];
  validateMotivation(candidate.motivation);
  const voices = DRIVE_IDS.map((id, index) => ({driveId: id, text: driveVoice(id, candidate, hunger[id]), weightedScore: fixed(candidate.motivation.components[id] * (0.5 + hunger[id] / 100)), index}))
    .sort((a, b) => b.weightedScore - a.weightedScore || a.index - b.index)
    .slice(0, 3);
  if (voices.length !== 3) throw new TypeError('Drive debate requires three voices');
  const leader = voices[0].driveId, leaderName = DRIVE_CANON.find(drive => drive.id === leader).legacyName;
  return voices.map(({index, ...voice}, rank) => {
    const own = candidate.motivation.components[voice.driveId];
    const position = rank === 0 ? '[push] ' : '[contest] ';
    const argument = rank === 0 ? ' 내가 먼저야.' : ` ${leaderName}에 반대. 기여 ${own}, 차이 ${fixed(own - candidate.motivation.components[leader])}.`;
    let text = `${position}${voice.text}${argument}`;
    if (text.length > 120) {
      const compactArgument = rank === 0 ? '내가 먼저야.' : `${leaderName} 반대.기여 ${own},차이 ${fixed(own - candidate.motivation.components[leader])}.`;
      text = `${position.trim()}${DRIVE_CANON.find(drive => drive.id === voice.driveId).legacyName}:${compactEvidence[voice.driveId](candidate.motivation.signals)}${compactArgument}`;
    }
    if (text.length > 120) throw new TypeError('Drive voice exceeds limit');
    return {...voice, text};
  });
}

export function validateDriveVoices(voices) {
  if (!Array.isArray(voices) || voices.length !== 3 || new Set(voices.map(v => v.driveId)).size !== 3) throw new TypeError('Invalid drive voices');
  for (const voice of voices) if (!exact(voice, ['driveId','text','weightedScore']) || !DRIVE_IDS.includes(voice.driveId) || typeof voice.text !== 'string' || !voice.text || voice.text.length > 120 || !Number.isFinite(voice.weightedScore)) throw new TypeError('Invalid drive voice');
  return true;
}

export function validateDriveDebates(value) {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('Invalid drive debates');
  for (const entry of value) {
    const keys = ['at','source','goal','jobId','questId','voices','stateFingerprint'];
    const legacy = exact(entry, keys) || exact(entry, [...keys, 'hungryVoice']);
    const current = exact(entry, [...keys, 'hungryVoice', 'version', 'hungerSnapshot']) && [2, DRIVE_STATE_HUNGER_VERSION].includes(entry.version);
    if ((!legacy && !current) || !iso(entry.at) || !['owner','autopilot'].includes(entry.source) || typeof entry.goal !== 'string' || !entry.goal.trim() || entry.goal.length > 500 || (entry.jobId !== null && !UUID.test(entry.jobId)) || (entry.questId !== null && !UUID.test(entry.questId)) || !HASH.test(entry.stateFingerprint) || !Array.isArray(entry.voices) || entry.voices.length !== 3) throw new TypeError('Invalid drive debate');
    if (current) {
      validateHunger(entry.hungerSnapshot);
      if (entry.stateFingerprint !== fingerprint(entry.hungerSnapshot, entry.at, entry.version)) throw new TypeError('Drive debate snapshot fingerprint mismatch');
    }
    validateDriveVoices(entry.voices);
    if (entry.hungryVoice !== undefined && (!exact(entry.hungryVoice,['driveId','text']) || !DRIVE_IDS.includes(entry.hungryVoice.driveId) || typeof entry.hungryVoice.text !== 'string' || !entry.hungryVoice.text || entry.hungryVoice.text.length > 120)) throw new TypeError('Invalid hungry drive voice');
  }
  return true;
}

export function recordDriveDecision(state, decision, {at,source,jobId=null,questId=null}) {
  validateDriveState(state.driveState);
  validateDriveDebates(state.driveDebates);
  if (!decision?.top?.motivation || !['owner','autopilot'].includes(source) || (jobId !== null && !UUID.test(jobId)) || (questId !== null && !UUID.test(questId))) throw new TypeError('Invalid drive decision record');
  const voices = debateFor([decision.top], state.driveState.hunger, at).map(v=>({...v,text:withOutcome(v.text,state,v.driveId)}));
  const driveState = advanceHunger(state.driveState, decision, at,driveCues(state));
  const hungryId=DRIVE_IDS.reduce((best,id)=>driveState.hunger[id]>driveState.hunger[best]?id:best);
  const hungryVoice={driveId:hungryId,text:withOutcome(driveVoice(hungryId,decision.top,driveState.hunger[hungryId]),state,hungryId)};
  const debate = {version:DRIVE_STATE_HUNGER_VERSION,at,source,goal:decision.top.motivation.goal,jobId,questId,voices,hungryVoice,hungerSnapshot:{...driveState.hunger},stateFingerprint:driveState.fingerprint};
  const driveDebates = [...state.driveDebates,debate].slice(-100);
  validateDriveDebates(driveDebates);
  const driveAttempts=trackDriveAttempt(state,{jobId,questId,kind:source,drives:decision.top.motivation.dominantDrives,at});
  const settled=settleDriveOutcomes({...state,driveState,driveAttempts},at);
  return {...settled,driveAttempts,driveDebates,debate};
}

// C1 policy uses the existing lust delivery-gap increment; it is a priority,
// not an aesthetic or quality measurement. The caller deduplicates evidence.
export function recordBeautyGap(state, at) {
  validateDriveState(state);
  if (!iso(at) || Date.parse(at) < Date.parse(state.updatedAt)) throw new TypeError('Invalid beauty observation time');
  const hunger={...state.hunger,lust:clamp(state.hunger.lust+HUNGER_RULES_V2.lust.gapRise)};
  return {...state,hunger,updatedAt:at,fingerprint:fingerprint(hunger,at,state.version)};
}

function withOutcome(text,state,id){const suffix=outcomeSpeech(state,id);return suffix?text.slice(0,120-suffix.length)+suffix:text;}
export function applyDriveEffects(state,effects,at){validateDriveState(state);if(!iso(at)||Date.parse(at)<Date.parse(state.updatedAt))throw new TypeError('Invalid drive effect time');const hunger=Object.fromEntries(DRIVE_IDS.map(d=>[d,clamp(state.hunger[d]+(effects[d]??0))]));return {version:3,hunger,updatedAt:at,fingerprint:fingerprint(hunger,at,3)};}
export function advanceHunger(state,decision,at,cues={}){const v2=advanceHungerV2(state,decision,at);const effects=Object.fromEntries(DRIVE_IDS.map(d=>[d,decision.top.motivation.dominantDrives.includes(d)?Math.round(HUNGER_RULES_V2[d].fed/3):v2.hunger[d]-state.hunger[d]]));for(const d of DRIVE_IDS)effects[d]+=Math.min(cues[d]??0,HUNGER_RULES_V3.cueLimit)*HUNGER_RULES_V3.cueUnit;return applyDriveEffects(state,effects,at);}
