import crypto from 'node:crypto';
import {assertNoSecrets} from './outcome-verification.mjs';

// BLACKHOLE Gemini Live transport leaf (pure session state + wire codec, no wiring).
//
// Endpoint/message names follow the Live API reference (BidiGenerateContent
// over WebSocket): client sends `setup` → `realtimeInput{audio}` /
// `clientContent` / `toolResponse`; server sends `setupComplete`,
// `serverContent{modelTurn|interrupted|turnComplete|...}`, `toolCall`,
// `toolCallCancellation`, `sessionResumptionUpdate{newHandle,resumable}`,
// `goAway{timeLeft}`. Audio in is 16 kHz PCM16 mono, audio out 24 kHz PCM16.
//
// This module holds NO credential. The socket factory the caller injects is
// what carries auth (ephemeral token or owner key) and the transport only
// records whether that factory was the process default (`network`) or an
// injected one (`injected`). A tool call from the model is an *ask*, never an
// action: it is queued as `pending_authority` and executed only after the
// existing runtime authority path settles it; the same call id can never run
// twice, and interruption cancels queued asks that were not yet authorized.
export const GEMINI_LIVE_VERSION = 1;
export const LIVE_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export const INPUT_AUDIO_MIME = 'audio/pcm;rate=16000';
export const OUTPUT_AUDIO_MIME = 'audio/pcm;rate=24000';
export const SESSION_STATES = Object.freeze(['idle', 'connecting', 'setup_sent', 'open', 'reconnecting', 'closed', 'blocked']);
export const TOOL_CALL_STATES = Object.freeze(['pending_authority', 'authorized', 'denied', 'cancelled', 'responded']);
export const SESSION_FIELDS = Object.freeze(['version', 'liveId', 'model', 'state', 'transportKind', 'resumeHandle', 'resumable', 'goAwayAt', 'turns', 'toolCalls', 'interruptions', 'reconnects', 'generation', 'events', 'fingerprint']);
export const MAX_EVENTS = 200;
export const MAX_AUDIO_CHUNK_BYTES = 64 * 1024;
// A runtime authority verdict is only good for an action taken right after it
// was computed - not a cached decision from earlier in the turn. `checkedAt`
// older than this (or dated after `at`, which is not a real clock reading)
// is never authority for a new action.
export const MAX_VERDICT_AGE_MS = 5_000;

// --- future-wiring contract (enforced here, executed by the caller later) --
//
// When a real executor (server.mjs) is wired to `tool_ask`/authorized calls,
// it MUST:
//   - carry a durable requestId through to whatever mutating action the tool
//     performs, so the SAME action is never applied twice (replay, reconnect,
//     retry all land on the same durable record);
//   - re-check runtime authority (emergency stop, owner approval, quota)
//     immediately before the mutating step, not once at `settleToolCall` time
//     - `settleToolCall` itself enforces this is fresh (MAX_VERDICT_AGE_MS)
//     but a slow executor must re-derive its own verdict just before acting;
//   - pass any cancellable local work (a spawned job, a sandboxed run) an
//     AbortSignal tied to this session's generation, so a barge-in/close can
//     stop CPU/IO work that has not left the process yet;
//   - NEVER read a `cancelled` toolCall state as "nothing happened": a call
//     whose `authorizedOnce` is true was greenlit to run for real before the
//     cancellation landed, so its durable side effect (job/quest/artifact) -
//     if any - stands and must be reconciled from actual state, never
//     assumed away. `toolResponseMessage`'s `sideEffectMayHaveOccurred` flag
//     makes this explicit instead of leaving it to convention.
// This module cannot enforce the executor's own conduct - it can only refuse
// to hand out a stale or ambiguous authorization and refuse to let a caller
// forget which calls were ever authorized.
const MODEL_ID = /^gemini-[a-z0-9.-]{1,80}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);
const sha256 = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');

export class GeminiLiveError extends Error {
  constructor(message, code = 'LIVE_INVALID') {super(message); this.code = code;}
}
const fail = (message, code) => {throw new GeminiLiveError(message, code);};
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function sessionFingerprint(session) {
  const {fingerprint, ...rest} = session;
  return sha256(rest);
}

