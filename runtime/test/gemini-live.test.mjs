import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_ENDPOINT, INPUT_AUDIO_MIME, OUTPUT_AUDIO_MIME,
  createLiveSession, validateLiveSession, setupMessage, audioChunkMessage, textTurnMessage,
  applyServerMessage, settleToolCall, toolResponseMessage,
  openTransition, setupSentTransition, closeTransition, liveVoiceReadiness
} from '../lib/gemini-live.mjs';

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
  s = settleToolCall(dup.session, {id: 'c1', verdict: {allowed: true}, at: T(6)});
  assert.throws(() => settleToolCall(s, {id: 'c1', verdict: {allowed: true}, at: T(6)}), e => e.code === 'LIVE_DUPLICATE_TOOL_CALL');
  const resp = toolResponseMessage(s, {id: 'c1', result: {jobId: 'j1'}, at: T(7)});
  assert.equal(resp.message.toolResponse.functionResponses[0].response.status, 'executed');
  assert.throws(() => toolResponseMessage(resp.session, {id: 'c1', result: {}, at: T(8)}), e => e.code === 'LIVE_DUPLICATE_TOOL_CALL');
  let d = applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'c2', name: 'deploy', args: {}}]}}, {at: T(4)}).session;
  d = settleToolCall(d, {id: 'c2', verdict: {allowed: false, blockers: ['owner_approval_required']}, at: T(5)});
  const denied = toolResponseMessage(d, {id: 'c2', at: T(6)});
  assert.equal(denied.message.toolResponse.functionResponses[0].response.status, 'denied');
  assert.equal(denied.message.toolResponse.functionResponses[0].response.reason, 'owner_approval_or_authority_required');
  assert.throws(() => applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'c3', name: 'x', args: {apiKey: 'sk-abc'}}]}}, {at: T(4)}), /toolCall\.c3|자격|secret/i);
});

test('barge-in: interruption drops playback and cancels un-authorized asks; server cancellation likewise; authorized calls survive', () => {
  let s = applyServerMessage(opened(), {toolCall: {functionCalls: [{id: 'a', name: 'x', args: {}}, {id: 'b', name: 'y', args: {}}]}}, {at: T(4)}).session;
  s = settleToolCall(s, {id: 'b', verdict: {allowed: true}, at: T(5)});
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

test('readiness taxonomy: injected open session is SYNTHETIC only; network open session is LIVE; blocked stays BLOCKED', () => {
  assert.equal(liveVoiceReadiness([]).status, 'NOT_WIRED');
  assert.equal(liveVoiceReadiness([fresh()]).status, 'WIRED_UNVERIFIED');
  assert.equal(liveVoiceReadiness([openTransition(fresh(), {authority: {allowed: false}, at: T(1)})]).status, 'BLOCKED');
  assert.equal(liveVoiceReadiness([opened('injected')]).status, 'SYNTHETIC_VERIFIED');
  assert.equal(liveVoiceReadiness([opened('network')]).status, 'LIVE_VERIFIED');
  assert.equal(liveVoiceReadiness([{...opened('network'), turns: 5}]).status, 'NOT_WIRED', 'tampered session is not evidence');
});
