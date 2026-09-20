import { isIP } from 'node:net';
import { sourceMatches, sourceReferenceNames, sourceSearchKey, SOURCE_AGING_DAYS, SOURCE_BUCKETS, sourceBucket } from '../public/source-reference-labels.mjs';
// Re-exported (not redefined) so server.mjs/tests can keep importing bucket
// logic from this module while the actual pure function lives in the one
// shared server+browser file - a single source of truth, never a second
// copy that could silently drift from what the sources tab UI computes.
export { SOURCE_AGING_DAYS, SOURCE_BUCKETS, sourceBucket };

export class SourceError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// `url`/`sourceLocator` are creation-time alternatives (exactly one is ever
// supplied - see validateSourceFields), never both updatable fields at once.
const FIELD_NAMES = ['url', 'sourceLocator', 'title', 'projectId', 'readingStatus', 'decision', 'implementationStatus', 'entityType', 'origin', 'aliases', 'summary', 'application', 'riskNotes'];
const READING = new Set(['unread', 'partial', 'read', 'unavailable']);
const DECISIONS = new Set(['pending', 'candidate', 'deferred', 'rejected']);
// Origin/entity-type/implementation-status intake fields (BLACKHOLE §C
// single-ledger requirement): kept fully separate from readingStatus/decision
// - a project, keyword or idea a real URL has never been found for is
// registered via `sourceLocator` instead of `url` and tracked here honestly,
// never silently promoted by adding it.
export const SOURCE_ENTITY_TYPES = Object.freeze(['SYS', 'APP', 'OPS', 'IP', 'HW', 'RND', 'REF', 'UNRESOLVED']);
export const SOURCE_IMPLEMENTATION_STATUSES = Object.freeze(['idea', 'scoped', 'queued', 'coding', 'tested', 'live', 'blocked', 'retired']);
export const SOURCE_ORIGINS = Object.freeze(['user', 'assistant', 'external']);

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, field, maximum, required = false) {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) throw new SourceError(400, `${field} must be ${required ? 'a non-empty' : 'a'} string of at most ${maximum} characters.`);
  return value.trim();
}
export function sourceRequestId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new SourceError(400, 'Source changes require requestId of 1–160 characters.');
}
function secretParameter(name) {
  // Decode layered query-name encoding conservatively; never include the value
  // or full URL in an error or log message.
  for (let n = 0; n < 3; n++) {
    try { const next = decodeURIComponent(name); if (next === name) break; name = next; } catch { break; }
  }
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /token|password|passwd|signature|secret|credential|authorization|apikey/.test(key) || /^(?:key|code|auth|sig|pwd|accesskey|clientkey)$/.test(key);
}
function checkParameters(params) {
  for (const name of params.keys()) if (secretParameter(name)) throw new SourceError(400, 'Source URLs cannot contain authentication or secret-like query parameters. Share a public content URL.');
}
function publicHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  // Sources are public DNS links. Literal IPs are deliberately unsupported:
  // this also excludes alternate IPv4 notation and IPv4-mapped IPv6 after URL parsing.
  if (isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home)$/.test(host) || host.endsWith('.home.arpa')) return false;
  return host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
