// Real Chromium, real CSS layout, real running core - the one thing
// verify-ui.mjs's jsdom harness structurally cannot show, since jsdom has no
// layout engine. This drives the actual built dist/ bundle in a real browser
// at real phone widths and saves PNG evidence for issue #24's 360px/430px
// requirement.
//
// The built bundle imports @tauri-apps/plugin-http's fetch, which calls
// window.__TAURI_INTERNALS__.invoke - absent outside a real Tauri runtime,
// so it is mocked here exactly like verify-ui.mjs's jsdom harness, except
// the HTTP leg is a REAL browser fetch. A real browser enforces CORS/Origin,
// and the core's own checkHost() independently rejects a request whose
// Origin doesn't match its Host - so instead of disabling browser security,
// this serves the built dist/ AND proxies /api/* to the real core from one
// single origin (a plain Node http proxy, headers passed through
// unmodified), making every request genuinely same-origin.
import {createRequire} from 'node:module';
import {readFileSync, mkdtempSync, rmSync, existsSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {start} from '../../runtime/server.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const dataDir = mkdtempSync(join(tmpdir(), 'blackhole-mobile-shot-'));
const owner = 'synthetic-mobile-shot-owner-key';
const core = await start({host: '127.0.0.1', port: 0, dataDir, token: owner, env: {}});
const corePort = core.server.address().port;

const distDir = new URL('./dist/', import.meta.url);
const MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'};

const proxy = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  const servePath = path === '/' ? '/index.html' : path;
  const filePath = new URL('.' + servePath, distDir);
  if (req.method === 'GET' && existsSync(filePath)) {
    res.writeHead(200, {'Content-Type': MIME[extname(servePath)] || 'application/octet-stream'});
    res.end(readFileSync(filePath));
    return;
  }
  const upstream = http.request({host: '127.0.0.1', port: corePort, path: req.url, method: req.method, headers: req.headers}, upstreamRes => {
    res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', error => { res.writeHead(502); res.end(String(error)); });
  req.pipe(upstream);
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const proxyOrigin = `http://127.0.0.1:${proxy.address().port}`;

const outDir = new URL('./mobile-evidence/', import.meta.url);
mkdirSync(outDir, {recursive: true});
const outPath = name => fileURLToPath(new URL(name, outDir));

const executablePath = process.env.YENO_CHROMIUM_PATH || undefined;
const VIEWPORTS = [
  {width: 360, height: 780, label: '360px'},
  {width: 430, height: 900, label: '430px'},
];

function mockTauri() {
  const vault = new Map(), savedFiles = new Map(), callbacks = new Map();
  let sequence = 0, saveCount = 0;
  const activeRequests = new Map(), responses = new Map();
  async function invoke(command, args = {}, options = {}) {
    if (command === 'plugin:path|resolve_directory') return '/synthetic-app-data';
    if (command === 'plugin:path|join') return args.paths.join('/');
    if (command.startsWith('plugin:stronghold|')) {
      if (command.endsWith('|get_store_record')) return vault.get(args.key) ?? null;
      if (command.endsWith('|save_store_record')) vault.set(args.key, args.value);
      if (command.endsWith('|remove_store_record')) vault.delete(args.key);
      return null;
    }
    if (command === 'plugin:http|fetch') { const id = ++sequence; activeRequests.set(id, args.clientConfig); return id; }
    if (command === 'plugin:http|fetch_send') {
      const c = activeRequests.get(args.rid);
      const response = await fetch(c.url, {method: c.method, headers: c.headers, ...(c.data ? {body: new Uint8Array(c.data)} : {})});
      responses.set(args.rid, new Uint8Array(await response.arrayBuffer()));
      return {status: response.status, statusText: response.statusText, url: c.url, headers: [...response.headers], rid: args.rid};
    }
    if (command === 'plugin:http|fetch_read_body') {
      const body = responses.get(args.rid);
      args.streamChannel.onmessage(new Uint8Array([...body, 0]));
      args.streamChannel.onmessage(new Uint8Array([1]));
      responses.delete(args.rid); activeRequests.delete(args.rid);
      return;
    }
    if (command === 'plugin:http|fetch_cancel') return;
    if (command === 'plugin:dialog|save') return `content://synthetic-picker/${++saveCount}/${args.options.defaultPath}`;
    if (command === 'plugin:fs|write_file') { savedFiles.set(decodeURIComponent(options.headers.path), new Uint8Array(args)); return; }
    if (command === 'plugin:fs|read_file') return new Uint8Array(savedFiles.get(args.path));
    if (command === 'plugin:opener|open_url') return;
    throw new Error(`Unexpected native IPC: ${command}`);
  }
  window.__TAURI_INTERNALS__ = {
    invoke, transformCallback: fn => { const id = ++sequence; callbacks.set(id, fn); return id; },
    unregisterCallback: id => callbacks.delete(id), metadata: {},
  };
  navigator.clipboard = navigator.clipboard || {};
  navigator.clipboard.writeText = async () => {};
}

let browser;
try {
  browser = await chromium.launch({headless: true, executablePath});
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({viewport: {width: viewport.width, height: viewport.height}, isMobile: true, hasTouch: true});
    await context.addInitScript(mockTauri);
    const page = await context.newPage();
    try {
      await page.goto(proxyOrigin, {waitUntil: 'networkidle'});
      await page.locator('#origin').fill(proxyOrigin);
      await page.locator('#pairing').fill(owner);
      await page.locator('#vault-password').fill('synthetic-unlock-password');
      await page.locator('#pair-button').click();
      await page.locator('#workspace').waitFor({state: 'visible', timeout: 10000});
      await page.locator('#live-voice').waitFor({state: 'visible', timeout: 10000});

      // 1) Empty-state Home, first fold only (no scroll).
      await page.screenshot({path: outPath(`home-empty-${viewport.label}.png`)});

      // 2) A real memory receipt (synchronous, no AI/job queue needed) so
      // "latest result" and the status line reflect real, not fabricated, data.
      await page.locator('#text').fill('기억해: 모바일 화면 검증용 기록');
      await page.locator('#submit-command').click();
      await page.locator('#command-result').waitFor({state: 'visible', timeout: 10000});
      await page.screenshot({path: outPath(`home-with-result-${viewport.label}.png`)});

      // 3) A real queued job, visible on the Work (작업) tab.
      await page.locator('#text').fill('문서 만들어: 모바일 화면 검증용 문서');
      await page.locator('#submit-command').click();
      await page.locator('#command-result').getByText('작업을 접수했습니다').waitFor({timeout: 10000});
      await page.locator('[data-native-view="jobs"]').click();
      await page.locator('.job').first().waitFor({timeout: 10000});
      await page.screenshot({path: outPath(`work-${viewport.label}.png`)});

      // 4) Emergency stop, from the real /api/control endpoint.
      await page.locator('#stop').click();
      await page.locator('#stop', {hasText: '전체 멈춤 해제'}).waitFor({timeout: 10000});
      await page.screenshot({path: outPath(`work-emergency-stop-${viewport.label}.png`)});
      await page.locator('#stop').click();
      await page.locator('#stop', {hasText: '전체 멈춤'}).waitFor({timeout: 10000});

      // 5) God Eye tab.
      await page.locator('[data-native-view="world"]').click();
      await page.locator('#tab-world').waitFor({state: 'visible'});
      await page.screenshot({path: outPath(`godeye-${viewport.label}.png`)});

      // 6) Home again, then open 고급 도구 (advanced tools) and confirm
      // Studio actually renders/functions inside it. Screenshots here are
      // real (non-fullPage) viewport captures at real scroll positions -
      // fullPage screenshots of a page with a position:fixed nav render that
      // nav duplicated/overlapping mid-composite (a known Playwright/
      // Chromium artifact, confirmed by comparing against these), which is
      // not what an actual device shows while scrolling.
      await page.locator('[data-native-view="studio"]').click();
      await page.locator('.tools-drawer summary').click();
      await page.locator('.studio-tabs').waitFor({state: 'visible', timeout: 10000});
      await page.screenshot({path: outPath(`tools-open-${viewport.label}.png`)});
      await page.locator('text=BLACKHOLE STUDIO').scrollIntoViewIfNeeded();
      await page.screenshot({path: outPath(`tools-scrolled-${viewport.label}.png`)});
      await page.locator('[data-studio-tab="forai"]').click();
      await page.locator('form[data-studio-form="forai"]').scrollIntoViewIfNeeded();
      await page.screenshot({path: outPath(`tools-forai-${viewport.label}.png`)});
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({ok: true, outDir: outDir.pathname, viewports: VIEWPORTS.map(v => v.label)}, null, 2));
} finally {
  await browser?.close();
  proxy.close();
  core.shutdown();
  rmSync(dataDir, {recursive: true, force: true});
}
