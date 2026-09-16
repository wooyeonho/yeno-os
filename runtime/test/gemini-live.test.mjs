import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_ENDPOINT, INPUT_AUDIO_MIME, OUTPUT_AUDIO_MIME,
  createLiveSession, validateLiveSession, setupMessage, audioChunkMessage, textTurnMessage,
  applyServerMessage, settleToolCall, toolResponseMessage,
  openTransition, setupSentTransition, closeTransition, liveVoiceReadiness,
  sessionFingerprint} from '../lib/gemini-live.mjs';

const T = i => `2026-09-16T10:00:${String(i).padStart(2, '0')}.000Z`;
const fresh = (kind = 'injected') => createLiveSession({liveId: 'live-1', model: 'gemini-2.5-flash-native-audio-preview-12-2025', transportKind: kind, at: T(0)});
const opened = (kind = 'injected') => {
  let s = openTransition(fresh(kind), {authority: {allowed: true}, at: T(1)});
  s = setupSentTransition(s, {at: T(2)});
  return applyServerMessage(s, {setupComplete: {}}, {at: T(3)}).session;
};

test('session contract: router-declared model, no baked default, fingerprint fails closed, no secrets', () => {
  const s = fresh();
  assert.equal(validateLiveSession(s), true);
  assert.equal(LIVE_ENDPOINT.startsWith('wss://generativelanguage.googleapis.com/ws/'), true);
  assert.throws(() => createLiveSession({liveId: 'x', model: 'gpt-4o-realtime', transportKind: 'network', at: T(0)}), /gemini-/);
  assert.throws(() => createLiveSession({liveId: 'x', model: '', transportKind: 'network', at: T(0)}), /gemini-/);
  assert.throws(() => validateLiveSession({...s, turns: 9}), e => e.code === 'LIVE_TAMPERED');
  const setup = setupMessage(s, {systemInstruction: 'Jarvis', tools: [{name: 'run_quest', parameters: {type: 'object'}}], voiceName: 'Aoede'});
  assert.equal(setup.setup.model, `models/${s.model}`);
  assert.deepEqual(setup.setup.generationConfig.responseModalities, ['AUDIO']);
  assert.equal(setup.setup.generationConfig.speechConfig.languageCode, 'ko-KR');
  assert.deepEqual(setup.setup.sessionResumption, {});
  assert.equal(setup.setup.tools[0].functionDeclarations[0].name, 'run_quest');
  assert.doesNotMatch(JSON.stringify(setup), /key|token/i);
  assert.throws(() => setupMessage(s, {tools: [{name: 'x', parameters: {type: 'object'}, apiKey: 'AIzaSy'}]}), /toolCall|비밀|secret|자격/i);
});

test('audio codec: 16 kHz PCM16 in, 24 kHz out, bounded chunks, text turn fallback', () => {
  const chunk = audioChunkMessage(Buffer.alloc(3200).toString('base64'));
  assert.equal(chunk.realtimeInput.audio.mimeType, INPUT_AUDIO_MIME);
  assert.throws(() => audioChunkMessage(Buffer.alloc(70000).toString('base64')), /너무 큽니다/);
  assert.throws(() => audioChunkMessage('not base64!!'), /base64/);
  assert.equal(textTurnMessage('안녕').clientContent.turnComplete, true);
  const s = opened();
  const {effects} = applyServerMessage(s, {serverContent: {modelTurn: {parts: [{inlineData: {mimeType: 'audio/pcm;rate=24000', data: 'AAAA'}}]}, outputTranscription: {text: '네'}}}, {at: T(4)});
  assert.deepEqual(effects.map(e => e.kind), ['play_audio', 'transcript']);
  assert.equal(effects[0].mimeType, OUTPUT_AUDIO_MIME);
});