// The Live model is owner-declared routing output (Brain Pool `audioLive`
// candidate), never a default baked in here: a model this module picked on its
// own would be an unverified claim about what the provider currently serves.
export function createLiveSession({liveId, model, transportKind, at}) {
  if (!ID.test(liveId ?? '')) fail('liveId가 올바르지 않습니다.');
  if (!MODEL_ID.test(model ?? '')) fail('Live model은 라우터가 선택한 gemini-* 모델 ID여야 합니다.');
  if (!['network', 'injected'].includes(transportKind)) fail('transportKind는 network|injected여야 합니다.');
  if (!ISO.test(at)) fail('at은 ISO 시각이어야 합니다.');
  const session = {
    version: GEMINI_LIVE_VERSION, liveId, model, state: 'idle', transportKind, resumeHandle: null, resumable: false, goAwayAt: null,
    turns: 0, toolCalls: [], interruptions: 0, reconnects: 0, generation: 0, events: [{at, type: 'created'}], fingerprint: null
  };
  session.fingerprint = sessionFingerprint(session);
  return session;
}

export function validateLiveSession(session) {
  if (!exact(session, SESSION_FIELDS)) fail(`Live session은 정확히 ${SESSION_FIELDS.join(', ')} 필드를 가져야 합니다.`);
  if (session.version !== GEMINI_LIVE_VERSION || !ID.test(session.liveId) || !MODEL_ID.test(session.model)) fail('Live session 값이 올바르지 않습니다.');
  if (!SESSION_STATES.includes(session.state) || !['network', 'injected'].includes(session.transportKind)) fail('Live session 상태가 올바르지 않습니다.');
  if (session.resumeHandle !== null && (typeof session.resumeHandle !== 'string' || !session.resumeHandle)) fail('resumeHandle이 올바르지 않습니다.');
  if (!Number.isInteger(session.generation) || session.generation < 0) fail('generation이 올바르지 않습니다.');
  if (!Array.isArray(session.toolCalls) || !session.toolCalls.every(t => exact(t, ['id', 'name', 'argsSha256', 'state', 'generation', 'authorizedOnce', 'at']) && ID.test(t.id) && Number.isInteger(t.generation) && t.generation >= 0 && t.generation <= session.generation && TOOL_CALL_STATES.includes(t.state) && typeof t.authorizedOnce === 'boolean')) fail('toolCalls가 올바르지 않습니다.');
  // Once a call is (or ever was) authorized, that fact can never be erased by
  // a later transition (cancellation, response) - a downstream reader must
  // always be able to tell "may have run for real" from "never authorized".
  if (session.toolCalls.some(t => t.state === 'authorized' && !t.authorizedOnce)) fail('authorized toolCall은 authorizedOnce여야 합니다.', 'LIVE_TAMPERED');
  if (new Set(session.toolCalls.map(t => t.id)).size !== session.toolCalls.length) fail('toolCall id가 중복됩니다.', 'LIVE_DUPLICATE_TOOL_CALL');
  if (!Array.isArray(session.events) || session.events.length > MAX_EVENTS || !session.events.every(e => ISO.test(e.at) && typeof e.type === 'string')) fail('events가 올바르지 않습니다.');
  assertNoSecrets(session, 'liveSession');
  if (session.fingerprint !== sessionFingerprint(session)) fail('Live session 지문이 다릅니다.', 'LIVE_TAMPERED');
  return true;
}

const withEvent = (session, at, type, patch = {}) => {
  const events = [...session.events, {at, type}].slice(-MAX_EVENTS);
  const next = {...session, ...patch, events, fingerprint: null};
  next.fingerprint = sessionFingerprint(next);
  return next;
};

// --- outbound (client → server) --------------------------------------------

