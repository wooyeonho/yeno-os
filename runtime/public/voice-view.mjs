import {createLiveVoiceClient} from './live-voice-client.mjs';

/** Browser speech is optional; durable execution and result retrieval belong to the host app. */
export function createVoiceView(root, {onSend, onReadResult, liveVoiceUrl} = {}) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const Recognition = win.SpeechRecognition || win.webkitSpeechRecognition;
  const synth = win.speechSynthesis, Utterance = win.SpeechSynthesisUtterance;
  let state = {online:false,jobs:[]}, epoch = 0, audioEpoch = 0, destroyed = false;
  let recognition = null, submitting = false, pending = null, reading = false, speaking = false, stagedTurn = null;
  let lastAnswer = '', lastQuestion = '', history = [], status = '', resultError = false;
  // Real-time Gemini Live call: a separate, additive path. It never touches
  // recognition/speaking/pending above - SpeechRecognition, speechSynthesis
  // and the typed-input+job-polling flow stay exactly as they were and
  // remain the fallback whenever live voice is unsupported, blocked or not
  // started.
  const liveSupported = !!(win.WebSocket && win.navigator?.mediaDevices?.getUserMedia);
  let liveState = 'idle', liveTranscript = [], liveError = '';
  root.innerHTML = `<section class="voice-panel" aria-label="자비스 음성 대화">
    <div class="voice-heading"><div><span class="eyebrow">JARVIS · VOICE</span><h3>말하고, 이어서 맡기세요</h3></div><span class="voice-indicator" data-voice-indicator>대기</span></div>
    <p class="voice-help">마이크를 누르고 한국어로 말하세요. 인식된 문장을 고쳐 보낼 수 있습니다. 답변은 실제 작업 결과가 도착하면 읽습니다.</p>
    <p class="voice-privacy">음성 인식·읽기는 브라우저 기능을 사용하며, 음성이나 답변이 브라우저 제공 업체로 전송될 수 있습니다. 이 화면을 벗어나면 마이크와 읽기를 멈춥니다.</p>
    <p class="voice-support" data-voice-support></p>
    <label class="voice-label">보낼 말<textarea data-voice-input rows="3" maxlength="4000" placeholder="오늘 뭐부터 하면 돼? / 알아서 우선순위 잡아봐" aria-label="음성 대화 입력"></textarea></label>
    <p data-voice-interim class="voice-interim" aria-live="polite"></p>
    <div class="voice-actions"><button type="button" class="button" data-voice-action="listen">마이크 켜기</button><button type="button" class="button primary" data-voice-action="send">보내기</button><button type="button" class="button subtle" data-voice-action="stop">음성 멈춤</button></div>
    <div class="voice-options"><label><input type="checkbox" data-voice-read checked> 답변 소리 내어 읽기</label><label><input type="checkbox" data-voice-handsfree> 연속 대화: 말이 끝나면 자동 전송</label></div>
    <p class="voice-help">연속 대화를 켠 뒤 마이크를 누르면, 답변 읽기가 끝난 뒤 다음 말을 듣습니다. 전체 작업 정지는 상단의 전체 멈춤을 사용하세요.</p>
    <p data-voice-status role="status" aria-live="polite"></p>
    <div class="voice-answer" data-voice-answer hidden><h4>실제 답변</h4><p data-voice-job></p><pre data-voice-answer-text></pre><div class="voice-actions"><button type="button" class="button subtle" data-voice-action="replay">다시 듣기</button><button type="button" class="button subtle" data-voice-action="retry" hidden>결과 다시 확인</button></div></div>
    <div class="voice-live" data-voice-live hidden>
      <h4>실시간 통화 (Gemini Live)</h4>
      <p class="voice-help">누르면 마이크 권한을 요청하고 실시간으로 대화합니다. 말하는 도중에도 끼어들 수 있습니다. 도구는 서버에서만 실행되며 이 화면은 실행 권한이 없습니다.</p>
      <div class="voice-actions"><button type="button" class="button" data-voice-action="live-toggle">실시간 통화 시작</button></div>
      <p data-voice-live-status role="status" aria-live="polite"></p>
      <div class="voice-live-transcript" data-voice-live-transcript aria-live="polite"></div>
    </div>
  </section>`;
  const q = selector => root.querySelector(selector);
  const input = q('[data-voice-input]'), interim = q('[data-voice-interim]');
  const read = q('[data-voice-read]'), handsfree = q('[data-voice-handsfree]');
  const button = action => q(`[data-voice-action="${action}"]`);
  const visible = () => !doc.hidden && !root.hidden;
  const allowed = () => !destroyed && state.online === true && !state.emergencyStop && visible();
  const outputSupported = () => !!synth && typeof synth.speak === 'function' && !!Utterance;
  const boundedHistory = () => {
    const turns = []; let chars = 0;
    for (const turn of history.slice(-6).reverse()) { if (chars + turn.content.length > 8000) break; turns.unshift({...turn}); chars += turn.content.length; }
    return turns;
  };
  function render() {
    if (destroyed) return;
    button('listen').disabled = !allowed() || !Recognition || submitting || !!pending || !!stagedTurn || speaking;
    button('listen').textContent = recognition ? '듣기 끝내기' : '마이크 켜기';
    button('send').disabled = !allowed() || submitting || !!pending || !!stagedTurn || !!recognition || !input.value.trim();
    button('stop').disabled = !recognition && !speaking && !pending && !stagedTurn && !submitting && !handsfree.checked;
    button('replay').disabled = !allowed() || !lastAnswer || !outputSupported() || !!recognition || submitting || !!pending;
    button('retry').hidden = !resultError;
    button('retry').disabled = !allowed() || reading;
    handsfree.disabled = !allowed() || !Recognition || !outputSupported();
    read.disabled = !outputSupported();
    input.disabled = submitting || !!pending || !!recognition;
    q('[data-voice-status]').textContent = !state.online ? '본체 연결을 기다립니다. 입력은 이 화면에 유지됩니다.' : state.emergencyStop ? '전체 멈춤 상태입니다. 음성을 보내지 않습니다.' : status;
    q('[data-voice-indicator]').textContent = recognition ? '듣는 중' : speaking ? '읽는 중' : submitting ? '접수 중' : stagedTurn ? '접수 확인 필요' : pending ? '답변 대기' : '대기';
    q('[data-voice-indicator]').dataset.active = String(!!recognition || speaking);
    q('[data-voice-support]').textContent = !Recognition ? '이 브라우저는 음성 인식을 지원하지 않습니다. 아래에 입력해 보내세요. 휴대폰의 키보드 음성 입력도 사용할 수 있습니다.' : !outputSupported() ? '음성 인식은 사용할 수 있지만 답변 읽기는 이 브라우저에서 지원하지 않습니다.' : '';
    renderLive();
  }
  const liveActive = () => ['connecting', 'listening', 'reconnecting'].includes(liveState);
  function renderLive() {
    q('[data-voice-live]').hidden = !liveSupported;
    if (!liveSupported) return;
    const liveButton = button('live-toggle');
    liveButton.disabled = !allowed() && !liveActive();
    liveButton.textContent = liveActive() ? '실시간 통화 종료' : '실시간 통화 시작';
    const labels = {idle: '', connecting: '마이크 권한 요청 및 연결 중…', listening: '실시간으로 듣고 있습니다. 말씀하세요.', reconnecting: '연결이 끊겨 다시 연결하는 중입니다…', fallback_required: '실시간 연결에 반복 실패했습니다. 마이크 켜기(음성 인식)로 이어서 사용하세요.', stopped: '실시간 통화를 종료했습니다.', hidden: '화면을 벗어나 실시간 통화를 멈췄습니다.', page_hidden: '화면을 벗어나 실시간 통화를 멈췄습니다.', offline: '연결이 끊겨 실시간 통화를 멈췄습니다.', logout: '로그아웃되어 실시간 통화를 멈췄습니다.', emergency_stop: '전체 멈춤 상태입니다. 실시간 통화를 멈췄습니다.'};
    q('[data-voice-live-status]').textContent = liveError || labels[liveState] || '';
    q('[data-voice-live-transcript]').innerHTML = liveTranscript.map(turn => `<p><strong>${turn.role === 'user' ? '나' : 'JARVIS'}</strong>: ${escapeHtml(turn.text)}</p>`).join('');
  }
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[ch]);
  }
  const liveClient = liveSupported ? createLiveVoiceClient({
    url: liveVoiceUrl || `${win.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${win.location.host}/api/voice/live`,
    doc, win,
    onEvent(event) {
      if (destroyed) return;
      if (event.type === 'state') {liveState = event.state; if (event.state !== 'connecting') liveError = '';}
      else if (event.type === 'error') {liveError = event.message === 'microphone_permission_denied' ? '마이크 권한이 필요합니다. 브라우저의 사이트 권한에서 마이크를 허용하세요.' : '실시간 연결에 문제가 발생했습니다.';}
      else if (event.type === 'blocked') {liveState = 'idle'; liveError = event.reason === 'emergency_stop' ? '전체 멈춤 상태에서는 실시간 통화를 시작할 수 없습니다.' : '실시간 통화가 차단되었습니다.';}
      else if (event.type === 'transcript' && typeof event.text === 'string' && event.text.trim()) {liveTranscript = [...liveTranscript, {role: event.role, text: event.text}].slice(-20);}
      else if (event.type === 'barge_in') {/* playback already stopped inside the client; nothing to render beyond the status label above */}
      render();
    }
  }) : null;
  function abortRecognition() {
    const current = recognition; recognition = null; interim.textContent = '';
    if (current) { current.cancelled = true; try { current.engine.abort(); } catch {} }
  }
  function stopAudio(message = '음성을 멈췄습니다. 이미 접수된 작업은 작업 목록에서 확인할 수 있습니다.') {
    audioEpoch++; abortRecognition(); speaking = false; handsfree.checked = false;
    if (pending) pending.speak = false;
    try { synth?.cancel(); } catch {}
    status = message; render();
  }
  function startListening() {
    if (!allowed() || !Recognition || recognition || submitting || pending || stagedTurn || speaking) return;
    const session = {engine:new Recognition(),generation:epoch,cancelled:false,failed:false,hadFinal:false,base:input.value.trim()};
    recognition = session;
    const engine = session.engine;
    engine.lang = 'ko-KR'; engine.continuous = false; engine.interimResults = true; engine.maxAlternatives = 1;
    const valid = () => recognition === session && session.generation === epoch && !session.cancelled && allowed();
    engine.onresult = event => {
      if (!valid()) return;
      const final = [], partial = [];
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index], transcript = String(result[0]?.transcript || '');
        if (result.isFinal) final.push(transcript); else partial.push(transcript);
      }
      session.hadFinal = !!final.join('').trim();
      input.value = [session.base, ...final].filter(Boolean).join(' ').slice(0,4000);
      interim.textContent = partial.join(' ').slice(0,4000);
      render();
    };
    engine.onerror = event => {
      if (!valid()) return;
      session.failed = true; handsfree.checked = false;
      status = ({'not-allowed':'마이크 권한이 필요합니다. 브라우저의 사이트 권한에서 마이크를 허용하거나 직접 입력하세요.','service-not-allowed':'이 브라우저에서 음성 인식을 사용할 수 없습니다. 직접 입력하세요.','audio-capture':'마이크를 찾지 못했습니다. 연결 상태를 확인하거나 직접 입력하세요.','network':'음성 인식 연결에 실패했습니다. 다시 마이크를 누르거나 직접 입력하세요.','no-speech':'말소리를 듣지 못했습니다. 다시 마이크를 누르세요.','aborted':'음성 인식을 멈췄습니다.'})[event.error] || '음성 인식에 실패했습니다. 인식된 문장을 확인한 뒤 직접 보내세요.';
      abortRecognition(); render();
    };
    engine.onend = () => {
      if (recognition !== session || session.generation !== epoch || session.cancelled) return;
      recognition = null; interim.textContent = '';
      if (!allowed()) { stopAudio(); return; }
      if (!session.failed) status = session.hadFinal ? '인식된 문장을 확인하고 보내세요.' : '완성된 문장을 듣지 못했습니다. 다시 마이크를 누르세요.';
      render();
      if (session.hadFinal && !session.failed && handsfree.checked) void send();
    };
    status = '듣고 있습니다. 음성 멈춤을 누르면 전송하지 않고 중지합니다.'; render();
    try { engine.start(); } catch { recognition = null; handsfree.checked = false; status = '마이크를 시작하지 못했습니다. 다시 누르거나 직접 입력하세요.'; render(); }
  }
  function speakAnswer(text, continueListening = false) {
    if (!allowed() || !outputSupported() || !text) return;
    abortRecognition(); const generation = epoch, token = ++audioEpoch;
    try { synth.cancel(); } catch {}
    // Short consecutive utterances avoid mobile engines silently truncating a long utterance.
    const spoken = String(text).replace(/```[^\n]*\n?/g,'').replace(/^#{1,6}\s*/gm,'').slice(0,6000);
    const chunks = spoken.match(/[\s\S]{1,180}(?:\s|$)|[\s\S]{1,180}/g) || [];
    let index = 0; speaking = true; status = text.length > 6000 ? '답변 앞부분을 읽습니다. 전체 답변은 아래에서 확인하세요.' : '실제 답변을 읽고 있습니다.'; render();
    const next = () => {
      if (generation !== epoch || token !== audioEpoch || !allowed()) return;
      if (index >= chunks.length) {
        speaking = false; status = '답변을 읽었습니다.'; render();
        if (continueListening && handsfree.checked && !pending && !input.value.trim()) startListening();
        return;
      }
      const utterance = new Utterance(chunks[index++]); utterance.lang = 'ko-KR';
      const voices = synth.getVoices?.() || []; const voice = voices.find(item => /^ko(?:-|_)/i.test(item.lang));
      if (voice) utterance.voice = voice;
      let settled = false;
      utterance.onend = () => { if (settled) return; settled = true; next(); };
      utterance.onerror = () => { if (settled || generation !== epoch || token !== audioEpoch) return; settled = true; speaking = false; handsfree.checked = false; audioEpoch++; status = '자동 읽기를 시작하지 못했거나 중단됐습니다. 다시 듣기를 누르세요.'; render(); };
      try { synth.speak(utterance); } catch { utterance.onerror(); }
    };
    next();
  }
  async function receive(job) {
    if (!pending || job?.id !== pending.id || pending.handled || reading || !allowed()) return;
    if (['failed','cancelled','paused'].includes(job.status)) {
      status = `작업이 ${job.status === 'failed' ? '실패' : job.status === 'cancelled' ? '취소' : '일시 정지'}되었습니다. 작업 목록에서 기록을 확인하세요.`;
      pending = null; handsfree.checked = false; render(); return;
    }
    if (job.status !== 'completed') return;
    const request = pending, generation = epoch; reading = true; resultError = false;
    try {
      if (typeof onReadResult !== 'function') throw new Error('결과 읽기가 연결되지 않았습니다. 작업 목록에서 파일을 여세요.');
      const result = await onReadResult(job);
      if (generation !== epoch || destroyed || pending !== request) return;
      const text = typeof result === 'string' ? result : result?.text;
      if (typeof text !== 'string' || !text.trim()) throw new Error('읽을 수 있는 텍스트 결과를 찾지 못했습니다. 작업 목록에서 파일을 여세요.');
      request.handled = true; lastAnswer = text.slice(0,32000); pending = null;
      history.push({role:'user',content:lastQuestion.slice(0,4000)},{role:'assistant',content:lastAnswer.slice(0,4000)}); history = history.slice(-6);
      q('[data-voice-answer]').hidden = false; q('[data-voice-answer-text]').textContent = lastAnswer;
      q('[data-voice-job]').textContent = `완료된 작업 · ${job.id}`;
      status = '실제 작업 결과가 도착했습니다.';
      if (request.speak && read.checked && allowed()) speakAnswer(lastAnswer,true);
      else { handsfree.checked = false; render(); }
    } catch (error) {
      if (generation === epoch && !destroyed && pending === request) {
        request.job = job; resultError = true; handsfree.checked = false;
        status = error.message || '결과를 읽지 못했습니다. 결과 다시 확인을 누르세요.';
        q('[data-voice-answer]').hidden = false;
      }
    } finally { if (generation === epoch && !destroyed) { reading = false; render(); } }
  }
  function acceptReceipt(receipt) {
    const turn = stagedTurn, id = receipt?.jobId || receipt?.job?.id;
    if (!turn || turn.generation !== epoch || destroyed || typeof id !== 'string' || !id) return false;
    turn.accepted = true; stagedTurn = null;
    pending = {id,speak:turn.audioToken === audioEpoch && read.checked,handled:false}; lastQuestion = turn.question;
    if (input.value.trim() === turn.question) input.value = '';
    // Homunculus already decided by the time the receipt comes back (decide.mjs
    // ran server-side before the quest job was even created) - announce the
    // choice and its reason immediately, separately from the eventual result.
    if (receipt.decision?.announcement) {
      status = receipt.decision.announcement;
      if (pending.speak) speakAnswer(receipt.decision.announcement, false);
    } else status = '접수했습니다. 실제 결과를 기다리고 있습니다.';
    if (receipt.job) void receive(receipt.job);
    else { const job = (state.jobs || []).find(item => item.id === id); if (job) void receive(job); }
    render(); return true;
  }
  async function send() {
    if (!allowed() || submitting || pending || stagedTurn || recognition || typeof onSend !== 'function') return;
    const text = input.value.trim(); if (!text) return;
    const generation = epoch, turn = {generation:epoch,audioToken:audioEpoch,question:text,accepted:false}; stagedTurn = turn;
    submitting = true; resultError = false; status = '본체에 작업을 접수하고 있습니다…'; render();
    try {
      const receipt = await onSend(text, {history:boundedHistory()});
      if (generation !== epoch || destroyed) return;
      if (!turn.accepted && !acceptReceipt(receipt)) throw new Error('작업 접수를 확인하지 못했습니다. 상단의 같은 요청 확인을 사용하세요.');
    } catch (error) {
      if (generation === epoch && !destroyed && !turn.accepted) {
        const definite = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 && ![401,403,408,410].includes(error.status);
        if (definite) stagedTurn = null;
        status = error.message || '응답을 확인하지 못했습니다. 상단의 같은 요청 확인을 사용하세요.'; handsfree.checked = false;
      }
    } finally { if (generation === epoch && !destroyed) { submitting = false; render(); } }
  }
  const click = event => {
    const target = event.target.closest?.('[data-voice-action]'); if (!target || target.disabled || !root.contains(target)) return;
    switch (target.dataset.voiceAction) {
      case 'listen': if (recognition) { try { recognition.engine.stop(); } catch { stopAudio(); } } else startListening(); break;
      case 'send': void send(); break;
      case 'stop': stopAudio(); break;
      case 'replay': speakAnswer(lastAnswer,false); break;
      case 'retry': if (pending?.job) void receive(pending.job); break;
      case 'live-toggle':
        if (liveActive()) liveClient?.stop('stopped');
        else if (allowed()) void liveClient?.start();
        break;
    }
  };
  const change = event => {
    if (event.target === handsfree && handsfree.checked) {
      read.checked = true; status = '연속 대화가 선택됐습니다. 마이크를 누르면 완성된 말을 자동 전송합니다.';
    }
    if (event.target === read && !read.checked) stopAudio('답변 읽기를 껐습니다. 결과는 글로 확인하세요.');
    render();
  };
  const inputChanged = () => render();
  const hide = () => { if (doc.hidden) stopAudio('화면을 벗어나 음성을 멈췄습니다.'); };
  const pagehide = () => stopAudio('화면을 벗어나 음성을 멈췄습니다.');
  root.addEventListener('click',click); root.addEventListener('change',change); input.addEventListener('input',inputChanged);
  doc.addEventListener('visibilitychange',hide); win.addEventListener('pagehide',pagehide); render();
  return {
    acceptReceipt,
    update(next) {
      if (destroyed) return;
      state = next || {online:false,jobs:[]};
      liveClient?.setEmergencyStop(state.emergencyStop === true);
      if (!state.online) liveClient?.stop('offline');
      if (!allowed()) stopAudio(!state.online ? '연결이 끊겨 음성을 멈췄습니다.' : '음성을 멈췄습니다.');
      render();
      if (pending && !resultError) { const job = (state.jobs || []).find(item => item.id === pending.id); if (job) void receive(job); }
    },
    stop() { stopAudio(); liveClient?.stop('stopped'); },
    reset() {
      epoch++; stopAudio(''); submitting = false; pending = null; stagedTurn = null; reading = false; resultError = false;
      lastAnswer = ''; lastQuestion = ''; history = []; input.value = ''; read.checked = true; status = '';
      liveClient?.stop('stopped'); liveTranscript = []; liveError = '';
      q('[data-voice-answer]').hidden = true; q('[data-voice-answer-text]').textContent = ''; q('[data-voice-job]').textContent = '';
      state = {online:false,jobs:[]}; render();
    },
    destroy() {
      epoch++; stopAudio(''); destroyed = true;
      liveClient?.stop('destroyed');
      root.removeEventListener('click',click); root.removeEventListener('change',change); input.removeEventListener('input',inputChanged);
      doc.removeEventListener('visibilitychange',hide); win.removeEventListener('pagehide',pagehide); root.innerHTML = '';
      history = []; lastAnswer = ''; lastQuestion = ''; pending = null; stagedTurn = null;
    }
  };
}