test('lifecycle: authority gate blocks open, setupComplete only after setup, goAway → prepare_reconnect, resume handle reused on reconnect', () => {
  const blocked = openTransition(fresh(), {authority: {allowed: false, blockers: ['emergency_stop']}, at: T(1)});
  assert.equal(blocked.state, 'blocked');
  assert.throws(() => applyServerMessage(openTransition(fresh(), {authority: {allowed: true}, at: T(1)}), {setupComplete: {}}, {at: T(2)}), e => e.code === 'LIVE_PROTOCOL');
  let s = opened();
  assert.equal(s.state, 'open');
  s = applyServerMessage(s, {sessionResumptionUpdate: {newHandle: 'h-123', resumable: true}}, {at: T(4)}).session;
  const ga = applyServerMessage(s, {goAway: {timeLeft: '10s'}}, {at: T(5)});
  assert.deepEqual(ga.effects, [{kind: 'prepare_reconnect', timeLeft: '10s'}]);
  s = closeTransition(ga.session, {at: T(6), reason: 'socket_closed'});
  s = openTransition(s, {authority: {allowed: true}, at: T(7)});
  assert.equal(s.state, 'reconnecting');
  assert.equal(s.reconnects, 1);
  assert.deepEqual(setupMessage(s).setup.sessionResumption, {handle: 'h-123'});
  s = applyServerMessage(s, {setupComplete: {}}, {at: T(8)}).session;
  assert.equal(s.state, 'open');
  assert.equal(validateLiveSession(s), true);
  const noHandle = openTransition(closeTransition(opened(), {at: T(4)}), {authority: {allowed: true}, at: T(5)});
  assert.equal(noHandle.state, 'connecting', 'no resumable handle → fresh connect, not reconnect');
});

test('tool calls: pending until runtime authority; duplicates ignored; exactly one response; denied never executes', () => {
  let s = opened();
  const call = {toolCall: {functionCalls: [{id: 'c1', name: 'run_quest', args: {questId: 'q'}}]}};
  const first = applyServerMessage(s, call, {at: T(4)});
  assert.deepEqual(first.effects, [{kind: 'tool_ask', id: 'c1', name: 'run_quest', args: {questId: 'q'}}]);
  assert.equal(first.session.toolCalls[0].state, 'pending_authority');
  const dup = applyServerMessage(first.session, call, {at: T(5)});
  assert.deepEqual(dup.effects, [{kind: 'tool_duplicate_ignored', id: 'c1'}]);
  assert.equal(dup.session.toolCalls.length, 1);
  assert.throws(() => toolResponseMessage(dup.session, {id: 'c1', result: {}, at: T(6)}), e => e.code === 'LIVE_UNAUTHORIZED_TOOL');
  s = settleToolCall(dup.session, {id: 'c1', verdict: {allowed: true, checkedAt: T(5)}, at: T(6)});
  assert.throws(() => settleToolCall(s, {id: 'c1', verdict: {allowed: true, checkedAt: T(5)}, at: T(6)}), e => e.code === 'LIVE_DUPLICATE_TOOL_CALL');
  const resp = toolResponseMessage(s, {id: 'c1', result: {jobId: 'j1'}, at: T(7)});
  assert.equal(resp.message.toolResponse.functionResponses[0].response.status, 'executed');
  assert.throws(() => toolResponseMessage(resp.session, {id: 'c1', result: {}, at: T(8)}), e => e.code === 'LIVE_DUPLICATE_TOOL_CALL');
  let d = applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'c2', name: 'deploy', args: {}}]}}, {at: T(4)}).session;
  d = settleToolCall(d, {id: 'c2', verdict: {allowed: false, blockers: ['owner_approval_required'], checkedAt: T(5)}, at: T(5)});
  const denied = toolResponseMessage(d, {id: 'c2', at: T(6)});
  assert.equal(denied.message.toolResponse.functionResponses[0].response.status, 'denied');
  assert.equal(denied.message.toolResponse.functionResponses[0].response.reason, 'owner_approval_or_authority_required');
  assert.throws(() => applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'c3', name: 'x', args: {apiKey: 'sk-abc'}}]}}, {at: T(4)}), /toolCall\.c3|자격|secret/i);
});

test('barge-in: interruption drops playback and cancels un-authorized asks; server cancellation likewise; authorized calls survive', () => {
  let s = applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'a', name: 'x', args: {}}, {id: 'b', name: 'y', args: {}}]}}, {at: T(4)}).session;
  s = settleToolCall(s, {id: 'b', verdict: {allowed: true, checkedAt: T(5)}, at: T(5)});
  const bi = applyServerMessage(s, {serverContent: {interrupted: true}}, {at: T(6)});
  assert.deepEqual(bi.effects, [{kind: 'drop_playback'}]);
  assert.equal(bi.session.interruptions, 1);
  assert.equal(bi.session.toolCalls.find(t => t.id === 'a').state, 'cancelled');
  assert.equal(bi.session.toolCalls.find(t => t.id === 'b').state, 'authorized');
  const cancelled = toolResponseMessage(bi.session, {id: 'a', at: T(7)});
  assert.equal(cancelled.message.toolResponse.functionResponses[0].response.status, 'cancelled');
  const sc = applyServerMessage(applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'z', name: 'x', args: {}}]}}, {at: T(4)}).session,
    {toolCallCancellation: {ids: ['z']}}, {at: T(5)});
  assert.equal(sc.session.toolCalls[0].state, 'cancelled');
  const closed = closeTransition(applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'q', name: 'x', args: {}}]}}, {at: T(4)}).session, {at: T(5)});
  assert.equal(closed.toolCalls[0].state, 'cancelled');
});

