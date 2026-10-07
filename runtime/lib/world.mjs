import { createHash } from 'node:crypto';

export const WORLD_FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
export const WORLD_HAZARD_FEED = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50&days=7';
export const WORLD_HAZARD_DOCS = 'https://eonet.gsfc.nasa.gov/docs/v3';
export const WORLD_HAZARD_TERMS = 'https://eonet.gsfc.nasa.gov/what-is-eonet';
export const WORLD_MAX_BYTES = 512 * 1024;
export const WORLD_CACHE_MS = 60_000;
export const WORLD_STALE_MS = 15 * 60_000;
export class WorldError extends Error {}
const fail = () => { throw new WorldError('공개 지진 자료의 형식 검증에 실패했습니다. 이전 결과는 유지됩니다.'); };
const finite = (x, min, max) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
const integer = (x, min, max) => Number.isSafeInteger(x) && x >= min && x <= max;
const stamp = x => typeof x === 'string' && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, names) => record(x) && Object.keys(x).length === names.length && names.every(k => Object.hasOwn(x, k));
const ID = /^[a-z0-9_-]{1,80}$/i;
const eventUrl = id => `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`;
const hazardUrl = id => `https://eonet.gsfc.nasa.gov/api/v3/events/${id}`;
const WORLD_KEYS = ['format', 'feedUrl', 'generatedAt', 'checkedAt', 'sha256', 'sourceCount', 'invalidCount', 'omittedCount', 'events'];
const SOURCE_ERROR = 'source_unavailable';
const text = (x, limit) => typeof x === 'string' && x.trim().length > 0 && x.length <= limit && !/[\u0000-\u001f\u007f]/.test(x);
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);

export function validateHazardSnapshot(value) {
  if (!exact(value, ['feedUrl', 'status', 'checkedAt', 'latestEventAt', 'sha256', 'sourceCount', 'invalidCount', 'omittedCount', 'events', 'error']) || value.feedUrl !== WORLD_HAZARD_FEED || !['ok', 'error'].includes(value.status) || !stamp(value.checkedAt) || ![value.sourceCount, value.invalidCount, value.omittedCount].every(n => integer(n, 0, 500)) || !Array.isArray(value.events) || value.events.length > 50 || value.events.length + value.invalidCount + value.omittedCount !== value.sourceCount) fail();
  if (value.status === 'error') {
    if (value.error !== SOURCE_ERROR || value.sha256 !== null || value.latestEventAt !== null || value.sourceCount !== 0) fail();
    return value;
  }
  if (value.error !== null || !hash(value.sha256)) fail();
  const seen = new Set();
  for (const e of value.events) {
    if (!exact(e, ['id', 'title', 'category', 'occurredAt', 'longitude', 'latitude', 'url']) || !text(e.id, 80) || !ID.test(e.id) || seen.has(e.id) || !text(e.title, 240) || !text(e.category, 80) || !ID.test(e.category) || !stamp(e.occurredAt) || Date.parse(e.occurredAt) > Date.parse(value.checkedAt) + 300_000 || !finite(e.longitude, -180, 180) || !finite(e.latitude, -90, 90) || e.url !== hazardUrl(e.id)) fail();
    seen.add(e.id);
  }
  const latest = value.events.map(e => e.occurredAt).sort().at(-1) ?? null;
  if (value.latestEventAt !== latest) fail();
  return value;
}