export function sourceUrl(value) {
  const url = text(value, 'url', 2048, true);
  if (!/^https:\/\//i.test(url) || /[\u0000-\u0020\u007f\\]/.test(url)) throw new SourceError(400, 'url must be a public HTTPS URL without whitespace, control characters or backslashes.');
  let parsed;
  try { parsed = new URL(url); } catch { throw new SourceError(400, 'url must be a valid public HTTPS URL.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !publicHostname(parsed.hostname) || (parsed.port && parsed.port !== '443')) throw new SourceError(400, 'url must use a public DNS host and HTTPS without credentials or a custom port. Local/private hosts and literal IPs are not supported.');
  checkParameters(parsed.searchParams);
  // OAuth credentials can also appear in a URL fragment. Documentation anchors
  // remain intact; fragment query data is checked before retaining the original.
  if (parsed.hash.includes('=')) {
    const fragment = parsed.hash.slice(1);
    checkParameters(new URLSearchParams(fragment));
    // A fragment may be a router path followed by query data, or credential
    // query data whose value itself contains a question mark. Inspect both
    // forms without discarding a credential name before the last question mark.
    for (let index = fragment.indexOf('?'); index !== -1; index = fragment.indexOf('?', index + 1)) checkParameters(new URLSearchParams(fragment.slice(index + 1)));
  }
  const aliases = {
    'www.instagram.com': 'instagram.com', 'm.instagram.com': 'instagram.com',
    'www.x.com': 'x.com', 'twitter.com': 'x.com', 'www.twitter.com': 'x.com', 'mobile.twitter.com': 'x.com', 'm.twitter.com': 'x.com',
    'www.threads.com': 'threads.com', 'www.threads.net': 'threads.net',
    'www.youtube.com': 'youtube.com', 'm.youtube.com': 'youtube.com',
  };
  const host = parsed.hostname.replace(/\.$/, '');
  parsed.hostname = aliases[host] ?? host;
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^utm_/i.test(key) || /^(?:igsi|igsh|stkn|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i.test(key)) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  if (['instagram.com', 'x.com', 'threads.com', 'threads.net'].includes(parsed.hostname) && parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return { url, canonicalUrl: parsed.href };
}

export function validateCandidate(source) {
  if (source.decision !== 'candidate') return;
  if (source.readingStatus !== 'read') throw new SourceError(400, 'An improvement candidate requires readingStatus=read. Unread, partial or unavailable sources remain pending, deferred or rejected.');
  if (!source.summary || !source.application || !source.riskNotes) throw new SourceError(400, 'An improvement candidate requires summary, application and riskNotes. Record content rights, privacy, terms or unresolved issues; this is not a legal guarantee.');
}

function validateAliases(value) {
  if (!Array.isArray(value) || value.length > 10) throw new SourceError(400, 'aliases must be an array of at most 10 short names.');
  const seen = new Set(), trimmed = [];
  for (const alias of value) {
    const clean = text(alias, 'aliases', 80, true);
    if (/[\u0000-\u001f\u007f]/.test(clean)) throw new SourceError(400, 'aliases cannot contain control characters.');
    const key = clean.toLocaleLowerCase();
    if (seen.has(key)) throw new SourceError(400, 'aliases must not contain duplicates.');
    seen.add(key); trimmed.push(clean);
  }
  return trimmed;
}

const IMMUTABLE_ON_UPDATE = ['url', 'sourceLocator', 'origin'];

export function validateSourceFields(body, { creating = false, imported = false, projects = [], current } = {}) {
  if (!record(body)) throw new SourceError(400, 'A source must be a JSON object.');
  const allowed = new Set([...(creating ? FIELD_NAMES : FIELD_NAMES.filter(name => !IMMUTABLE_ON_UPDATE.includes(name))), ...(imported ? [] : ['requestId']), ...(creating ? [] : ['revision'])]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new SourceError(400, 'Unknown or immutable source field. Original url/sourceLocator, canonicalUrl and origin cannot be changed; register another source.');
  if (!imported) sourceRequestId(body.requestId);
  const fields = creating ? { projectId: null, readingStatus: 'unread', decision: 'pending', implementationStatus: 'idea', entityType: 'UNRESOLVED', origin: 'user', aliases: [], summary: '', application: '', riskNotes: '' } : {};
  if (creating) {
    // Exactly one of a real public URL or a topic/idea locator with no
    // confirmed external link yet - never both, never neither. A source
    // reconstructed from the stored registry always carries both keys (one
    // real string, the other backfilled null), so presence is judged by
    // type, not by Object.hasOwn.
    const hasUrl = typeof body.url === 'string';
    const hasLocator = typeof body.sourceLocator === 'string';
    if (hasUrl === hasLocator) throw new SourceError(400, 'Provide exactly one of url (a public HTTPS link) or sourceLocator (a topic/idea name with no confirmed external link yet).');
    if (hasUrl) { Object.assign(fields, sourceUrl(body.url)); fields.sourceLocator = null; }
    else { fields.sourceLocator = text(body.sourceLocator, 'sourceLocator', 200, true); fields.url = null; fields.canonicalUrl = null; }
    if (Object.hasOwn(body, 'origin')) {
      if (!SOURCE_ORIGINS.includes(body.origin)) throw new SourceError(400, `origin must be one of ${SOURCE_ORIGINS.join(', ')}.`);
      fields.origin = body.origin;
    }
  }
  if (creating || Object.hasOwn(body, 'title')) {
    fields.title = text(body.title, 'title', 160, true);
    if (/[\u0000-\u001f\u007f]/.test(fields.title)) throw new SourceError(400, 'title cannot contain control characters.');
  }
  for (const [name, maximum] of [['summary', 8000], ['application', 8000], ['riskNotes', 4000]]) if (Object.hasOwn(body, name)) fields[name] = text(body[name], name, maximum);
  if (Object.hasOwn(body, 'projectId')) {
    if (body.projectId !== null && (typeof body.projectId !== 'string' || !UUID.test(body.projectId) || !projects.some(project => project.id === body.projectId))) throw new SourceError(400, 'projectId must be null or the ID of a registered project.');
    fields.projectId = body.projectId;
  }
  if (Object.hasOwn(body, 'readingStatus')) {
    if (!READING.has(body.readingStatus)) throw new SourceError(400, 'readingStatus must be unread, partial, read or unavailable.');
    fields.readingStatus = body.readingStatus;
  }
  if (Object.hasOwn(body, 'decision')) {
    if (!DECISIONS.has(body.decision)) throw new SourceError(400, 'decision must be pending, candidate, deferred or rejected. Candidate does not mean implemented, tested or deployed.');
    fields.decision = body.decision;
  }
  // implementationStatus is a genuinely separate axis from decision/
  // readingStatus - a `candidate` decision does not imply `coding`, and
  // `unavailable` reading does not imply `retired`. Never derived from
  // the other, always explicit.
  if (Object.hasOwn(body, 'implementationStatus')) {
    if (!SOURCE_IMPLEMENTATION_STATUSES.includes(body.implementationStatus)) throw new SourceError(400, `implementationStatus must be one of ${SOURCE_IMPLEMENTATION_STATUSES.join(', ')}.`);
    fields.implementationStatus = body.implementationStatus;
  }
  if (Object.hasOwn(body, 'entityType')) {
    if (!SOURCE_ENTITY_TYPES.includes(body.entityType)) throw new SourceError(400, `entityType must be one of ${SOURCE_ENTITY_TYPES.join(', ')}.`);
    fields.entityType = body.entityType;
  }
  if (Object.hasOwn(body, 'aliases')) fields.aliases = validateAliases(body.aliases);
  if (!creating && (!Number.isSafeInteger(body.revision) || body.revision < 1)) throw new SourceError(400, 'Source update requires revision equal to the current source version.');
  if (!creating && Object.keys(fields).length === 0) throw new SourceError(400, 'Provide at least one source review field to update.');
  validateCandidate({ ...current, ...fields });
  return fields;
}

export function validateSourceRegistry(sources, projects = []) {
  if (!Array.isArray(sources)) throw new Error('invalid source registry');
  const ids = new Set(), urls = new Set(), locators = new Set();
  const keys = new Set([...FIELD_NAMES, 'canonicalUrl', 'id', 'version', 'createdAt', 'updatedAt']);
  for (const source of sources) {
    if (!record(source) || Object.keys(source).length !== keys.size || Object.keys(source).some(key => !keys.has(key))) throw new Error('invalid stored source fields');
    if (typeof source.id !== 'string' || !UUID.test(source.id) || ids.has(source.id) || !Number.isSafeInteger(source.version) || source.version < 1) throw new Error('invalid source ID or version');
    const input = Object.fromEntries(FIELD_NAMES.map(name => [name, source[name]]));
    const checked = validateSourceFields(input, { creating: true, imported: true, projects });
    // JSON comparison (not `!==`) because `aliases` is an array - reference
    // inequality would otherwise reject every legitimately unchanged record.
    for (const key of [...FIELD_NAMES, 'canonicalUrl']) if (JSON.stringify(source[key]) !== JSON.stringify(checked[key])) throw new Error('invalid normalized source fields');
    // A URL-backed and a locator-backed source dedupe on different keys -
    // two locator-only records both carrying canonicalUrl:null must never be
    // treated as colliding with each other on that shared null.
    if (source.canonicalUrl !== null) { if (urls.has(source.canonicalUrl)) throw new Error('duplicate canonical source URL'); urls.add(source.canonicalUrl); }
    else { const key = source.sourceLocator.trim().toLocaleLowerCase(); if (locators.has(key)) throw new Error('duplicate source locator'); locators.add(key); }
    for (const value of [source.createdAt, source.updatedAt]) {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== (value.includes('.') ? value : value.replace('Z', '.000Z'))) throw new Error('invalid source timestamp');
    }
    if (Date.parse(source.updatedAt) < Date.parse(source.createdAt)) throw new Error('invalid source timestamp order');
    ids.add(source.id);
  }
}

// Additive migration for a store/backup predating this slice's fields -
// every pre-existing source was necessarily url-backed, so sourceLocator
// backfills null and the other new fields take their honest defaults.
// Never overwrites a field a source already carries.
export function migrateLegacySource(source) {
  if (!Object.hasOwn(source, 'sourceLocator')) source.sourceLocator = null;
  if (!Object.hasOwn(source, 'aliases')) source.aliases = [];
  if (!Object.hasOwn(source, 'entityType')) source.entityType = 'UNRESOLVED';
  if (!Object.hasOwn(source, 'implementationStatus')) source.implementationStatus = 'idea';
  if (!Object.hasOwn(source, 'origin')) source.origin = 'user';
  return source;
}

export function planSourceImport(body, existing, projects) {
  if (!record(body) || Object.keys(body).some(key => !['sources', 'requestId'].includes(key))) throw new SourceError(400, 'Source import accepts only sources and requestId.');
  sourceRequestId(body.requestId);
  if (!Array.isArray(body.sources) || body.sources.length < 1 || body.sources.length > 100) throw new SourceError(400, 'Import requires 1–100 sources.');
  // Validate every row and every conflict before the caller assigns IDs or mutates state.
  const fields = body.sources.map(item => validateSourceFields(item, { creating: true, imported: true, projects }));
  const seen = new Set();
  return fields.map(item => {
    // A locator-based item dedupes on its normalized locator, never on the
    // shared `null` canonicalUrl every locator-based item also carries.
    const dedupeKey = item.canonicalUrl ?? `locator:${item.sourceLocator.trim().toLocaleLowerCase()}`;
    if (seen.has(dedupeKey)) throw new SourceError(409, 'Import contains duplicate canonical URLs or locators; no sources were imported.');
    seen.add(dedupeKey);
    const source = existing.find(entry => (entry.canonicalUrl ?? `locator:${entry.sourceLocator?.trim().toLocaleLowerCase()}`) === dedupeKey);
    if (source && Object.keys(item).some(key => JSON.stringify(source[key]) !== JSON.stringify(item[key]))) throw new SourceError(409, 'An existing source has different fields; no sources were imported. Review it before updating.', { source });
    return source ? { source } : { fields: item };
  });
}

export function resolveSource(sources, id) {
  const source = sources.find(item => item.id === id.trim());
  if (source) return source;
  const key = sourceSearchKey(id);
  if (!key) throw new SourceError(404, '자료 이름이나 ID를 입력하세요.');
  const exact = sources.filter(item => [item.title, ...sourceReferenceNames(item)].some(name => sourceSearchKey(name) === key));
  const matches = exact.length ? exact : sources.filter(item => sourceMatches(item, id));
  if (matches.length > 1) throw new SourceError(409, '여러 자료가 일치합니다. 자료 목록: 검색어로 확인한 뒤 자료 ID를 사용하세요.');
  if (!matches.length) throw new SourceError(404, '자료를 찾지 못했습니다. 자료 목록: 검색어로 확인하세요.');
  return matches[0];
}
const readingLabel = value => ({ unread: '미확인', partial: '일부 확인', read: '내용 확인', unavailable: '접근 불가' })[value];
const decisionLabel = value => ({ pending: '검토 대기', candidate: '개선 후보', deferred: '보류', rejected: '미채택' })[value];
export function sourceRegistryDocument(sources, { page = 1, query = '' } = {}) {
  if (!Number.isSafeInteger(page) || page < 1) throw new SourceError(400, '자료 목록 페이지는 1 이상의 정수여야 합니다.');
  if (typeof query !== 'string' || query.length > 160) throw new SourceError(400, '자료 검색어는 160자 이내로 입력하세요.');
  const filtered = sources.filter(source => sourceMatches(source, query));
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  if (page > pages) throw new SourceError(400, `자료 목록은 ${pages}페이지까지 있습니다.`);
  const shown = filtered.slice((page - 1) * 50, page * 50);
  const command = number => `자료 목록 ${number}${query ? `: ${query}` : ''}`;
  const navigation = [page > 1 ? `이전: ${command(page - 1)}` : '', page < pages ? `다음: ${command(page + 1)}` : ''].filter(Boolean).join('\n');
  const urlLabel = source => source.canonicalUrl === null ? `확인된 외부 링크 없음 · 주제: ${source.sourceLocator}` : (source.canonicalUrl.length > 1000 ? `${source.canonicalUrl.slice(0, 1000)}… (긴 주소는 브리핑에서 확인)` : source.canonicalUrl);
  return `# BLACKHOLE 개선 자료 목록\n\n등록 자료: ${sources.length}개\n표시 ${shown.length}개 / 전체 ${sources.length}개. 검색 결과 ${filtered.length}개 · ${page}/${pages}페이지. 한 페이지 50개이며 긴 주소는 1000자까지 표시합니다.\n${navigation}\n검색: 자료 목록: 검색어\n전체 주소와 검토 내용: 자료 브리핑: 이름 또는 ID\n\n${shown.length ? shown.map(source => `## ${source.title}\n${sourceReferenceNames(source).length ? `- 원본 자료명(검증 전 이름): ${sourceReferenceNames(source).join(' · ')}\n` : ''}${source.aliases.length ? `- 별칭: ${source.aliases.join(' · ')}\n` : ''}- ID: ${source.id}\n- 분류: ${source.entityType} · 구현 상태: ${source.implementationStatus}\n- 내용 확인: ${readingLabel(source.readingStatus)}\n- 적용 판단: ${decisionLabel(source.decision)}\n- 출처: ${urlLabel(source)}`).join('\n\n') : '조건에 맞는 자료가 없습니다.'}\n\n자료 등록·후보 검토는 기능 구현 완료가 아닙니다. 이 문서는 저장한 자료 정보로 작성했습니다. 이 작업에서 외부 링크 조회·AI 호출·코드 작성·검사·배포를 수행하지 않았습니다.`;
}
export function sourceBriefDocument(source, candidate = false) {
  if (candidate && source.decision !== 'candidate') throw new SourceError(409, 'This source is not an improvement candidate. Complete its reading and application review first.');
  const locatorLine = source.canonicalUrl === null ? `- 확인된 외부 링크 없음 · 주제/아이디어명: ${source.sourceLocator}` : `- 원래 URL: ${source.url}\n- 정규 URL: ${source.canonicalUrl}`;
  return `# ${source.title} — ${candidate ? '개선 후보 준비서' : '자료 브리핑'}\n\n- 원본 자료명(검증 전 이름): ${sourceReferenceNames(source).join(" · ") || "별도 기록 없음"}\n${source.aliases.length ? `- 별칭: ${source.aliases.join(' · ')}\n` : ''}- 자료 ID: ${source.id}\n- 자료 버전: ${source.version}\n${locatorLine}\n- 분류: ${source.entityType} · 출처: ${source.origin} · 구현 상태: ${source.implementationStatus}\n- 프로젝트 ID: ${source.projectId ?? '미연결'}\n- 내용 확인: ${readingLabel(source.readingStatus)}\n- 적용 판단: ${decisionLabel(source.decision)}\n\n## 확인한 내용\n${source.summary || '아직 검토 내용을 기록하지 않았습니다.'}\n\n## YENO에 적용할 방법\n${source.application || '아직 적용 방법을 기록하지 않았습니다.'}\n\n## 권리·개인정보·이용조건과 남은 쟁점\n${source.riskNotes || '아직 확인한 내용이나 남은 쟁점을 기록하지 않았습니다.'}\n\n## 현재 실행 범위\n이 문서는 저장된 검토 기록을 정리한 ${candidate ? '개선 후보 준비서' : '브리핑'}입니다. 내용 확인 상태는 등록된 검토 기록이며 이 코어가 원문을 직접 조회했다는 뜻이 아닙니다. 외부 링크 조회·AI 호출·코드 작성·검사·배포를 수행하지 않았습니다. 개발 작업자는 미연결입니다. 개선 후보 등록은 구현·검사 통과·운영 적용 또는 법적 무문제를 보장하지 않습니다.`;
}

// BLACKHOLE §C mandatory search cases: registered once, additively, as
// topic-only intake so a fresh or existing store always finds these named
// backlog items - honestly pending/idea, never promoted by the mere act of
// seeding. Classification comes straight from the historical backlog
// document (never guessed), and 엔화/FX is deliberately kept as an
// unresolved original-request marker, never an implemented strategy (see
// the doc's own correction: the user's JPY mention is confirmed, but
// USD/JPY carry-trade was the assistant's own proposal, not a user decision).
const REQUIRED_INTAKE_SEEDS = Object.freeze([
  { title: '자동매매', entityType: 'RND', summary: '자동매매는 확인된 사용자 요구다. 관찰→백테스트→모의투자만 후보 범위이며, 실거래 API·지갑 연결은 없다.' },
  { title: '엔화(JPY) 원요청', aliases: ['엔화'], entityType: 'RND', summary: 'JPY 관련 사용자 원문은 확인되나 USD/JPY·캐리트레이드 해석은 assistant의 제안이었다. 사용자 확정 전략으로 취급하지 않고 원문 재확인이 필요하다.' },
  { title: '당근 인플루언서', aliases: ['당근'], entityType: 'OPS', summary: '당근 인플루언서/Daangn Story 콘텐츠 플래너 후보.' },
  { title: 'PhytoMotive', aliases: ['식물로봇'], entityType: 'HW', summary: '식물 로봇 센서·actuator 프로토타입 후보.' },
  { title: 'Scrapagotchi', aliases: ['다마고치', '음식물쓰레기', '음식물쓰레기 처리기'], entityType: 'HW', summary: '다마고치형 음식물 처리기 후보.' },
  { title: '산양게임', entityType: 'IP', summary: '산양 이동·1스테이지 게임 프로토타입 후보. 사냥게임으로 명칭을 교정하지 않는다.' },
  { title: '코리아타운 청소게임', aliases: ['코리아타운'], entityType: 'IP', summary: '가상 블록 청소 게임 후보. 장르 미확정.' },
  { title: '소설 IP 스튜디오', aliases: ['소설'], entityType: 'IP', summary: 'B04 소설·캐릭터·게임 IP 스튜디오 백로그 묶음.' },
  { title: 'Grok Bot', aliases: ['Grok'], entityType: 'REF', summary: 'Grok Bot(native 앱)과 xAI Grok API는 별개 대상이다. 공식 connector/API 범위만 연결한다.' },
]);
// The one required term with an already-confirmed real public URL - the
// exact same source absorption-routing.mjs's reviewedRoute() already maps
// to the real World/God Eye feature. Seeded url-based like any owner
// submission, never as a topic-only locator, because a real link already
// exists for it.
const GOD_EYE_URL_SEED = { url: 'https://instagram.com/reel/DcjMGA9vHxU', title: 'God Eye', entityType: 'SYS', summary: '세계 상황판(World) 기능이 실제로 참조하는 원출처. 지진 조회 구현·검사는 완료, 확장 레이어는 미연결.' };

function alreadyNamed(sources, keyword) {
  const key = keyword.toLocaleLowerCase();
  return sources.some(source => [source.title, source.sourceLocator, ...(source.aliases ?? [])].some(name => typeof name === 'string' && name.toLocaleLowerCase() === key));
}

// Pure: returns only the validated creation FIELDS for a required term not
// already present under that exact name (title/sourceLocator/alias) - never
// an ID or timestamp (the caller's own record construction owns those,
// exactly like every other source creation path in this module). Never
// overwrites, merges into, or duplicates an existing entry, including one
// the owner has since renamed.
export function planRequiredIntakeSeed(sources) {
  const plans = [];
  if (!alreadyNamed(sources, 'God Eye')) plans.push(validateSourceFields({ ...GOD_EYE_URL_SEED }, { creating: true, imported: true }));
  for (const seed of REQUIRED_INTAKE_SEEDS) {
    if (alreadyNamed(sources, seed.title) || (seed.aliases ?? []).some(alias => alreadyNamed(sources, alias))) continue;
    plans.push(validateSourceFields({ sourceLocator: seed.title, title: seed.title, aliases: seed.aliases ?? [], entityType: seed.entityType, summary: seed.summary }, { creating: true, imported: true }));
  }
  return plans;
}