test('generation binding: authorized result arriving after barge-in/close/reconnect is reported cancelled (stale_generation), result dropped; emergency stop verdict denies; emergency stop at response time cancels', () => {
  let s = applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'b', name: 'y', args: {}}, {id: 'c', name: 'y', args: {}}]}}, {at: T(4)}).session;
  s = settleToolCall(s, {id: 'b', verdict: {allowed: true, checkedAt: T(5)}, at: T(5)});
  const g = s.generation;
  const bi = applyServerMessage(s, {serverContent: {interrupted: true}}, {at: T(6)}).session;
  assert.equal(bi.generation, g + 1);
  const late = toolResponseMessage(bi, {id: 'b', result: {did: 'something'}, at: T(7)});
  assert.deepEqual(late.message.toolResponse.functionResponses[0].response, {status: 'cancelled', result: null, reason: 'stale_generation'});
  assert.equal(late.session.toolCalls.find(t => t.id === 'b').state, 'responded');
  // Settling a pre-interruption ask after the interruption never authorizes it.
  const s2 = applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'd', name: 'y', args: {}}]}}, {at: T(4)}).session;
  const bumped = {...s2, generation: s2.generation + 1, fingerprint: null};
  bumped.fingerprint = sessionFingerprint(bumped);
  assert.equal(settleToolCall(bumped, {id: 'd', verdict: {allowed: true, checkedAt: T(5)}, at: T(5)}).toolCalls[0].state, 'cancelled');
  // Close + reconnect bump the generation, so an authorized call cannot execute on the new socket.
  const closed = closeTransition(s, {at: T(6)});
  assert.equal(closed.generation, g + 1);
  assert.equal(toolResponseMessage(closed, {id: 'b', result: {}, at: T(7)}).message.toolResponse.functionResponses[0].response.status, 'cancelled');
  const reopened = openTransition(closed, {authority: {allowed: true}, at: T(8)});
  assert.equal(reopened.generation, g + 2);
  // Verdict without checkedAt is not a runtime verdict; emergencyStop in verdict denies.
  assert.throws(() => settleToolCall(s, {id: 'c', verdict: {allowed: true}, at: T(5)}), e => e.code === 'LIVE_INVALID');
  const es = settleToolCall(s, {id: 'c', verdict: {allowed: true, emergencyStop: true, checkedAt: T(5)}, at: T(5)});
  assert.equal(es.toolCalls.find(t => t.id === 'c').state, 'denied');
  // Emergency stop raised between authorization and response cancels execution.
  const stopped = toolResponseMessage(s, {id: 'b', result: {x: 1}, at: T(6), emergencyStop: true});
  assert.deepEqual(stopped.message.toolResponse.functionResponses[0].response, {status: 'cancelled', result: null, reason: 'emergency_stop'});
  // Same generation, open, no stop → executes exactly once.
  const ok = toolResponseMessage(s, {id: 'b', result: {x: 1}, at: T(6)});
  assert.equal(ok.message.toolResponse.functionResponses[0].response.status, 'executed');
  assert.throws(() => toolResponseMessage(ok.session, {id: 'b', result: {x: 1}, at: T(7)}), e => e.code === 'LIVE_DUPLICATE_TOOL_CALL');
});

test('runtime authority must be fresh: a stale cached verdict denies exactly like a real denial, never authorizes', () => {
  let s = applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'stale-verdict', name: 'run_quest', args: {}}]}}, {at: T(4)}).session;
  // checkedAt is 10s before `at`, past MAX_VERDICT_AGE_MS(5s) - not "immediately before".
  const staleAt = new Date(Date.parse(T(4)) + 10_000).toISOString();
  s = settleToolCall(s, {id: 'stale-verdict', verdict: {allowed: true, checkedAt: T(4)}, at: staleAt});
  assert.equal(s.toolCalls[0].state, 'denied');
  assert.equal(s.toolCalls[0].authorizedOnce, false, 'a stale verdict never marks the call as ever-authorized');
  // A verdict dated in the future relative to `at` is not a real check either.
  let s2 = applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'future-verdict', name: 'run_quest', args: {}}]}}, {at: T(4)}).session;
  s2 = settleToolCall(s2, {id: 'future-verdict', verdict: {allowed: true, checkedAt: T(9)}, at: T(4)});
  assert.equal(s2.toolCalls[0].state, 'denied');
  // A fresh verdict just inside the window still authorizes normally.
  let s3 = applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'fresh', name: 'run_quest', args: {}}]}}, {at: T(4)}).session;
  const withinWindow = new Date(Date.parse(T(4)) + 2000).toISOString();
  s3 = settleToolCall(s3, {id: 'fresh', verdict: {allowed: true, checkedAt: T(4)}, at: withinWindow});
  assert.equal(s3.toolCalls[0].state, 'authorized');
  assert.equal(s3.toolCalls[0].authorizedOnce, true);
});

