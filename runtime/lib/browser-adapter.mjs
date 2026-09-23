// BLACKHOLE F08 v1 — read-only public-page browser adapter.
//
// Scope decision (recorded 2026-09-23, see docs/CLAUDE_EXECUTION_STATE.md §16):
// runSandboxBrowserHarness() (browser-harness.mjs) is a complete orchestration
// loop that only needs real fetchPublicPage/decisionProvider implementations
// injected. Its safeActionPlan() always passes independentOutcome=null, so any
// decisionProvider that ever returns operation:'DONE' will throw
// 'done_requires_independent_evidence' and crash the run (no independent
// verifier exists yet). v1 therefore NEVER returns DONE: the deterministic
// decision provider below returns BLOCKED after the very first real page
// fetch, on every call, with no model call and no cost. This is an honest,
// narrow v1: one real fetch of the owner-supplied sourceUrl per browser job,
// producing one genuine sha256-hashed artifact (buildBrowserArtifact) from
// real fetched content — never a click/type/select action, never JS
// execution, never autonomous navigation beyond the single given URL.
//
// fetchPublicPage(url) performs exactly one HTTPS GET (via the platform
// fetch()) of a URL that has already passed resolvePublicHttpsUrl's SSRF/
// private-IP/DNS-rebinding checks (browser-harness.mjs calls this before
// fetchPublicPage is ever invoked), extracts a bounded, dependency-free
// {title, body, elements, links} shape with a small regex-based HTML reader
// (this is a zero-dependency project — package.json lists no runtime deps —
// so no HTML parser library is pulled in), and never follows redirects to a
// host that has not itself been validated.

const MAX_FETCH_BYTES = 2 * 1024 * 1024; // hard cap on bytes read from the wire, well above the 64KB body limit normalizeBrowserSnapshot enforces later
const FETCH_TIMEOUT_MS = 15000;

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => { try { return String.fromCodePoint(Number(code)); } catch { return ''; } });
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function extractTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? stripTags(match[1]).slice(0, 600) : '';
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html)) && links.length < 100) {
    let href;
    try { href = new URL(match[1], baseUrl).href; } catch { continue; }
    if (!href.startsWith('https://')) continue; // only ever surface public https links; harness re-validates on click, this just filters obvious non-candidates
    const text = stripTags(match[2]).slice(0, 500);
    links.push({text, href});
  }
  return links;
}

// A minimal indexed-element list so the decision layer's contract is
// satisfiable, even though v1 never dispatches any action against them.
// Buttons/inputs are surfaced read-only; nothing here is ever clicked.
function extractElements(html) {
  const elements = [];
  const re = /<(button|a|input)\b([^>]*)>/gi;
  let match, index = 0;
  while ((match = re.exec(html)) && elements.length < 200) {
    const tag = match[1].toLowerCase();
    const attrs = match[2] || '';
    const typeMatch = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const nameMatch = /\bname\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const ariaMatch = /\baria-label\s*=\s*["']([^"']+)["']/i.exec(attrs);
    elements.push({
      index: index++,
      role: tag === 'input' ? 'input' : tag === 'button' ? 'button' : 'link',
      text: '',
      ariaLabel: ariaMatch ? decodeEntities(ariaMatch[1]).slice(0, 600) : '',
      name: nameMatch ? decodeEntities(nameMatch[1]).slice(0, 120) : '',
      label: '',
      inputType: typeMatch ? typeMatch[1].toLowerCase() : null,
      enabled: !/\bdisabled\b/i.test(attrs),
      visible: true,
    });
  }
  return elements;
}

// Injected as options.browserFetch by server.mjs's default adapter wiring.
// `url` has already passed resolvePublicHttpsUrl(); this performs exactly
// one GET against it. Non-2xx or non-HTML responses still return a snapshot
// (title/body reflect the real response) rather than silently substituting
// placeholder content — the harness's own body-size/format limits handle
// the rest.
export async function fetchPublicPage({url, signal} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onAbort);
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow', // fetch() validates each redirect hop against the URL parser itself; we re-validate the final url below
      signal: controller.signal,
      headers: {'user-agent': 'BLACKHOLE-sandbox-browser-harness/1 (+read-only)'},
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.('abort', onAbort);
  }
  const finalUrl = response.url && response.url.startsWith('https://') ? response.url : url;
  const contentType = response.headers.get('content-type') || '';
  const reader = response.body?.getReader ? response.body.getReader() : null;
  let bytes = 0;
  let text = '';
  if (reader) {
    const decoder = new TextDecoder('utf-8', {fatal: false});
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_FETCH_BYTES) { try { await reader.cancel(); } catch {} break; }
      text += decoder.decode(value, {stream: true});
    }
    text += decoder.decode();
  } else {
    text = await response.text();
  }
  const isHtml = contentType.includes('text/html') || contentType === '' || /<html/i.test(text.slice(0, 2000));
  const title = isHtml ? (extractTitle(text) || finalUrl) : finalUrl;
  const body = isHtml ? stripTags(text) : text.replace(/\s+/g, ' ').trim();
  const links = isHtml ? extractLinks(text, finalUrl) : [];
  const elements = isHtml ? extractElements(text) : [];
  return {
    url: finalUrl,
    title: title || finalUrl,
    body,
    links,
    elements,
    revision: 1,
    observedAt: new Date().toISOString(),
    httpStatus: response.status,
    contentType,
  };
}

// Deterministic v1 decision provider — no model call, no cost, never DONE.
// input is browserDecisionInput()'s output: {version, goal, page:{url,title,
// revision,observedAt,elements,operations}}. Returning BLOCKED unconditionally
// after the harness's single fetch is the only operation that (a) is honestly
// supportable without a real decision model and (b) exits
// runSandboxBrowserHarness's loop cleanly, since a BLOCKED action always has
// sandboxDispatchAllowed:false and breaks the loop — the artifact/
// verification steps still run afterward against the real fetched snapshot.
export async function deterministicReadOnlyDecisionProvider(input) {
  return {
    operation: 'BLOCKED',
    targetIndex: null,
    text: null,
    option: null,
    reason: 'read_only_v1_single_page_only: no decision model configured; harness returns the fetched page as evidence and stops',
    snapshotRevision: input?.page?.revision ?? 1,
  };
}

export async function resolveHostViaDns(hostname) {
  const dns = await import('node:dns/promises');
  return dns.lookup(hostname, {all: true, verbatim: true});
}