export function validateWorldSnapshot(value) {
  const extended = value?.format === 2;
  if (!exact(value, extended ? [...WORLD_KEYS, 'hazards', 'earthquakeError'] : WORLD_KEYS) || ![1, 2].includes(value.format) || value.feedUrl !== WORLD_FEED || !stamp(value.checkedAt) || ![value.sourceCount, value.invalidCount, value.omittedCount].every(n => integer(n, 0, 2000)) || !Array.isArray(value.events) || value.events.length > 100 || value.events.length + value.invalidCount + value.omittedCount !== value.sourceCount) fail();
  if (extended) {
    validateHazardSnapshot(value.hazards);
    if (![null, SOURCE_ERROR].includes(value.earthquakeError)) fail();
    if (value.earthquakeError) {
      if (value.generatedAt !== null || value.sha256 !== null || value.sourceCount !== 0 || value.hazards.status !== 'ok') fail();
      return value;
    }
  }
  if (!stamp(value.generatedAt) || !hash(value.sha256)) fail();
  if (Date.parse(value.generatedAt) > Date.parse(value.checkedAt) + 300_000) fail();
  const seen = new Set();
  for (const e of value.events) {
    if (!exact(e, ['id', 'magnitude', 'place', 'occurredAt', 'updatedAt', 'longitude', 'latitude', 'depthKm', 'reviewStatus', 'url']) || (typeof e.id !== 'string' || !ID.test(e.id)) || seen.has(e.id) || !finite(e.magnitude, 2.5, 10) || typeof e.place !== 'string' || !e.place.trim() || e.place.length > 240 || /[\u0000-\u001f\u007f]/.test(e.place) || !stamp(e.occurredAt) || !stamp(e.updatedAt) || !finite(e.longitude, -180, 180) || !finite(e.latitude, -90, 90) || !finite(e.depthKm, -10, 1000) || !['automatic', 'reviewed', 'unknown'].includes(e.reviewStatus) || e.url !== eventUrl(e.id)) fail();
    if (Date.parse(e.occurredAt) > Date.parse(value.generatedAt) + 300_000 || Date.parse(e.occurredAt) < Date.parse(value.generatedAt) - 86_400_000 - 300_000) fail();
    seen.add(e.id);
  }
  return value;
}

export function parseHazardFeed(raw, checkedAt = Date.now()) {
  if (!Buffer.isBuffer(raw) || raw.length > WORLD_MAX_BYTES || !integer(checkedAt, 0, 8e15)) fail();
  let feed; try { feed = JSON.parse(raw.toString('utf8')); } catch { fail(); }
  if (!record(feed) || feed.title !== 'EONET Events' || !Array.isArray(feed.events) || feed.events.length > 500) fail();
  const events = [], ids = new Set(); let invalidCount = 0;
  for (const e of feed.events) {
    if (!record(e) || !text(e.id, 80) || !ID.test(e.id) || ids.has(e.id) || !text(e.title, 240) || e.closed !== null || !Array.isArray(e.categories) || !e.categories.length || e.categories.length > 20 || !text(e.categories[0]?.id, 80) || !ID.test(e.categories[0].id) || !Array.isArray(e.geometry) || !e.geometry.length || e.geometry.length > 1000) { invalidCount++; continue; }
    // Use only the latest supplied geometry. Polygon coverage is not invented as a point.
    const geometries = e.geometry.filter(g => record(g) && typeof g.date === 'string' && Number.isFinite(Date.parse(g.date)) && Date.parse(g.date) >= 0 && Date.parse(g.date) <= checkedAt + 300_000).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const g = geometries[0], c = g?.coordinates;
    if (!g || g.type !== 'Point' || !Array.isArray(c) || c.length !== 2 || !finite(c[0], -180, 180) || !finite(c[1], -90, 90)) { invalidCount++; continue; }
    ids.add(e.id);
    events.push({ id: e.id, title: e.title.trim(), category: e.categories[0].id, occurredAt: new Date(g.date).toISOString(), longitude: c[0], latitude: c[1], url: hazardUrl(e.id) });
  }
  if (feed.events.length && !events.length) fail();
  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
  return validateHazardSnapshot({ feedUrl: WORLD_HAZARD_FEED, status: 'ok', checkedAt: new Date(checkedAt).toISOString(), latestEventAt: events[0]?.occurredAt ?? null, sha256: createHash('sha256').update(raw).digest('hex'), sourceCount: feed.events.length, invalidCount, omittedCount: Math.max(0, events.length - 50), events: events.slice(0, 50), error: null });
}

