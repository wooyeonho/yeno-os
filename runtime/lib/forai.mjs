import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { sourceUrl } from './sources.mjs';

export const FORAI_PROJECT_ID = '909c3180-eb2b-4d30-aba3-f5d26222cb01';
export const FORAI_MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 12_000;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export class ForAiError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'ForAiError'; this.status = status; this.code = status === 408 ? 'forai_stopped_or_timed_out' : status === 502 ? 'forai_source_unavailable' : 'forai_invalid_input'; }
}
function fail(message, status) { throw new ForAiError(message, status); }
function string(value, field, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(`${field}: 비어 있지 않은 문자열을 입력하세요 (최대 ${max}자).`);
  return value.trim();
}
function publicUrl(value) {
  try {
    // Reuse the source registry's credentials, hostname and secret-query checks,
    // but retain the actual submitted origin: social aliases are not fetch targets.
    const parsed = new URL(sourceUrl(value).url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.replace(/\.$/, '');
    return parsed.href;
  } catch { fail('공개 HTTPS 페이지 주소를 입력하세요. 로그인 정보·비밀 매개변수·IP·내부 주소·사용자 지정 포트는 사용할 수 없습니다.'); }
}

export function validateForAiInput(input) {
  if (!record(input) || Object.keys(input).some(key => !['mode', 'content', 'url', 'profile'].includes(key))) fail('For-Ai 입력 필드를 확인하세요.');
  const mode = input.mode ?? (input.content !== undefined ? 'html' : 'url');
  if (!['html', 'text', 'url'].includes(mode)) fail('mode는 html, text 또는 url이어야 합니다.');
  const normalized = { mode };
  if (mode === 'url') {
    if (input.content !== undefined) fail('URL 점검에는 content를 함께 넣지 마세요.');
    normalized.url = publicUrl(input.url);
  } else {
    normalized.content = string(input.content, 'content', FORAI_MAX_BYTES);
    if (Buffer.byteLength(normalized.content, 'utf8') > FORAI_MAX_BYTES) fail('입력은 UTF-8 기준 64KiB 이하여야 합니다.');
    if (input.url !== undefined && input.url !== '') normalized.url = publicUrl(input.url);
  }
  if (input.profile !== undefined) {
    if (!record(input.profile) || Object.keys(input.profile).some(key => !['name', 'description', 'siteUrl', 'author'].includes(key))) fail('profile 필드를 확인하세요.');
    const profile = {};
    for (const [key, maximum] of [['name', 160], ['description', 1000], ['author', 160]]) if (input.profile[key] !== undefined && input.profile[key] !== '') profile[key] = string(input.profile[key], `profile.${key}`, maximum);
    if (input.profile.siteUrl !== undefined && input.profile.siteUrl !== '') profile.siteUrl = publicUrl(input.profile.siteUrl);
    normalized.profile = profile;
  }
  return normalized;
}

const blocked4 = new BlockList();
for (const [network, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked4.addSubnet(network, bits, 'ipv4');
blocked4.addAddress('168.63.129.16', 'ipv4'); // Azure platform virtual address.
const allowed6 = new BlockList(); allowed6.addSubnet('2000::', 3, 'ipv6');
const blocked6 = new BlockList();
for (const [network, bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',16]]) blocked6.addSubnet(network, bits, 'ipv6');

export function forAiAddressIsPublic(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) return !blocked4.check(address, 'ipv4');
  // Fail closed for local, mapped, transition and unallocated IPv6 ranges.
  return family === 6 && allowed6.check(address, 'ipv6') && !blocked6.check(address, 'ipv6');
}

function interrupted(signal) { if (signal?.aborted) fail('For-Ai 점검이 중단되었거나 12초 제한을 넘었습니다.', 408); }
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new ForAiError('For-Ai 점검이 중단되었거나 12초 제한을 넘었습니다.', 408));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// These transport dependencies are only a unit-test seam. The production caller
// uses native HTTPS with a DNS-pinned lookup and standard hostname/TLS checking.
// https.request does not follow redirects. No proxy, cookies, auth or subresources.
export async function fetchForAiPage({ url, signal, lookupImpl = lookup, requestImpl = request, timeoutMs = TIMEOUT_MS }) {
  const target = new URL(publicUrl(url));
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMEOUT_MS) fail('잘못된 조회 시간 제한입니다.');
  interrupted(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const addresses = await abortable(lookupImpl(target.hostname, { all: true, verbatim: true }), controller.signal);
    interrupted(controller.signal);
    if (!Array.isArray(addresses) || !addresses.length || addresses.length > 64 || addresses.some(item => !record(item) || !forAiAddressIsPublic(item.address) || item.family !== isIP(item.address))) fail('공개 주소로 확인되지 않은 DNS 응답입니다. HTML 붙여넣기를 이용하세요.');
    const pinned = addresses.find(item => item.family === 4) ?? addresses[0];
    return await new Promise((resolve, reject) => {
      let req, incoming, completed = false;
      const finish = (error, result) => {
        if (completed) return;
        completed = true; controller.signal.removeEventListener('abort', abort);
        if (error) { incoming?.destroy(); req?.destroy(); reject(error); } else resolve(result);
      };
      const abort = () => finish(new ForAiError('For-Ai 점검이 중단되었거나 12초 제한을 넘었습니다.', 408));
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) { abort(); return; }
      const options = {
        protocol: 'https:', hostname: target.hostname, port: 443,
        path: target.pathname + target.search, method: 'GET',
        agent: false, family: pinned.family, autoSelectFamily: false,
        servername: target.hostname, rejectUnauthorized: true,
        maxHeaderSize: 16 * 1024,
        lookup(hostname, options, callback) {
          if (hostname !== target.hostname) { callback(new Error('Unexpected DNS target')); return; }
          if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
          else callback(null, pinned.address, pinned.family);
        },
        headers: { Accept: 'text/html, application/xhtml+xml, text/plain;q=0.5', 'Accept-Encoding': 'identity', 'User-Agent': 'BLACKHOLE-ForAi/1.0' },
      };
      try {
        req = requestImpl(options, response => {
          incoming = response;
          response.on('error', () => finish(new ForAiError('페이지 응답을 끝까지 받지 못했습니다.', 502)));
          response.on('aborted', () => finish(new ForAiError('페이지 응답이 중간에 끊겼습니다.', 502)));
          if (response.statusCode >= 300 && response.statusCode < 400) { finish(new ForAiError('페이지가 다른 주소로 이동합니다. 브라우저에서 확인한 최종 공개 HTTPS 주소를 입력하거나 HTML을 붙여넣으세요.')); return; }
          if (response.statusCode !== 200) { finish(new ForAiError('페이지가 HTTP 200으로 응답하지 않았습니다. 로그인 없는 페이지나 HTML을 입력하세요.', 502)); return; }
          const contentType = String(response.headers['content-type'] ?? '');
          if (!/^(text\/html|application\/xhtml\+xml|text\/plain)(?:;|$)/i.test(contentType)) { finish(new ForAiError('HTML 또는 텍스트 응답만 점검할 수 있습니다.')); return; }
          const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1]?.toLowerCase();
          if (charset && !['utf-8', 'utf8', 'us-ascii'].includes(charset)) { finish(new ForAiError('이 페이지의 문자 인코딩은 지원하지 않습니다. UTF-8 HTML을 붙여넣으세요.')); return; }
          if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { finish(new ForAiError('압축 응답 대신 HTML 붙여넣기를 이용하세요.')); return; }
          const declared = response.headers['content-length'];
          if (declared !== undefined && (!/^\d+$/.test(String(declared)) || Number(declared) > FORAI_MAX_BYTES)) { finish(new ForAiError('페이지가 64KiB 제한을 넘습니다. 점검할 HTML 일부를 붙여넣으세요.')); return; }
          const chunks = []; let bytes = 0;
          response.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > FORAI_MAX_BYTES) { finish(new ForAiError('페이지가 64KiB 제한을 넘습니다. 점검할 HTML 일부를 붙여넣으세요.')); return; }
            chunks.push(Buffer.from(chunk));
          });
          response.on('end', () => {
            if (!bytes) { finish(new ForAiError('페이지 응답이 비어 있습니다.')); return; }
            const raw = Buffer.concat(chunks);
            try { new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { finish(new ForAiError('UTF-8로 읽을 수 없는 페이지입니다. HTML 붙여넣기를 이용하세요.')); return; }
            finish(null, { raw, url: target.href, contentType: contentType.slice(0, 200), status: response.statusCode, robotsHeader: String(response.headers['x-robots-tag'] ?? '').slice(0, 1000) });
          });
        });
        req.on('error', () => finish(new ForAiError('공개 페이지에 연결하지 못했습니다. 원문 HTML을 붙여넣어 점검할 수 있습니다.', 502)));
        req.end();
      } catch { finish(new ForAiError('공개 페이지에 연결하지 못했습니다.', 502)); }
    });
  } catch (error) {
    if (error instanceof ForAiError) throw error;
    throw new ForAiError('공개 페이지의 DNS 또는 연결을 확인하지 못했습니다. HTML 붙여넣기를 이용하세요.', 502);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

function decode(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (full, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? full;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\uFFFD';
  });
}
const clean = (value, max = 500) => decode(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const md = value => String(value).replace(/[<>&]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[character])).replace(/[\\`*_{}\[\]()#+.!|]/g, character => `\\${character}`).replace(/[\r\n]/g, ' ');
function attributes(value) {
  const result = Object.create(null);
  const pattern = /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of value.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!Object.hasOwn(result, name)) result[name] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}
function inspectHtml(html) {
  const observation = { titles: [], descriptions: [], canonicals: [], headings: [], robotsMeta: [], jsonLd: { total: 0, valid: 0, invalid: 0, types: [] }, sourceInfo: { authors: [], siteNames: [], published: [], modified: [] }, textCharactersOutsideHead: 0, inspectionTruncated: false };
  let position = 0, tokens = 0, capture = null, templateDepth = 0, headDepth = 0;
  const lower = html.toLowerCase();
  const add = (target, value, max = 500) => { if (target.length < 20) target.push(clean(value, max)); else observation.inspectionTruncated = true; };
  const finishCapture = () => { if (!capture) return; if (capture.tag === 'title') add(observation.titles, capture.text); else if (observation.headings.length < 30) observation.headings.push({ level: Number(capture.tag[1]), text: clean(capture.text, 200) }); else observation.inspectionTruncated = true; capture = null; };
  while (position < html.length) {
    if (++tokens > 20_000) { observation.inspectionTruncated = true; break; }
    if (html.startsWith('<!--', position)) { const end = html.indexOf('-->', position + 4); position = end < 0 ? html.length : end + 3; continue; }
    if (html[position] !== '<') {
      const next = html.indexOf('<', position), end = next < 0 ? html.length : next;
      const text = html.slice(position, end);
      if (!templateDepth) { if (capture) capture.text += text; if (!headDepth) observation.textCharactersOutsideHead += clean(text, FORAI_MAX_BYTES).length; }
      position = end; continue;
    }
    let end = position + 1, quote = '';
    for (; end < html.length; end++) { const char = html[end]; if (quote) { if (char === quote) quote = ''; } else if (char === '"' || char === "'") quote = char; else if (char === '>') break; }
    if (end >= html.length) { observation.inspectionTruncated = true; break; }
    const token = html.slice(position + 1, end), match = token.match(/^\s*(\/?)\s*([a-z][a-z0-9:-]*)(?=\s|\/|$)/i);
    position = end + 1;
    if (!match) continue;
    const closing = Boolean(match[1]), tag = match[2].toLowerCase(), attrs = closing ? {} : attributes(token.slice(match[0].length));
    if (tag === 'template') { templateDepth = Math.max(0, templateDepth + (closing ? -1 : 1)); continue; }
    if (templateDepth) continue;
    if (tag === 'head') headDepth = Math.max(0, headDepth + (closing ? -1 : 1));
    if (closing) { if (capture?.tag === tag) finishCapture(); continue; }
    if (['title', 'script', 'style', 'textarea', 'noscript', 'iframe', 'xmp'].includes(tag)) {
      const boundary = new RegExp(`</${tag}(?=[\\s>])`, 'g'); boundary.lastIndex = position;
      const closingMatch = boundary.exec(lower), close = closingMatch?.index ?? -1;
      const raw = html.slice(position, close < 0 ? html.length : close);
      if (tag === 'title') add(observation.titles, raw);
      if (tag === 'script' && (attrs.type ?? '').trim().toLowerCase() === 'application/ld+json') {
        observation.jsonLd.total++;
        if (observation.jsonLd.total > 20 || raw.length > 32 * 1024) { observation.inspectionTruncated = true; observation.jsonLd.invalid++; }
        else {
          try {
            const data = JSON.parse(raw);
            if (!record(data) && !Array.isArray(data)) throw new Error();
            observation.jsonLd.valid++;
            const pending = [data]; let count = 0;
            while (pending.length && count++ < 200) {
              const node = pending.shift();
              if (Array.isArray(node)) { pending.push(...node.slice(0, 50)); continue; }
              if (!record(node)) continue;
              for (const type of [node['@type']].flat().slice(0, 10)) if (typeof type === 'string' && observation.jsonLd.types.length < 20 && !observation.jsonLd.types.includes(clean(type, 100))) observation.jsonLd.types.push(clean(type, 100));
              if (Array.isArray(node['@graph'])) pending.push(...node['@graph'].slice(0, 50));
            }
          } catch { observation.jsonLd.invalid++; }
        }
      }
      position = close < 0 ? html.length : (html.indexOf('>', close) < 0 ? html.length : html.indexOf('>', close) + 1);
      continue;
    }
    if (/^h[1-6]$/.test(tag)) { finishCapture(); capture = { tag, text: '' }; }
    if (tag === 'meta') {
      const name = (attrs.name ?? attrs.property ?? '').toLowerCase();
      if (name === 'description') add(observation.descriptions, attrs.content ?? '');
      if (['robots', 'googlebot', 'bingbot'].includes(name)) add(observation.robotsMeta, `${name}: ${attrs.content ?? ''}`);
      if (name === 'author') add(observation.sourceInfo.authors, attrs.content ?? '', 200);
      if (name === 'og:site_name') add(observation.sourceInfo.siteNames, attrs.content ?? '', 200);
      if (name === 'article:published_time') add(observation.sourceInfo.published, attrs.content ?? '', 100);
      if (name === 'article:modified_time') add(observation.sourceInfo.modified, attrs.content ?? '', 100);
    }
    if (tag === 'link' && (attrs.rel ?? '').toLowerCase().split(/\s+/).includes('canonical')) add(observation.canonicals, attrs.href ?? '', 2048);
  }
  finishCapture();
  // A tag presence check only: this intentionally does not render CSS, JS or DOM.
  return observation;
}

function makeCandidates(profile) {
  if (!profile?.name || !profile?.description || !profile?.siteUrl) return { status: 'needs_owner_profile', schemaJson: null, llmsTxt: null, requiredFields: ['profile.name', 'profile.description', 'profile.siteUrl'] };
  const schema = { '@context': 'https://schema.org', '@type': 'WebSite', name: profile.name, description: profile.description, url: profile.siteUrl };
  if (profile.author) schema.author = { '@type': 'Person', name: profile.author };
  const schemaJson = JSON.stringify(schema, null, 2).replace(/[<>&`]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const llmsTxt = `# ${md(profile.name)}\n\n> ${md(profile.description)}\n\n## Website\n\n- [${md(profile.name)}](${profile.siteUrl.replace(/[()]/g, char => char === '(' ? '%28' : '%29')}): ${md(profile.description)}\n${profile.author ? `\nAuthor supplied by owner: ${md(profile.author)}\n` : ''}`;
  return { status: 'draft_from_owner_profile', schemaJson, llmsTxt, requiredFields: [] };
}

