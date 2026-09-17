import { createLiveVoiceClient, type LiveVoiceEvent } from '../../../runtime/public/live-voice-client.mjs';
import { makeNativeConnect, nativeLiveVoiceUrl } from './live-voice-native.ts';
import type { Connection } from './native-studio.ts';

// The native Live Voice UI section: a small, independently testable view
// (same shape as createStudioView/createWorldView/the browser's
// createVoiceView) that owns the #live-voice DOM and the per-connection
// lifecycle of the reused runtime/public/live-voice-client.mjs state
// machine. main.ts only ever calls setConnection()/update()/destroy() -
// it never touches the client or the DOM here directly.

type UpdateState = { online: boolean; emergencyStop: boolean; busy: boolean };
type Deps = {
  doc?: Document;
  win?: Window;
  createClient?: typeof createLiveVoiceClient;
  supported?: boolean;
};

const LABELS: Record<string, string> = {
  connecting: '마이크 권한 요청 및 연결 중…',
  listening: '실시간으로 듣고 있습니다. 말씀하세요.',
  reconnecting: '연결이 끊겨 다시 연결하는 중입니다…',
  fallback_required: '실시간 연결에 반복 실패했습니다. 명령을 입력해 이어서 사용하세요.',
  stopped: '실시간 통화를 종료했습니다.',
  offline: '연결이 끊겨 실시간 통화를 멈췄습니다.',
  logout: '연결 해제로 실시간 통화를 멈췄습니다.',
  emergency_stop: '전체 멈춤 상태입니다. 실시간 통화를 멈췄습니다.',
  hidden: '화면을 벗어나 실시간 통화를 멈췄습니다.',
  page_hidden: '화면을 벗어나 실시간 통화를 멈췄습니다.',
};

function escapeHtml(text: string) {
  return String(text).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch] as string));
}

export function createNativeLiveVoiceView(root: HTMLElement, deps: Deps = {}) {
  const doc = deps.doc ?? root.ownerDocument;
  const win = deps.win ?? doc.defaultView as Window;
  const createClient = deps.createClient ?? createLiveVoiceClient;
  const supported = deps.supported ?? !!(win.navigator && win.navigator.mediaDevices && win.navigator.mediaDevices.getUserMedia);
  const q = (selector: string) => root.querySelector(selector) as HTMLElement;

  let client: ReturnType<typeof createLiveVoiceClient> | null = null;
  let connection: Connection | null = null;
  let online = false, emergencyStop = false, busy = false;
  let liveState = 'idle', liveError = '';
  let transcript: { role: string; text: string }[] = [];

  const active = () => ['connecting', 'listening', 'reconnecting'].includes(liveState);

  function render() {
    root.hidden = !connection || !supported;
    if (!connection || !supported) return;
    const toggle = q('[data-live-toggle]') as HTMLButtonElement;
    const allowed = online && !emergencyStop && !busy;
    toggle.disabled = !allowed && !active();
    toggle.textContent = active() ? '실시간 통화 종료' : '실시간 통화 시작';
    q('[data-live-status]').textContent = liveError || LABELS[liveState] || '';
    q('[data-live-transcript]').innerHTML = transcript.map(turn => `<p><strong>${turn.role === 'user' ? '나' : 'JARVIS'}</strong>: ${escapeHtml(turn.text)}</p>`).join('');
  }

  function handleEvent(event: LiveVoiceEvent) {
    if (event.type === 'state') { liveState = event.state; if (event.state !== 'connecting') liveError = ''; }
    else if (event.type === 'error') liveError = event.message === 'microphone_permission_denied' ? '마이크 권한이 필요합니다. 기기 설정에서 마이크 권한을 허용하세요.' : '실시간 연결에 문제가 발생했습니다.';
    else if (event.type === 'blocked') { liveState = 'idle'; liveError = event.reason === 'emergency_stop' ? '전체 멈춤 상태에서는 실시간 통화를 시작할 수 없습니다.' : '실시간 통화가 차단되었습니다.'; }
    else if (event.type === 'transcript' && event.text.trim()) transcript = [...transcript, { role: event.role, text: event.text }].slice(-20);
    render();
  }

  function click(event: Event) {
    const target = (event.target as Element).closest?.('[data-live-toggle]') as HTMLButtonElement | null;
    if (!target || target.disabled || !root.contains(target)) return;
    if (active()) client?.stop('stopped');
    else if (connection && online && !emergencyStop && !busy) void client?.start();
  }
  root.addEventListener('click', click);
  render();

  return {
    // Called once per successful pairing/unlock (and with null on
    // logout/local-forget) - tears down any previous connection's client
    // first so a stale session can never bleed into a new one, then builds
    // a fresh client bound to this connection's own paired-device token.
    setConnection(value: Connection | null) {
      client?.stop('logout');
      client = null;
      liveState = 'idle'; liveError = ''; transcript = [];
      connection = value;
      client = (value && supported) ? createClient({
        url: nativeLiveVoiceUrl(value.origin),
        connect: makeNativeConnect(value.token),
        doc, win,
        onEvent: event => { if (connection === value) handleEvent(event); },
      }) : null;
      render();
    },
    // Called on every state refresh (online/offline, emergency stop,
    // disconnect-in-progress) - mirrors the browser voice-view.mjs's
    // update() side effects exactly, so background/offline/emergency-stop
    // release the mic/socket/playback the same way there too.
    update(state: UpdateState) {
      online = state.online; emergencyStop = state.emergencyStop; busy = state.busy;
      client?.setEmergencyStop(emergencyStop);
      if (!connection || !online) client?.stop('offline');
      render();
    },
    destroy() {
      client?.stop('destroyed');
      client = null;
      root.removeEventListener('click', click);
    },
  };
}
