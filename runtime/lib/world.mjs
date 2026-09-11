import { createHash } from 'node:crypto';

export const WORLD_FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
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

export function validateWorldSnapshot(value) {
  if (!exact(value, ['format', 'feedUrl', 'generatedAt', 'checkedAt', 'sha256', 'sourceCount', 'invalidCount', 'omittedCount', 'events']) || value.format !== 1 || value.feedUrl !== WORLD_FEED || !stamp(value.generatedAt) || !stamp(value.checkedAt) || !/^[a-f0-9]{64}$/.test(value.sha256) || ![value.sourceCount, value.invalidCount, value.omittedCount].every(n => integer(n, 0, 2000)) || !Array.isArray(value.events) || value.events.length > 100 || value.events.length + value.invalidCount + value.omittedCount !== value.sourceCount) fail();
  if (Date.parse(value.generatedAt) > Date.parse(value.checkedAt) + 300_000) fail();
  const seen = new Set();
  for (const e of value.events) {
    if (!exact(e, ['id', 'magnitude', 'place', 'occurredAt', 'updatedAt', 'longitude', 'latitude', 'depthKm', 'reviewStatus', 'url']) || (typeof e.id !== 'string' || !ID.test(e.id)) || seen.has(e.id) || !finite(e.magnitude, 2.5, 10) || typeof e.place !== 'string' || !e.place.trim() || e.place.length > 240 || /[\u0000-\u001f\u007f]/.test(e.place) || !stamp(e.occurredAt) || !stamp(e.updatedAt) || !finite(e.longitude, -180, 180) || !finite(e.latitude, -90, 90) || !finite(e.depthKm, -10, 1000) || !['automatic', 'reviewed', 'unknown'].includes(e.reviewStatus) || e.url !== eventUrl(e.id)) fail();
    if (Date.parse(e.occurredAt) > Date.parse(value.generatedAt) + 300_000 || Date.parse(e.occurredAt) < Date.parse(value.generatedAt) - 86_400_000 - 300_000) fail();
    seen.add(e.id);
  }
  return value;
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

export async function fetchWorldSnapshot({ signal, fetchImpl = fetch, clock = Date.now, timeoutMs = 12_000 } = {}) {
  if (signal?.aborted) throw new WorldError('세계 현황 조회가 중단되었습니다.');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  let reader;
  try {
    // Fixed public endpoint only; no owner content, credentials, cookies or URLs.
    const response = await fetchImpl(WORLD_FEED, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/geo+json, application/json' } });
    if (!response.ok || response.redirected || (response.url && response.url !== WORLD_FEED)) throw new WorldError('USGS 지진 자료를 받지 못했습니다. 잠시 후 다시 조회하세요.');
    if (!/^(?:application\/(?:geo\+)?json)(?:;|$)/i.test(response.headers.get('content-type') ?? '')) fail();
    if (Number(response.headers.get('content-length')) > WORLD_MAX_BYTES) fail();
    reader = response.body?.getReader(); if (!reader) fail();
    const parts = []; let size = 0;
    while (true) {
      if (controller.signal.aborted) throw new WorldError('세계 현황 조회가 중단되거나 시간 제한을 넘었습니다.');
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > WORLD_MAX_BYTES) fail(); parts.push(value);
    }
    if (controller.signal.aborted) throw new WorldError('세계 현황 조회가 중단되거나 시간 제한을 넘었습니다.');
    return parseWorldFeed(Buffer.concat(parts), clock());
  } catch (error) {
    if (error instanceof WorldError) throw error;
    throw new WorldError('세계 현황 연결이 중단되었거나 응답을 확인하지 못했습니다. 이전 결과는 유지됩니다.');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    if (reader) { try { await reader.cancel(); } catch {} }
  }
}

export function latestWorldJob(jobs) {
  return jobs.filter(job => job.type === 'world' && job.status === 'completed' && job.worldSnapshot).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}
export function worldOverview(jobs, at = Date.now()) {
  const job = latestWorldJob(jobs), lastAttempt = jobs.filter(job => job.type === 'world').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  const snapshot = job?.worldSnapshot;
  return { latestJobId: job?.id ?? null, lastAttemptId: lastAttempt?.id ?? null, lastAttemptStatus: lastAttempt?.status ?? null, lastError: lastAttempt?.status === 'failed' ? lastAttempt.error : null, stale: !snapshot || at - Date.parse(snapshot.generatedAt) > WORLD_STALE_MS, generatedAt: snapshot?.generatedAt ?? null, checkedAt: snapshot?.checkedAt ?? null };
}
const safe = x => String(x).replace(/[|\r\n]/g, ' ').replace(/[<>]/g, '');
export function worldDocument(snapshot, at = Date.now()) {
  validateWorldSnapshot(snapshot);
  const stale = at - Date.parse(snapshot.generatedAt) > WORLD_STALE_MS;
  return `# BLACKHOLE 세계 현황 — 지진\n\nUSGS가 보고한 최근 24시간 규모 2.5 이상 지진입니다. 모든 지역의 관측이 빠짐없거나 즉시 도착함을 보장하는 자료는 아닙니다.\n\n- 원자료 생성: ${snapshot.generatedAt}\n- 본체 조회: ${snapshot.checkedAt}\n- 조회 당시 신선도: ${stale ? '15분 이상 지연된 자료' : '원자료 생성 후 15분 이내'}\n- 원자료 ${snapshot.sourceCount}건 / 표시 ${snapshot.events.length}건 / 형식·범위 제외 ${snapshot.invalidCount}건 / 표시 한도 제외 ${snapshot.omittedCount}건\n- 원자료: ${WORLD_FEED}\n- 원자료 SHA-256: ${snapshot.sha256}\n\n| 규모 | 발생 시각(UTC) | 위치 | 좌표(위도, 경도) | 깊이 km | 원자료 검토 | 출처 |\n|---|---|---|---|---|---|---|\n${snapshot.events.map(e => `| ${e.magnitude.toFixed(1)} | ${e.occurredAt} | ${safe(e.place)} | ${e.latitude.toFixed(3)}, ${e.longitude.toFixed(3)} | ${e.depthKm.toFixed(1)} | ${e.reviewStatus} | ${e.url} |`).join('\n') || '| — | — | 수신 자료에 해당 지진 없음 | — | — | — | — |'}\n\n지도는 웹 조종석의 «세계 현황»에서 확인할 수 있습니다. 이 문서는 조회 시점 결과를 보존하며 새 조회가 과거 결과를 바꾸지 않습니다. 위치 권한·개인 추적·AI 호출 없이 USGS 고정 공개 피드만 읽었습니다. 자동 판독 자료는 추후 수정될 수 있습니다. 지진 경보·개인 안전 판정·대피 안내 기능은 아닙니다.\n`;
}
