const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => value ? new Date(value).toLocaleString('ko-KR', { timeZoneName: 'short' }) : '아직 조회하지 않음';
const point = e => [((e.longitude + 180) / 360 * 1000).toFixed(2), ((90 - e.latitude) / 180 * 500).toFixed(2)];
export function createWorldView({ load, submit }) {
  const $ = id => document.getElementById(id);
  let snapshot = null, loadedId = null, loadingId = null, generation = 0, overview = {}, selected = null, allowed = false;
  function draw() {
    const events = (snapshot?.events ?? []).filter(e => e.magnitude >= Number($('world-magnitude').value));
    $('world-total').textContent = snapshot ? String(events.length) : '—';
    $('world-largest').textContent = events.length ? `M ${Math.max(...events.map(e => e.magnitude)).toFixed(1)}` : '—';
    $('world-updated').textContent = snapshot ? `원자료 ${date(snapshot.generatedAt)} · 본체 조회 ${date(snapshot.checkedAt)}` : '새로 조회하면 공개 데이터를 본체가 가져옵니다.';
    $('world-coverage').textContent = snapshot ? `원자료 ${snapshot.sourceCount}건 · 형식/범위 제외 ${snapshot.invalidCount}건 · 표시 한도 제외 ${snapshot.omittedCount}건. USGS 관측·보고 범위이며 세계 모든 지진의 완전한 목록은 아닙니다.` : 'USGS · 최근 24시간 · 규모 2.5 이상';
    $('world-markers').innerHTML = events.map(e => {
      const [x, y] = point(e), radius = Math.min(10, 2 + e.magnitude);
      return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${e.magnitude >= 6 ? '#ff9678' : '#72dfba'}" class="world-point ${selected === e.id ? 'selected' : ''}" tabindex="0" role="button" data-quake="${esc(e.id)}" aria-label="${esc(`규모 ${e.magnitude.toFixed(1)}, ${e.place}`)}"><title>${esc(`M ${e.magnitude.toFixed(1)} · ${e.place}`)}</title></circle>`;
    }).join('');
    $('world-list').innerHTML = events.map(e => `<button class="world-event ${selected === e.id ? 'selected' : ''}" data-quake="${esc(e.id)}"><strong class="world-mag">${e.magnitude.toFixed(1)}</strong><span><strong>${esc(e.place)}</strong><small>${esc(date(e.occurredAt))} · ${e.reviewStatus === 'reviewed' ? '원자료 검토됨' : e.reviewStatus === 'automatic' ? '자동 판독' : '검토 상태 미확인'}</small></span><span aria-hidden="true">↗</span></button>`).join('') || '<p class="muted">현재 표시할 관측 자료가 없습니다.</p>';
    const e = events.find(e => e.id === selected);
    $('world-detail').hidden = !e;
    if (e) $('world-detail').innerHTML = `<h3>M ${e.magnitude.toFixed(1)} · ${esc(e.place)}</h3><p>발생 ${esc(date(e.occurredAt))}<br>원자료 수정 ${esc(date(e.updatedAt))}<br>위도 ${e.latitude.toFixed(3)} · 경도 ${e.longitude.toFixed(3)} · 깊이 ${e.depthKm.toFixed(1)} km</p><a class="text-button" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">USGS 원자료 열기 ↗</a>`;
  }
  function status() {
    const working = ['queued', 'running'].includes(overview.lastAttemptStatus);
    const stale = snapshot && (Date.now() - Date.parse(snapshot.generatedAt) > 900_000);
    $('world-refresh').disabled = !allowed || working;
    $('world-refresh').textContent = working ? '현황 가져오는 중…' : '새로 조회';
    $('world-status').textContent = overview.lastAttemptStatus === 'failed' ? '조회 실패 · 이전 결과 유지' : overview.lastAttemptStatus === 'paused' ? '조회 일시정지 · 작업에서 재개 가능' : working ? '공개 원자료 조회 중' : stale ? '지연 자료 · 새 조회 필요' : snapshot ? '저장된 조회 결과' : '첫 조회 대기';
    $('world-status').classList.toggle('world-stale', Boolean(stale || overview.lastAttemptStatus === 'failed'));
    $('world-error').textContent = overview.lastError ?? '';
  }
  async function update(next, canRun) {
    overview = next ?? {}; allowed = canRun; status();
    const id = overview.latestJobId;
    if (!id || id === loadedId || id === loadingId) return;
    const version = ++generation; loadingId = id;
    try {
      const result = await load();
      if (version !== generation) return;
      snapshot = result.snapshot; loadedId = result.latestJobId; selected = null;
      draw(); status();
    } catch { if (version === generation) $('world-error').textContent = '저장된 지도 결과를 불러오지 못했습니다. 본체 연결을 확인하세요.'; }
    finally { if (version === generation) loadingId = null; }
  }
  function select(event) {
    const target = event.target.closest('[data-quake]'); if (!target) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    event.preventDefault(); selected = target.dataset.quake; draw();
    $('world-detail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  $('world-refresh').addEventListener('click', () => { if (allowed && !$('world-refresh').disabled) void submit(); });
  $('world-magnitude').addEventListener('change', () => { selected = null; draw(); });
  $('world-map').addEventListener('click', select); $('world-map').addEventListener('keydown', select);
  $('world-list').addEventListener('click', select);
  draw(); status();
  return { update, reset() { generation++; snapshot = null; loadedId = null; loadingId = null; overview = {}; selected = null; allowed = false; draw(); status(); } };
}