export function parseWorldFeed(raw, checkedAt = Date.now()) {
  if (!Buffer.isBuffer(raw) || raw.length > WORLD_MAX_BYTES || !integer(checkedAt, 0, 8e15)) fail();
  let feed; try { feed = JSON.parse(raw.toString('utf8')); } catch { fail(); }
  if (feed?.type !== 'FeatureCollection' || feed.metadata?.status !== 200 || !integer(feed.metadata.generated, 0, checkedAt + 300_000) || !Array.isArray(feed.features) || feed.features.length > 2000 || feed.metadata.count !== feed.features.length) fail();
  const events = [], ids = new Set();
  let invalidCount = 0;
  for (const f of feed.features) {
    const p = f?.properties, c = f?.geometry?.coordinates;
    if (f?.type !== 'Feature' || (typeof f?.id !== 'string' || !ID.test(f.id)) || ids.has(f.id) || p?.type !== 'earthquake' || !finite(p.mag, 2.5, 10) || typeof p.place !== 'string' || !p.place.trim() || p.place.length > 240 || /[\u0000-\u001f\u007f]/.test(p.place) || !integer(p.time, feed.metadata.generated - 86_400_000 - 300_000, feed.metadata.generated + 300_000) || !integer(p.updated, 0, checkedAt + 300_000) || f.geometry?.type !== 'Point' || !Array.isArray(c) || c.length !== 3 || !finite(c[0], -180, 180) || !finite(c[1], -90, 90) || !finite(c[2], -10, 1000)) { invalidCount++; continue; }
    ids.add(f.id);
    events.push({ id: f.id, magnitude: p.mag, place: p.place.trim(), occurredAt: new Date(p.time).toISOString(), updatedAt: new Date(p.updated).toISOString(), longitude: c[0], latitude: c[1], depthKm: c[2], reviewStatus: ['automatic', 'reviewed'].includes(p.status) ? p.status : 'unknown', url: eventUrl(f.id) });
  }
  if (feed.features.length && !events.length) fail();
  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
  return validateWorldSnapshot({ format: 1, feedUrl: WORLD_FEED, generatedAt: new Date(feed.metadata.generated).toISOString(), checkedAt: new Date(checkedAt).toISOString(), sha256: createHash('sha256').update(raw).digest('hex'), sourceCount: feed.features.length, invalidCount, omittedCount: Math.max(0, events.length - 100), events: events.slice(0, 100) });
}