// Setup carries model + generation config + tool declarations + a resumption
// handle when we have one. `systemInstruction` is the caller's Jarvis persona;
// nothing here is a separate chatbot prompt.
export function setupMessage(session, {systemInstruction = null, tools = [], voiceName = null, languageCode = 'ko-KR', transcribe = true} = {}) {
  if (!Array.isArray(tools) || !tools.every(t => t && typeof t.name === 'string' && ID.test(t.name) && t.parameters && typeof t.parameters === 'object')) fail('tool 선언이 올바르지 않습니다.');
  const setup = {
    model: `models/${session.model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        languageCode,
        ...(voiceName ? {voiceConfig: {prebuiltVoiceConfig: {voiceName}}} : {})
      }
    },
    ...(systemInstruction ? {systemInstruction: {parts: [{text: systemInstruction}]}} : {}),
    ...(tools.length ? {tools: [{functionDeclarations: tools.map(t => ({name: t.name, description: t.description ?? '', parameters: t.parameters}))}]} : {}),
    ...(transcribe ? {inputAudioTranscription: {}, outputAudioTranscription: {}} : {}),
    realtimeInputConfig: {automaticActivityDetection: {disabled: false}},
    sessionResumption: session.resumeHandle ? {handle: session.resumeHandle} : {},
    contextWindowCompression: {slidingWindow: {}}
  };
  assertNoSecrets({systemInstruction, tools}, 'setup');
  return {setup};
}

export function audioChunkMessage(pcm16Base64) {
  if (typeof pcm16Base64 !== 'string' || !pcm16Base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(pcm16Base64)) fail('audio chunk는 base64 PCM16이어야 합니다.');
  if (Buffer.byteLength(pcm16Base64, 'base64') > MAX_AUDIO_CHUNK_BYTES) fail('audio chunk가 너무 큽니다.');
  return {realtimeInput: {audio: {mimeType: INPUT_AUDIO_MIME, data: pcm16Base64}}};
}
export const audioStreamEndMessage = () => ({realtimeInput: {audioStreamEnd: true}});
export const activityStartMessage = () => ({realtimeInput: {activityStart: {}}});
export const activityEndMessage = () => ({realtimeInput: {activityEnd: {}}});

export function textTurnMessage(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) fail('text turn이 올바르지 않습니다.');
  return {clientContent: {turns: [{role: 'user', parts: [{text}]}], turnComplete: true}};
}

// --- inbound (server → client) ----------------------------------------------

function classifyServer(message) {
  if (!message || typeof message !== 'object') return {type: 'unknown'};
  if (message.setupComplete) return {type: 'setup_complete'};
  if (message.goAway) return {type: 'go_away', timeLeft: message.goAway.timeLeft ?? null};
  if (message.sessionResumptionUpdate) return {type: 'resumption', handle: message.sessionResumptionUpdate.newHandle ?? null, resumable: message.sessionResumptionUpdate.resumable === true};
  if (message.toolCallCancellation) return {type: 'tool_cancel', ids: Array.isArray(message.toolCallCancellation.ids) ? message.toolCallCancellation.ids : []};
  if (message.toolCall) return {type: 'tool_call', calls: Array.isArray(message.toolCall.functionCalls) ? message.toolCall.functionCalls : []};
  if (message.serverContent) {
    const c = message.serverContent;
    const parts = Array.isArray(c.modelTurn?.parts) ? c.modelTurn.parts : [];
    return {
      type: 'content', interrupted: c.interrupted === true, turnComplete: c.turnComplete === true,
      audio: parts.filter(p => p.inlineData && typeof p.inlineData.data === 'string' && String(p.inlineData.mimeType ?? '').startsWith('audio/pcm')).map(p => p.inlineData.data),
      text: parts.filter(p => typeof p.text === 'string').map(p => p.text),
      inputTranscription: c.inputTranscription?.text ?? null, outputTranscription: c.outputTranscription?.text ?? null
    };
  }
  return {type: 'unknown'};
}

// Apply one server message. Returns {session, effects}. Effects are what the
// caller (Jarvis voice path) should do — play audio, drop the playback buffer
// on interruption, submit tool asks to the authority path, reconnect.
export function applyServerMessage(session, message, {at}) {
  validateLiveSession(session);
  if (!ISO.test(at)) fail('at은 ISO 시각이어야 합니다.');
  const m = classifyServer(message);
  const effects = [];
  switch (m.type) {
    case 'setup_complete':
      if (!['setup_sent', 'reconnecting'].includes(session.state)) fail('setup 전에 setupComplete가 왔습니다.', 'LIVE_PROTOCOL');
      return {session: withEvent(session, at, 'open', {state: 'open'}), effects};
    case 'go_away':
      effects.push({kind: 'prepare_reconnect', timeLeft: m.timeLeft});
      return {session: withEvent(session, at, 'go_away', {goAwayAt: at}), effects};
    case 'resumption':
      return {session: withEvent(session, at, 'resumption', {resumeHandle: m.handle ?? session.resumeHandle, resumable: m.resumable}), effects};
    case 'tool_cancel': {
      const ids = new Set(m.ids);
      const toolCalls = session.toolCalls.map(t => ids.has(t.id) && t.state === 'pending_authority' ? {...t, state: 'cancelled', at} : t);
      effects.push({kind: 'tool_cancelled', ids: [...ids]});
      return {session: withEvent(session, at, 'tool_cancel', {toolCalls}), effects};
    }
    case 'tool_call': {
      const known = new Set(session.toolCalls.map(t => t.id));
      const toolCalls = [...session.toolCalls];
      for (const call of m.calls) {
        if (!ID.test(call?.id ?? '') || !ID.test(call?.name ?? '')) fail('toolCall 형식이 올바르지 않습니다.', 'LIVE_PROTOCOL');
        if (known.has(call.id)) {effects.push({kind: 'tool_duplicate_ignored', id: call.id}); continue;}
        known.add(call.id);
        const args = call.args && typeof call.args === 'object' ? call.args : {};
        assertNoSecrets(args, `toolCall.${call.id}`);
        toolCalls.push({id: call.id, name: call.name, argsSha256: sha256(args), state: 'pending_authority', generation: session.generation, authorizedOnce: false, at});
        effects.push({kind: 'tool_ask', id: call.id, name: call.name, args});
      }
      return {session: withEvent(session, at, 'tool_call', {toolCalls}), effects};
    }
    case 'content': {
      let next = session;
      if (m.interrupted) {
        effects.push({kind: 'drop_playback'});
        const toolCalls = next.toolCalls.map(t => t.state === 'pending_authority' ? {...t, state: 'cancelled', at} : t);
        next = withEvent(next, at, 'interrupted', {interruptions: next.interruptions + 1, generation: next.generation + 1, toolCalls});
      }
      if (m.audio.length) effects.push({kind: 'play_audio', mimeType: OUTPUT_AUDIO_MIME, chunks: m.audio});
      if (m.inputTranscription) effects.push({kind: 'transcript', role: 'user', text: m.inputTranscription});
      if (m.outputTranscription) effects.push({kind: 'transcript', role: 'model', text: m.outputTranscription});
      if (m.turnComplete) next = withEvent(next, at, 'turn_complete', {turns: next.turns + 1});
      return {session: next, effects};
    }
    default:
      return {session: withEvent(session, at, 'unknown_message'), effects};
  }
}

// --- tool authority bridge ---------------------------------------------------

// The model's tool ask goes through the runtime's authority verdict (the same
// path owner commands take). Only `authorized` may be executed, exactly once;
// a responded call cannot be re-authorized. `verdict.allowed` is the runtime's
// word, never the model's.
// A verdict must come from the runtime authority path (`checkedAt` is its
// timestamp); emergency stop in the verdict always denies; a call from an
// earlier generation (before an interruption/close/reconnect) is cancelled,
// never authorized.
export function settleToolCall(session, {id, verdict, at, maxVerdictAgeMs = MAX_VERDICT_AGE_MS}) {
  validateLiveSession(session);
  const call = session.toolCalls.find(t => t.id === id);
  if (!call) fail('알 수 없는 toolCall id입니다.', 'LIVE_UNKNOWN_TOOL_CALL');
  if (call.state !== 'pending_authority') fail(`toolCall ${id}는 이미 ${call.state} 상태입니다.`, 'LIVE_DUPLICATE_TOOL_CALL');
  if (!verdict || typeof verdict.allowed !== 'boolean' || !ISO.test(verdict.checkedAt ?? '')) fail('runtime authority verdict({allowed, checkedAt})가 필요합니다.');
  if (!ISO.test(at)) fail('at은 ISO 시각이어야 합니다.');
  if (call.generation !== session.generation) {
    const toolCalls = session.toolCalls.map(t => t.id === id ? {...t, state: 'cancelled', at} : t);
    return withEvent(session, at, 'tool_stale_cancelled', {toolCalls});
  }
  // A verdict computed too long ago (or timestamped after `at`, which is not
  // a real clock reading) is not "checked immediately before execution" -
  // treat it exactly like a denial rather than trust a cached decision.
  const verdictAgeMs = Date.parse(at) - Date.parse(verdict.checkedAt);
  const fresh = Number.isFinite(verdictAgeMs) && verdictAgeMs >= 0 && verdictAgeMs <= maxVerdictAgeMs;
  const allowed = fresh && verdict.allowed && verdict.emergencyStop !== true;
  const state = allowed ? 'authorized' : 'denied';
  const toolCalls = session.toolCalls.map(t => t.id === id ? {...t, state, authorizedOnce: t.authorizedOnce || allowed, at} : t);
  return withEvent(session, at, `tool_${state}`, {toolCalls});
}

// Build the toolResponse for a settled call and mark it responded. Denied and
// cancelled calls answer with a structured refusal so the model is told the
// truth instead of being left waiting; nothing executes for them.
// `executed` is only possible for an authorized call of the *current*
// generation while the session is open and no emergency stop is in force; a
// result arriving late (after barge-in, close or reconnect) is reported as
// cancelled and its `result` is dropped, so it can never act on a new turn.
export function toolResponseMessage(session, {id, result = null, at, emergencyStop = false}) {
  validateLiveSession(session);
  const call = session.toolCalls.find(t => t.id === id);
  if (!call) fail('알 수 없는 toolCall id입니다.', 'LIVE_UNKNOWN_TOOL_CALL');
  if (call.state === 'responded') fail(`toolCall ${id}에 이미 응답했습니다.`, 'LIVE_DUPLICATE_TOOL_CALL');
  if (call.state === 'pending_authority') fail(`toolCall ${id}는 authority 판정 전입니다.`, 'LIVE_UNAUTHORIZED_TOOL');
  let status = call.state;
  let reason = call.state === 'denied' ? 'owner_approval_or_authority_required' : 'cancelled_by_interruption';
  if (status === 'authorized' && (call.generation !== session.generation || session.state !== 'open')) {status = 'cancelled'; reason = 'stale_generation';}
  if (status === 'authorized' && emergencyStop === true) {status = 'cancelled'; reason = 'emergency_stop';}
  const response = status === 'authorized' ? {status: 'executed', result} : {status, result: null, reason};
  assertNoSecrets(response, `toolResponse.${id}`);
  const toolCalls = session.toolCalls.map(t => t.id === id ? {...t, state: 'responded', at} : t);
  return {
    session: withEvent(session, at, 'tool_responded', {toolCalls}),
    message: {toolResponse: {functionResponses: [{id, name: call.name, response}]}},
    // true exactly when this call was ever authorized (`authorizedOnce`) but
    // we are reporting something other than "executed" to Gemini - i.e. a
    // real durable side effect may exist even though this turn does not
    // relay it. The wiring layer must reconcile via the actual job/quest
    // record, never assume "cancelled" means "nothing happened".
    sideEffectMayHaveOccurred: call.authorizedOnce === true && status !== 'authorized'
  };
}

// --- lifecycle ------------------------------------------------------------------

// Opening/reconnecting is gated by the runtime authority verdict the caller
// already computed (emergency stop, provider config, budget). A closed socket
// with a resumable handle reconnects with the same session identity; without a
// handle it is a fresh session (turns/toolCalls history kept for audit).
export function openTransition(session, {authority, at}) {
  validateLiveSession(session);
  if (!authority || authority.allowed !== true) return withEvent(session, at, 'blocked', {state: 'blocked'});
  if (!['idle', 'closed', 'blocked'].includes(session.state)) fail(`state ${session.state}에서는 열 수 없습니다.`, 'LIVE_PROTOCOL');
  const reconnect = session.state === 'closed' && session.resumable && session.resumeHandle;
  return withEvent(session, at, reconnect ? 'reconnecting' : 'connecting', {state: reconnect ? 'reconnecting' : 'connecting', reconnects: session.reconnects + (reconnect ? 1 : 0), generation: session.generation + 1});
}
export function setupSentTransition(session, {at}) {
  validateLiveSession(session);
  if (session.state !== 'connecting') fail('connecting 상태에서만 setup을 보냅니다.', 'LIVE_PROTOCOL');
  return withEvent(session, at, 'setup_sent', {state: 'setup_sent'});
}
export function closeTransition(session, {at, reason = 'closed'}) {
  validateLiveSession(session);
  const toolCalls = session.toolCalls.map(t => t.state === 'pending_authority' ? {...t, state: 'cancelled', at} : t);
  return withEvent(session, at, reason, {state: 'closed', toolCalls, generation: session.generation + 1});
}

// Readiness in the shared taxonomy. Only a session that actually reached
// `open` over the process-default network transport counts as live evidence.
export function liveVoiceReadiness(sessions) {
  const list = (sessions ?? []).filter(s => {try {validateLiveSession(s); return true;} catch {return false;}});
  if (list.length === 0) return {status: 'NOT_WIRED', reason: 'no_live_session'};
  const opened = list.filter(s => s.events.some(e => e.type === 'open'));
  if (opened.some(s => s.transportKind === 'network')) return {status: 'LIVE_VERIFIED', reason: null};
  if (opened.length) return {status: 'SYNTHETIC_VERIFIED', reason: 'injected_transport_only'};
  if (list.every(s => s.state === 'blocked')) return {status: 'BLOCKED', reason: 'authority_blocked'};
  return {status: 'WIRED_UNVERIFIED', reason: 'no_open_session'};
}