export async function runForAiAudit({ input, signal, fetchImpl } = {}) {
  const checked = validateForAiInput(input);
  interrupted(signal);
  // A generic fetch ignores Node's pinned lookup. Do not silently weaken the
  // URL transport if a caller supplies the shared provider fetch test seam.
  if (checked.mode === 'url' && fetchImpl !== undefined) fail('URL 점검은 DNS 고정 HTTPS 전송만 지원합니다. 일반 fetch 대체는 사용할 수 없습니다.');
  const page = checked.mode === 'url' ? await fetchForAiPage({ url: checked.url, signal }) : { raw: Buffer.from(checked.content, 'utf8'), url: checked.url ?? null, contentType: checked.mode === 'html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', status: null, robotsHeader: '' };
  interrupted(signal);
  const isHtml = /^text\/html|^application\/xhtml\+xml/i.test(page.contentType);
  const observations = isHtml ? inspectHtml(page.raw.toString('utf8')) : { textCharacters: page.raw.toString('utf8').length, htmlMetadata: 'not_observed_in_text_input' };
  const findings = [];
  const finding = (code, state, detail) => findings.push({ code, state, detail });
  if (isHtml) {
    for (const [field, code, label] of [['titles', 'title', 'title'], ['descriptions', 'description', 'description 메타'], ['canonicals', 'canonical', 'canonical 링크']]) {
      const values = observations[field];
      finding(code, values.length === 1 && values[0] ? 'observed' : 'needs_review', values.length === 0 ? `입력 HTML에서 ${label} 태그를 찾지 못했습니다.` : values.length > 1 ? `${label}가 여러 개입니다. 최종 렌더링 결과와 대표 값을 확인하세요.` : !values[0] ? `${label} 값이 비어 있습니다.` : `${label} 값 1개를 관측했습니다. 내용의 정확성은 별도 확인이 필요합니다.`);
    }
    const h1Count = observations.headings.filter(heading => heading.level === 1).length;
    finding('headings', h1Count === 1 ? 'observed' : 'needs_review', `표시 한도 내 H1 ${h1Count}개, 제목 태그 ${observations.headings.length}개를 관측했습니다. 페이지 주제와 구조를 확인하세요.`);
    finding('json_ld', observations.jsonLd.valid > 0 && observations.jsonLd.invalid === 0 ? 'observed' : 'needs_review', `JSON-LD ${observations.jsonLd.total}개: JSON 파싱 성공 ${observations.jsonLd.valid}, 실패/검사한도 ${observations.jsonLd.invalid}. Schema.org 의미·검색엔진 수용 여부는 검증하지 않았습니다.`);
    const robots = [...observations.robotsMeta, page.robotsHeader].join(' ');
    finding('robots_directives', /\b(noindex|none)\b/i.test(robots) ? 'needs_review' : robots.trim() ? 'observed' : 'unknown', /\b(noindex|none)\b/i.test(robots) ? 'noindex 또는 none 지시를 관측했습니다. 공개 색인이 목적이면 설정 의도를 확인하세요.' : robots.trim() ? 'HTML/응답 헤더의 robots 지시를 기록했습니다. 실제 크롤러 행동은 측정하지 않았습니다.' : '이 입력에서 robots 지시를 관측하지 못했습니다. 접근 허용을 뜻하지 않습니다.');
    finding('source_information', observations.sourceInfo.authors.some(Boolean) ? 'observed' : 'needs_review', observations.sourceInfo.authors.some(Boolean) ? 'author 메타를 관측했습니다. 저자 신원은 검증하지 않았습니다.' : 'author 메타가 없습니다. 페이지에 실제 저자·조직·근거를 명확히 기재했는지 확인하세요.');
    if (observations.inspectionTruncated) finding('inspection_limit', 'unknown', '태그·값·구조가 검사 한도를 넘거나 끝나지 않아 일부 관측을 생략했습니다.');
  } else finding('html_metadata', 'unknown', '일반 텍스트 입력입니다. title·메타·canonical·JSON-LD의 HTML 존재 여부는 알 수 없습니다. HTML 원문으로 재점검하세요.');
  finding('ai_visibility', 'unknown', 'AI 답변 노출·인용·순위·유입은 측정하지 않았습니다. 같은 질문·모델·조건의 실제 응답을 별도 수집해야 합니다.');
  finding('robots_txt', 'unknown', 'robots.txt 파일은 조회하지 않았습니다.');
  const candidates = makeCandidates(checked.profile);
  const evidence = {
    format: 1, projectId: FORAI_PROJECT_ID, mode: checked.mode, checkedAt: new Date().toISOString(),
    source: { url: page.url, sha256: createHash('sha256').update(page.raw).digest('hex'), bytes: page.raw.length, contentType: page.contentType, status: page.status, readMethod: checked.mode === 'url' ? 'dns_pinned_https' : 'owner_paste', robotsHeader: page.robotsHeader },
    observations, findings, candidates,
    limitations: ['서버가 받은 HTML의 태그 검사이며 브라우저 렌더링·CSS·JavaScript 실행·로그인·하위 페이지 조회를 하지 않았습니다.', '붙여넣기 입력은 사용자 제출 자료이며 입력한 URL에서 실제 내려받았다는 증거가 아닙니다.', 'AI 노출·순위·검색 색인·저자 신원·성과와 개선 효과는 미측정입니다.', 'schema.json과 llms.txt 후보는 소유자 프로필만 사용한 초안이며 자동 게시하거나 검색 노출 효과를 검증하지 않았습니다.'],
  };
  // Keep retained evidence bounded even for a deliberately dense input page.
  if (Buffer.byteLength(JSON.stringify(evidence), 'utf8') > 32 * 1024) fail('관측 결과가 저장 한도를 넘었습니다. 더 짧은 HTML로 범위를 나누어 점검하세요.');
  const rows = findings.map(item => `| ${md(item.code)} | ${{ observed: '관측', needs_review: '확인 필요', unknown: '미확인' }[item.state]} | ${md(item.detail)} |`).join('\n');
  const details = isHtml ? `\n## 관측값\n\n- title: ${observations.titles.map(md).join(' / ') || '없음'}\n- description: ${observations.descriptions.map(md).join(' / ') || '없음'}\n- canonical: ${observations.canonicals.map(md).join(' / ') || '없음'}\n- JSON-LD 유형: ${observations.jsonLd.types.map(md).join(', ') || '없음'}\n- 저자 메타: ${observations.sourceInfo.authors.map(md).join(', ') || '없음'}\n- robots: ${[...observations.robotsMeta, page.robotsHeader].filter(Boolean).map(md).join(' / ') || '관측 없음'}\n\n${observations.headings.map(heading => `- H${heading.level}: ${md(heading.text)}`).join('\n')}\n` : '';
  const drafts = candidates.schemaJson ? `\n## 소유자 프로필로 만든 적용 후보\n\n소유자가 입력한 사실만 사용했습니다. 아래 JSON은 schema.json으로, 다음 텍스트는 llms.txt로 저장할 수 있습니다. 사이트에 적용하기 전에 사실과 URL을 확인하세요. 자동 게시·노출 개선 검증은 수행하지 않았습니다.\n\n### schema.json\n\n\`\`\`json\n${candidates.schemaJson}\n\`\`\`\n\n### llms.txt\n\n\`\`\`text\n${candidates.llmsTxt}\n\`\`\`\n` : '\n## 적용 후보 생성\n\n사이트 이름·설명·공개 주소를 profile.name / profile.description / profile.siteUrl에 함께 입력하면 그 사실만으로 schema.json과 llms.txt 초안을 만듭니다.\n';
  const report = `# BLACKHOLE · For-Ai 페이지 점검\n\n점검 시각: ${evidence.checkedAt}\n입력 방식: ${checked.mode === 'url' ? '공개 HTTPS 원문 직접 조회' : '소유자 원문 붙여넣기'}\n입력 URL: ${page.url ? md(page.url) : '제공하지 않음'}\n원문 UTF-8 바이트: ${page.raw.length}\n원문 SHA-256: ${evidence.source.sha256}\n\n| 항목 | 상태 | 결과 및 다음 행동 |\n|---|---|---|\n${rows}\n${details}${drafts}\n## 점검 범위\n\n${evidence.limitations.map(value => `- ${value}`).join('\n')}\n`;
  interrupted(signal);
  return { report, evidence };
}