async function fetchLayer(url, parse, { signal, fetchImpl, clock, timeoutMs }) {
  if (signal?.aborted) throw new WorldError('세계 현황 조회가 중단되었습니다.');
  const controller = new AbortController();
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const cancel = () => { controller.abort(); rejectAbort(new WorldError('세계 현황 조회가 중단되거나 시간 제한을 넘었습니다.')); };
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  let reader;
  try {
    // Fixed public endpoint only; no owner content, credentials, cookies or URLs.
    const response = await Promise.race([fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/geo+json, application/json' } }), aborted]);
    if (!response.ok || response.redirected || (response.url && response.url !== url)) throw new WorldError('공개 원자료를 받지 못했습니다. 잠시 후 다시 조회하세요.');
    // On 2026-09-12 this exact NASA endpoint returned JSON labeled application/rss+xml.
    // This exception never permits XML, alternate hosts or unvalidated content.
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^(?:application\/(?:geo\+)?json)(?:;|$)/i.test(contentType) && !(url === WORLD_HAZARD_FEED && /^application\/rss\+xml(?:;|$)/i.test(contentType))) fail();
    if (Number(response.headers.get('content-length')) > WORLD_MAX_BYTES) fail();
    reader = response.body?.getReader(); if (!reader) fail();
    const parts = []; let size = 0;
    while (true) {
      if (controller.signal.aborted) throw new WorldError('세계 현황 조회가 중단되거나 시간 제한을 넘었습니다.');
      const { value, done } = await Promise.race([reader.read(), aborted]); if (done) break;
      size += value.byteLength; if (size > WORLD_MAX_BYTES) fail(); parts.push(value);
    }
    if (controller.signal.aborted) throw new WorldError('세계 현황 조회가 중단되거나 시간 제한을 넘었습니다.');
    return parse(Buffer.concat(parts), clock());
  } catch (error) {
    if (error instanceof WorldError) throw error;
    throw new WorldError('세계 현황 연결이 중단되었거나 응답을 확인하지 못했습니다. 이전 결과는 유지됩니다.');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    if (reader) { try { void reader.cancel().catch(() => {}); } catch {} }
  }
}

export async function fetchWorldSnapshot({ signal, fetchImpl = fetch, hazardFetchImpl, includeHazards = fetchImpl === fetch || Boolean(hazardFetchImpl), clock = Date.now, timeoutMs = 12_000 } = {}) {
  if (signal?.aborted) throw new WorldError('세계 현황 조회가 중단되었습니다.');
  if (!integer(timeoutMs, 1, 30_000)) throw new WorldError('세계 현황 조회 시간 제한이 올바르지 않습니다.');
  const options = { signal, fetchImpl, clock, timeoutMs };
  if (!includeHazards) return fetchLayer(WORLD_FEED, parseWorldFeed, options);
  // The same injected transport handles both endpoints; tests never escape to real fetch.
  const [quakes, hazards] = await Promise.allSettled([
    fetchLayer(WORLD_FEED, parseWorldFeed, options),
    fetchLayer(WORLD_HAZARD_FEED, parseHazardFeed, { ...options, fetchImpl: hazardFetchImpl ?? fetchImpl }),
  ]);
  if (signal?.aborted) throw new WorldError('세계 현황 조회가 중단되었습니다.');
  if (quakes.status === 'rejected' && hazards.status === 'rejected') throw new WorldError('USGS와 NASA EONET 조회가 모두 실패했습니다. 이전 결과는 유지됩니다.');
  const checkedAt = new Date(clock()).toISOString();
  const snapshot = quakes.status === 'fulfilled' ? quakes.value : { format: 1, feedUrl: WORLD_FEED, generatedAt: null, checkedAt, sha256: null, sourceCount: 0, invalidCount: 0, omittedCount: 0, events: [] };
  return validateWorldSnapshot({ ...snapshot, format: 2, earthquakeError: quakes.status === 'rejected' ? SOURCE_ERROR : null, hazards: hazards.status === 'fulfilled' ? hazards.value : { feedUrl: WORLD_HAZARD_FEED, status: 'error', checkedAt, latestEventAt: null, sha256: null, sourceCount: 0, invalidCount: 0, omittedCount: 0, events: [], error: SOURCE_ERROR } });
}

export function latestWorldJob(jobs) {
  return jobs.filter(job => job.type === 'world' && job.status === 'completed' && job.worldSnapshot).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}
export function worldOverview(jobs, at = Date.now()) {
  const job = latestWorldJob(jobs), lastAttempt = jobs.filter(job => job.type === 'world').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  const snapshot = job?.worldSnapshot;
  const hazards = snapshot?.hazards;
  return { latestJobId: job?.id ?? null, lastAttemptId: lastAttempt?.id ?? null, lastAttemptStatus: lastAttempt?.status ?? null, lastError: lastAttempt?.status === 'failed' ? lastAttempt.error : null, stale: !snapshot?.generatedAt || at - Date.parse(snapshot.generatedAt) > WORLD_STALE_MS, generatedAt: snapshot?.generatedAt ?? null, checkedAt: snapshot?.checkedAt ?? null, partial: Boolean(snapshot?.earthquakeError || hazards?.status === 'error'), earthquakeError: snapshot?.earthquakeError ?? null, hazards: hazards ? { status: hazards.status, checkedAt: hazards.checkedAt, latestEventAt: hazards.latestEventAt, count: hazards.events.length, stale: hazards.status !== 'ok' || at - Date.parse(hazards.checkedAt) > WORLD_STALE_MS, error: hazards.error, feedGeneratedAt: null } : null };
}
const safe = x => String(x).replace(/[|\r\n]/g, ' ').replace(/[<>]/g, '');
export function worldDocument(snapshot, at = Date.now()) {
  validateWorldSnapshot(snapshot);
  const stale = !snapshot.generatedAt || at - Date.parse(snapshot.generatedAt) > WORLD_STALE_MS;
  const hazards = snapshot.hazards;
  const hazardReport = !hazards ? '' : hazards.status === 'error' ? '\n## NASA EONET — 조회 실패\n\n이번 조회에서 NASA 자료를 받지 못했습니다. 지진 결과는 사용할 수 있습니다. 실패를 사건 없음으로 해석하지 마세요.\n' : `\n## NASA EONET — 자연재해\n\n최근 7일·열린 사건 중 최신 Point 위치를 표시합니다. 원자료의 Polygon 범위를 임의의 점으로 바꾸지 않으며 해당 행은 제외 건수에 포함합니다.\n\n- 본체 조회: ${hazards.checkedAt}${at - Date.parse(hazards.checkedAt) > WORLD_STALE_MS ? ' · 조회 후 15분 경과' : ''}\n- 표시 사건의 가장 최근 위치 기록: ${hazards.latestEventAt ?? '해당 사건 없음'}\n- 원자료 생성 시각: 제공되지 않음. 위치 기록 시각과 조회 시각은 원자료의 최신성 보장이 아닙니다.\n- 원자료 ${hazards.sourceCount}건 / 표시 ${hazards.events.length}건 / 형식·범위 제외 ${hazards.invalidCount}건 / 표시 한도 제외 ${hazards.omittedCount}건\n- 출처: ${WORLD_HAZARD_FEED}\n- 원자료 SHA-256: ${hazards.sha256}\n\n| 분류 | 사건 | 위치 기록 시각(UTC) | 좌표(위도, 경도) | NASA 원자료 |\n|---|---|---|---|---|\n${hazards.events.map(e => `| ${safe(e.category)} | ${safe(e.title)} | ${e.occurredAt} | ${e.latitude.toFixed(3)}, ${e.longitude.toFixed(3)} | ${e.url} |`).join('\n') || '| — | 수신 자료에 해당 사건 없음 | — | — | — |'}\n\n출처: NASA EONET. API 계약 ${WORLD_HAZARD_DOCS} . 이용 범위 안내 ${WORLD_HAZARD_TERMS} : 시각화·일반 정보용 메타데이터이며 사건 범위·시각은 근사치일 수 있습니다. 원자료의 외부 사진·영상은 복제하지 않았습니다.\n`;
  return `# BLACKHOLE 세계 현황 — 지진${hazards ? ' · 자연재해' : ''}\n\nUSGS가 보고한 최근 24시간 규모 2.5 이상 지진입니다. 모든 지역의 관측이 빠짐없거나 즉시 도착함을 보장하는 자료는 아닙니다.\n\n${snapshot.earthquakeError ? 'USGS 조회 실패. 이번 결과에 지진 자료가 없으며 이를 지진 없음으로 해석하지 마세요.\n' : `- 원자료 생성: ${snapshot.generatedAt}\n- 본체 조회: ${snapshot.checkedAt}\n- 조회 당시 신선도: ${stale ? '15분 이상 지연된 자료' : '원자료 생성 후 15분 이내'}\n- 원자료 ${snapshot.sourceCount}건 / 표시 ${snapshot.events.length}건 / 형식·범위 제외 ${snapshot.invalidCount}건 / 표시 한도 제외 ${snapshot.omittedCount}건\n- 원자료: ${WORLD_FEED}\n- 원자료 SHA-256: ${snapshot.sha256}\n\n| 규모 | 발생 시각(UTC) | 위치 | 좌표(위도, 경도) | 깊이 km | 원자료 검토 | 출처 |\n|---|---|---|---|---|---|---|\n${snapshot.events.map(e => `| ${e.magnitude.toFixed(1)} | ${e.occurredAt} | ${safe(e.place)} | ${e.latitude.toFixed(3)}, ${e.longitude.toFixed(3)} | ${e.depthKm.toFixed(1)} | ${e.reviewStatus} | ${e.url} |`).join('\n') || '| — | — | 수신 자료에 해당 지진 없음 | — | — | — | — |'}\n`}${hazardReport}\n지도는 웹 조종석의 «세계 현황»에서 확인할 수 있습니다. 조회 시점 결과를 보존하며 새 조회가 과거 결과를 바꾸지 않습니다. 위치 권한·개인 추적·AI 호출 없이 고정 공개 피드만 읽었습니다. 개인 안전 판정·긴급 경보·대피 안내 기능은 아닙니다. God's Eye 원본 전체 통합이나 항공·선박·카메라 연결을 뜻하지 않습니다.\n`;
}