test('side-effect tracking: a call that was ever authorized keeps that fact through cancellation, so the wiring layer never mistakes "not relayed" for "never ran"', () => {
  let s = applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'never-authorized', name: 'x', args: {}}, {id: 'was-authorized', name: 'y', args: {}}]}}, {at: T(4)}).session;
  s = settleToolCall(s, {id: 'never-authorized', verdict: {allowed: false, checkedAt: T(4)}, at: T(4)});
  s = settleToolCall(s, {id: 'was-authorized', verdict: {allowed: true, checkedAt: T(4)}, at: T(4)});
  assert.equal(s.toolCalls.find(t => t.id === 'was-authorized').authorizedOnce, true);
  assert.equal(s.toolCalls.find(t => t.id === 'never-authorized').authorizedOnce, false);
  // A denial never reported as executed carries no ambiguity - nothing ran.
  const denied = toolResponseMessage(s, {id: 'never-authorized', at: T(5)});
  assert.equal(denied.sideEffectMayHaveOccurred, false);
  // Barge-in survives an already-authorized call (it may already be running)
  // but bumps the session generation, so its eventual report is stale; either
  // way its report must flag that a real side effect may already have happened.
  const bi = applyServerMessage(s, {serverContent: {interrupted: true}}, {at: T(6)}).session;
  assert.equal(bi.toolCalls.find(t => t.id === 'was-authorized').state, 'authorized', 'interruption does not itself cancel an already-authorized call');
  assert.equal(bi.toolCalls.find(t => t.id === 'was-authorized').authorizedOnce, true, 'authorizedOnce survives the interruption');
  const cancelledReport = toolResponseMessage(bi, {id: 'was-authorized', at: T(7)});
  assert.equal(cancelledReport.message.toolResponse.functionResponses[0].response.reason, 'stale_generation', 'the interruption bumped generation, so the late report is stale');
  assert.equal(cancelledReport.message.toolResponse.functionResponses[0].response.status, 'cancelled');
  assert.equal(cancelledReport.sideEffectMayHaveOccurred, true, 'the wiring layer must reconcile durable state, not assume nothing happened');
  // An executed call never flags an ambiguous side effect - it was relayed for real.
  let s2 = applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'executed', name: 'y', args: {}}]}}, {at: T(4)}).session;
  s2 = settleToolCall(s2, {id: 'executed', verdict: {allowed: true, checkedAt: T(4)}, at: T(4)});
  const executed = toolResponseMessage(s2, {id: 'executed', result: {ok: true}, at: T(5)});
  assert.equal(executed.message.toolResponse.functionResponses[0].response.status, 'executed');
  assert.equal(executed.sideEffectMayHaveOccurred, false);
  // Emergency stop at response time on a call that WAS authorized must also flag it.
  let s3 = applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'stopped', name: 'y', args: {}}]}}, {at: T(4)}).session;
  s3 = settleToolCall(s3, {id: 'stopped', verdict: {allowed: true, checkedAt: T(4)}, at: T(4)});
  const stoppedReport = toolResponseMessage(s3, {id: 'stopped', result: {}, at: T(5), emergencyStop: true});
  assert.equal(stoppedReport.sideEffectMayHaveOccurred, true);
});

test('readiness taxonomy: injected open session is SYNTHETIC only; network open session is LIVE; blocked stays BLOCKED', () => {
  assert.equal(liveVoiceReadiness([]).status, 'NOT_WIRED');
  assert.equal(liveVoiceReadiness([fresh()]).status, 'WIRED_UNVERIFIED');
  assert.equal(liveVoiceReadiness([openTransition(fresh(), {authority: {allowed: false}, at: T(1)})]).status, 'BLOCKED');
  assert.equal(liveVoiceReadiness([opened('injected')]).status, 'SYNTHETIC_VERIFIED');
  assert.equal(liveVoiceReadiness([opened('network')]).status, 'LIVE_VERIFIED');
  assert.equal(liveVoiceReadiness([{...opened('network'), turns: 5}]).status, 'NOT_WIRED', 'tampered session is not evidence');
});
