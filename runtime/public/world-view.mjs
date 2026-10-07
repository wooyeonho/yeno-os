const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => value ? new Date(value).toLocaleString('ko-KR', { timeZoneName: 'short' }) : '아직 조회하지 않음';
const point = e => [((e.longitude + 180) / 360 * 1000).toFixed(2), ((90 - e.latitude) / 180 * 500).toFixed(2)];
const categories = { wildfires: '산불', severeStorms: '폭풍', volcanoes: '화산', floods: '홍수', drought: '가뭄', dustHaze: '먼지·연무', earthquakes: '지진', landslides: '산사태', manmade: '인위적 사건', seaLakeIce: '해빙·호빙', snow: '눈', tempExtremes: '극한 기온', waterColor: '수색 변화' };
const category = id => Object.hasOwn(categories, id) ? categories[id] : '기타 자연현상';
const old = value => !value || Date.now() - Date.parse(value) > 900_000;
export function createWorldView({ load, submit }) {
  const $ = id => document.getElementById(id);
  let snapshot = null, loadedId = null, loadingId = null, generation = 0, overview = {}, selected = null, allowed = false;
  const section = $('tab-world');
  section.querySelector('h2').textContent = '세계 지진·자연재해';
  section.querySelector('.section-heading p').textContent = 'USGS 지진과 NASA EONET 자연재해를 출처별로 확인합니다.';
  $('world-map').setAttribute('aria-label', 'USGS 지진과 NASA EONET 자연재해 위치 지도');
  section.querySelector('.world-map-caption').textContent = '● 원: USGS 지진(크기=규모) · ◆ 마름모: NASA EONET 자연재해(원자료의 최신 점 위치)';
  const controls = document.createElement('label');
  controls.htmlFor = 'world-layer';
  controls.innerHTML = '표시 출처 <select id="world-layer"><option value="all">전체 출처</option><option value="usgs">USGS · 지진</option><option value="eonet">NASA EONET · 전체</option><option value="wildfires">NASA · 산불</option><option value="severeStorms">NASA · 폭풍</option><option value="volcanoes">NASA · 화산</option></select>';
  section.querySelector('.world-bar').append(controls);
  const sourceNote = document.createElement('p'); sourceNote.className = 'muted';
  sourceNote.innerHTML = 'NASA EONET은 최근 7일의 열린 사건을 최대 50건 조회합니다. 위치·시각은 근사치일 수 있습니다. <a href="https://eonet.gsfc.nasa.gov/what-is-eonet" target="_blank" rel="noopener noreferrer">NASA 출처·이용 범위 ↗</a>';
  section.append(sourceNote);
  function draw() {
    const layer = $('world-layer').value, hazards = snapshot?.hazards;
    const events = ['all', 'usgs'].includes(layer) ? (snapshot?.events ?? []).filter(e => e.magnitude >= Number($('world-magnitude').value)) : [];
    const hazardEvents = layer === 'usgs' ? [] : (hazards?.events ?? []).filter(e => ['all', 'eonet'].includes(layer) || e.category === layer);
    $('world-magnitude').disabled = !['all', 'usgs'].includes(layer);
    $('world-total').textContent = snapshot ? String(events.length + hazardEvents.length) : '—';
    $('world-largest').textContent = events.length ? `M ${Math.max(...events.map(e => e.magnitude)).toFixed(1)}` : '—';
    $('world-updated').textContent = snapshot ? `${snapshot.earthquakeError ? 'USGS 조회 실패' : `USGS 원자료 ${date(snapshot.generatedAt)}${old(snapshot.generatedAt) ? ' · 지연 자료' : ''} · 본체 조회 ${date(snapshot.checkedAt)}`} | ${!hazards ? 'NASA: 이전 지진 전용 결과에 미포함' : hazards.status === 'error' ? 'NASA EONET 조회 실패' : `NASA 본체 조회 ${date(hazards.checkedAt)}${old(hazards.checkedAt) ? ' · 15분 경과' : ''} · 최근 위치 기록 ${hazards.latestEventAt ? date(hazards.latestEventAt) : '해당 사건 없음'} · 원자료 생성 시각 미제공`}` : '새로 조회하면 공개 데이터를 본체가 가져옵니다.';
    $('world-coverage').textContent = snapshot ? `USGS: 원자료 ${snapshot.sourceCount}건 · 형식/범위 제외 ${snapshot.invalidCount}건 · 표시 한도 제외 ${snapshot.omittedCount}건.${hazards?.status === 'ok' ? ` NASA EONET: 원자료 ${hazards.sourceCount}건 · 형식/범위 제외 ${hazards.invalidCount}건 · 표시 한도 제외 ${hazards.omittedCount}건. Polygon 범위는 임의의 점으로 바꾸지 않습니다.` : ''} 각 기관의 보고 범위이며 세계 모든 사건의 완전한 목록은 아닙니다.` : 'USGS · 최근 24시간 M2.5+ / NASA EONET · 최근 7일 열린 사건';
    $('world-markers').innerHTML = events.map(e => {
      const [x, y] = point(e), radius = Math.min(10, 2 + e.magnitude);
      return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${e.magnitude >= 6 ? '#ff9678' : '#72dfba'}" class="world-point ${selected === e.id ? 'selected' : ''}" tabindex="0" role="button" data-quake="${esc(e.id)}" aria-label="${esc(`규모 ${e.magnitude.toFixed(1)}, ${e.place}`)}"><title>${esc(`M ${e.magnitude.toFixed(1)} · ${e.place}`)}</title></circle>`;
    }).join('') + hazardEvents.map(e => {
      const [x, y] = point(e);
      return `<path d="M ${x} ${Number(y) - 7} l 7 7 l -7 7 l -7 -7 Z" fill="#f7bf65" class="world-point ${selected === `eonet:${e.id}` ? 'selected' : ''}" tabindex="0" role="button" data-hazard="${esc(e.id)}" aria-label="${esc(`NASA ${category(e.category)}, ${e.title}`)}"><title>${esc(`NASA ${category(e.category)} · ${e.title}`)}</title></path>`;
    }).join('');
    $('world-list').innerHTML = events.map(e => `<button class="world-event ${selected === e.id ? 'selected' : ''}" data-quake="${esc(e.id)}"><strong class="world-mag">${e.magnitude.toFixed(1)}</strong><span><strong>${esc(e.place)}</strong><small>${esc(date(e.occurredAt))} · ${e.reviewStatus === 'reviewed' ? '원자료 검토됨' : e.reviewStatus === 'automatic' ? '자동 판독' : '검토 상태 미확인'}</small></span><span aria-hidden="true">↗</span></button>`).join('') || '<p class="muted">현재 표시할 관측 자료가 없습니다.</p>';
    if (hazardEvents.length) {
      if (!events.length) $('world-list').innerHTML = '';
      $('world-list').innerHTML += hazardEvents.map(e => `<button class="world-event ${selected === `eonet:${e.id}` ? 'selected' : ''}" data-hazard="${esc(e.id)}"><strong class="world-mag" aria-hidden="true">◆</strong><span><strong>${esc(e.title)}</strong><small>NASA EONET · ${category(e.category)} · 위치 기록 ${esc(date(e.occurredAt))}</small></span><span aria-hidden="true">↗</span></button>`).join('');
    }
    const e = events.find(e => e.id === selected), hazard = hazardEvents.find(e => `eonet:${e.id}` === selected);
    $('world-detail').hidden = !e && !hazard;
    if (e) $('world-detail').innerHTML = `<h3>M ${e.magnitude.toFixed(1)} · ${esc(e.place)}</h3><p>발생 ${esc(date(e.occurredAt))}<br>원자료 수정 ${esc(date(e.updatedAt))}<br>위도 ${e.latitude.toFixed(3)} · 경도 ${e.longitude.toFixed(3)} · 깊이 ${e.depthKm.toFixed(1)} km</p><a class="text-button" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">USGS 원자료 열기 ↗</a>`;
    if (hazard) $('world-detail').innerHTML = `<h3>${category(hazard.category)} · ${esc(hazard.title)}</h3><p>NASA EONET 위치 기록 ${esc(date(hazard.occurredAt))}<br>위도 ${hazard.latitude.toFixed(3)} · 경도 ${hazard.longitude.toFixed(3)}<br>사건의 전체 영역이나 현재 상황을 확정하는 좌표가 아닙니다. 원자료의 최신 Point를 표시합니다.</p><a class="text-button" href="${esc(hazard.url)}" target="_blank" rel="noopener noreferrer">NASA EONET 원자료 열기 ↗</a>`;
  }
  function status() {
    const working = ['queued', 'running'].includes(overview.lastAttemptStatus);
    const partial = Boolean(snapshot?.earthquakeError || snapshot?.hazards?.status === 'error');
    const stale = snapshot && ((!snapshot.earthquakeError && old(snapshot.generatedAt)) || (snapshot.hazards?.status === 'ok' && old(snapshot.hazards.checkedAt)));
    $('world-refresh').disabled = !allowed || working;
    $('world-refresh').textContent = working ? '현황 가져오는 중…' : '새로 조회';
    $('world-status').textContent = overview.lastAttemptStatus === 'failed' ? '조회 실패 · 이전 결과 유지' : overview.lastAttemptStatus === 'paused' ? '조회 일시정지 · 작업에서 재개 가능' : working ? '공개 원자료 조회 중' : partial ? '일부 출처 조회 실패 · 받은 자료만 표시' : stale ? '지연 자료 · 새 조회 필요' : snapshot ? '저장된 조회 결과' : '첫 조회 대기';
    $('world-status').classList.toggle('world-stale', Boolean(stale || partial || overview.lastAttemptStatus === 'failed'));
    $('world-error').textContent = overview.lastError ?? (partial ? '출처 조회 실패를 사건 없음으로 해석하지 마세요. 이전 성공 결과는 작업 이력에 남아 있습니다.' : '');
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
    const target = event.target.closest('[data-quake], [data-hazard]'); if (!target) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    event.preventDefault(); selected = target.dataset.hazard ? `eonet:${target.dataset.hazard}` : target.dataset.quake; draw();
    $('world-detail').setAttribute('tabindex', '-1'); $('world-detail').focus({ preventScroll: true });
    $('world-detail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  $('world-refresh').addEventListener('click', () => { if (allowed && !$('world-refresh').disabled) void submit(); });
  $('world-magnitude').addEventListener('change', () => { selected = null; draw(); });
  $('world-layer').addEventListener('change', () => { selected = null; draw(); });
  $('world-map').addEventListener('click', select); $('world-map').addEventListener('keydown', select);
  $('world-list').addEventListener('click', select);
  draw(); status();
  return { update, reset() { generation++; snapshot = null; loadedId = null; loadingId = null; overview = {}; selected = null; allowed = false; $('world-layer').value = 'all'; draw(); status(); } };
}
