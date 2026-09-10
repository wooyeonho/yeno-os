import { isIP } from 'node:net';

export class SourceError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FIELD_NAMES = ['url', 'title', 'projectId', 'readingStatus', 'decision', 'summary', 'application', 'riskNotes'];
const READING = new Set(['unread', 'partial', 'read', 'unavailable']);
const DECISIONS = new Set(['pending', 'candidate', 'deferred', 'rejected']);

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

export function validateSourceFields(body, { creating = false, imported = false, projects = [], current } = {}) {
  if (!record(body)) throw new SourceError(400, 'A source must be a JSON object.');
  const allowed = new Set([...(creating ? FIELD_NAMES : FIELD_NAMES.filter(name => name !== 'url')), ...(imported ? [] : ['requestId']), ...(creating ? [] : ['revision'])]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new SourceError(400, 'Unknown or immutable source field. Original url and canonicalUrl cannot be changed; register another source.');
  if (!imported) sourceRequestId(body.requestId);
  const fields = creating ? { projectId: null, readingStatus: 'unread', decision: 'pending', summary: '', application: '', riskNotes: '' } : {};
  if (creating) Object.assign(fields, sourceUrl(body.url));
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
  if (!creating && (!Number.isSafeInteger(body.revision) || body.revision < 1)) throw new SourceError(400, 'Source update requires revision equal to the current source version.');
  if (!creating && Object.keys(fields).length === 0) throw new SourceError(400, 'Provide at least one source review field to update.');
  validateCandidate({ ...current, ...fields });
  return fields;
}

export function validateSourceRegistry(sources, projects = []) {
  if (!Array.isArray(sources)) throw new Error('invalid source registry');
  const ids = new Set(), urls = new Set();
  const keys = new Set([...FIELD_NAMES, 'canonicalUrl', 'id', 'version', 'createdAt', 'updatedAt']);
  for (const source of sources) {
    if (!record(source) || Object.keys(source).length !== keys.size || Object.keys(source).some(key => !keys.has(key))) throw new Error('invalid stored source fields');
    if (typeof source.id !== 'string' || !UUID.test(source.id) || ids.has(source.id) || !Number.isSafeInteger(source.version) || source.version < 1) throw new Error('invalid source ID or version');
    const input = Object.fromEntries(FIELD_NAMES.map(name => [name, source[name]]));
    const checked = validateSourceFields(input, { creating: true, imported: true, projects });
    for (const key of [...FIELD_NAMES, 'canonicalUrl']) if (source[key] !== checked[key]) throw new Error('invalid normalized source fields');
    if (urls.has(source.canonicalUrl)) throw new Error('duplicate canonical source URL');
    for (const value of [source.createdAt, source.updatedAt]) {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== (value.includes('.') ? value : value.replace('Z', '.000Z'))) throw new Error('invalid source timestamp');
    }
    if (Date.parse(source.updatedAt) < Date.parse(source.createdAt)) throw new Error('invalid source timestamp order');
    ids.add(source.id); urls.add(source.canonicalUrl);
  }
}

export function planSourceImport(body, existing, projects) {
  if (!record(body) || Object.keys(body).some(key => !['sources', 'requestId'].includes(key))) throw new SourceError(400, 'Source import accepts only sources and requestId.');
  sourceRequestId(body.requestId);
  if (!Array.isArray(body.sources) || body.sources.length < 1 || body.sources.length > 100) throw new SourceError(400, 'Import requires 1–100 sources.');
  // Validate every row and every conflict before the caller assigns IDs or mutates state.
  const fields = body.sources.map(item => validateSourceFields(item, { creating: true, imported: true, projects }));
  const seen = new Set();
  return fields.map(item => {
    if (seen.has(item.canonicalUrl)) throw new SourceError(409, 'Import contains duplicate canonical URLs; no sources were imported.');
    seen.add(item.canonicalUrl);
    const source = existing.find(entry => entry.canonicalUrl === item.canonicalUrl);
    if (source && Object.keys(item).some(key => source[key] !== item[key])) throw new SourceError(409, 'An existing source has different fields; no sources were imported. Review it before updating.', { source });
    return source ? { source } : { fields: item };
  });
}

export function resolveSource(sources, id) {
  const source = sources.find(item => item.id === id.trim());
  if (!source) throw new SourceError(404, 'Source not found. Use its registered ID.');
  return source;
}
const readingLabel = value => ({ unread: '미확인', partial: '일부 확인', read: '내용 확인', unavailable: '접근 불가' })[value];
const decisionLabel = value => ({ pending: '검토 대기', candidate: '개선 후보', deferred: '보류', rejected: '미채택' })[value];
export function sourceRegistryDocument(sources) {
  const shown = sources.slice(0, 50);
  const urlLabel = value => value.length > 1000 ? `${value.slice(0, 1000)}… (긴 주소는 브리핑에서 확인)` : value;
  return `# YENO 개선 자료 목록\n\n등록 자료: ${sources.length}개\n표시 ${shown.length}개 / 전체 ${sources.length}개. 목록은 최대 50개이며 긴 주소는 1000자까지 표시합니다.\n전체 주소와 검토 내용은 “자료 브리핑: ID”로 확인하세요.\n\n${shown.length ? shown.map(source => `## ${source.title}\n- ID: ${source.id}\n- 내용 확인: ${readingLabel(source.readingStatus)}\n- 적용 판단: ${decisionLabel(source.decision)}\n- 출처: ${urlLabel(source.canonicalUrl)}`).join('\n\n') : '등록된 자료가 없습니다.'}\n\n이 문서는 저장한 자료 정보로 작성했습니다. 이 작업에서 외부 링크 조회·AI 호출·코드 작성·검사·배포를 수행하지 않았습니다.`;
}
export function sourceBriefDocument(source, candidate = false) {
  if (candidate && source.decision !== 'candidate') throw new SourceError(409, 'This source is not an improvement candidate. Complete its reading and application review first.');
  return `# ${source.title} — ${candidate ? '개선 후보 준비서' : '자료 브리핑'}\n\n- 자료 ID: ${source.id}\n- 자료 버전: ${source.version}\n- 원래 URL: ${source.url}\n- 정규 URL: ${source.canonicalUrl}\n- 프로젝트 ID: ${source.projectId ?? '미연결'}\n- 내용 확인: ${readingLabel(source.readingStatus)}\n- 적용 판단: ${decisionLabel(source.decision)}\n\n## 확인한 내용\n${source.summary || '아직 검토 내용을 기록하지 않았습니다.'}\n\n## YENO에 적용할 방법\n${source.application || '아직 적용 방법을 기록하지 않았습니다.'}\n\n## 권리·개인정보·이용조건과 남은 쟁점\n${source.riskNotes || '아직 확인한 내용이나 남은 쟁점을 기록하지 않았습니다.'}\n\n## 현재 실행 범위\n이 문서는 저장된 검토 기록을 정리한 ${candidate ? '개선 후보 준비서' : '브리핑'}입니다. 내용 확인 상태는 등록된 검토 기록이며 이 코어가 원문을 직접 조회했다는 뜻이 아닙니다. 외부 링크 조회·AI 호출·코드 작성·검사·배포를 수행하지 않았습니다. 개발 작업자는 미연결입니다. 개선 후보 등록은 구현·검사 통과·운영 적용 또는 법적 무문제를 보장하지 않습니다.`;
}
