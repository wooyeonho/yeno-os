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
const core = await start({host: '127.0.0.1', port: 0, dataDir, token: owner, env: {YENO_ALLOWED_HOSTS: 'acceptance.example.ts.net:9443'}});
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

const outDir = new URL('../../build-artifacts/handoff-r3-20260926/distinct-job-title-browser/', import.meta.url);
mkdirSync(outDir, {recursive: true});
const outPath = name => fileURLToPath(new URL(name, outDir));

const executablePath = process.env.YENO_CHROMIUM_PATH || undefined;
const VIEWPORTS = [
  {width: 360, height: 780, label: '360px'},
  {width: 430, height: 900, label: '430px'},
];

function mockTauri(settings) {
  const vault = new Map(), savedFiles = new Map(), callbacks = new Map();
  let sequence = 0, saveCount = 0;
  const activeRequests = new Map(), responses = new Map();
  async function invoke(command, args = {}, options = {}) {
    if (command === 'local_resident_origin') return '';
    if (command === 'plugin:barcode-scanner|scan') {
      const response = await fetch(settings.proxyOrigin + '/api/v1/pairing/invites', {
        method: 'POST', headers: {authorization: `Bearer ${settings.owner}`, 'content-type': 'application/json'},
        body: JSON.stringify({requestId: crypto.randomUUID()}),
      });
      if (!response.ok) throw new Error('Synthetic QR issuance failed');
      return {content: JSON.stringify({version: 1, ...(await response.json()).invitation}), format: 'QR_CODE', bounds: null};
    }
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
      const route = new URL(c.url);
      if (route.origin !== 'https://acceptance.example.ts.net:9443') throw new Error('Unexpected native HTTP origin');
      const artifactFault = route.pathname.startsWith('/api/v1/artifacts/') ? window.__artifactFault : null;
      if (artifactFault) window.__artifactFault = null;
      const path = artifactFault === 'missing' ? `/api/v1/artifacts/${crypto.randomUUID()}` : route.pathname;
      const response = await fetch(settings.proxyOrigin + path + route.search, {method: c.method, headers: c.headers, ...(c.data ? {body: new Uint8Array(c.data)} : {})});
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (artifactFault === 'corrupt' && response.ok) bytes[bytes.length - 1] ^= 1;
      responses.set(args.rid, bytes);
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
const contrastReadings = [];
try {
  browser = await chromium.launch(executablePath ? {headless: true, executablePath} : {headless: true, channel: 'msedge'});
  for (const viewport of VIEWPORTS) {
    const beforeDevices = await fetch(`${proxyOrigin}/api/devices`, {headers: {authorization: `Bearer ${owner}`}});
    if (beforeDevices.status !== 200) throw new Error('Owner device inventory failed before browser pairing');
    const priorDeviceIds = new Set((await beforeDevices.json()).devices.map(device => device.id));
    const context = await browser.newContext({viewport: {width: viewport.width, height: viewport.height}, isMobile: true, hasTouch: true});
    await context.addInitScript(mockTauri, {proxyOrigin, owner});
    const page = await context.newPage();
    try {
      await page.goto(proxyOrigin, {waitUntil: 'networkidle'});
      await page.locator('#scan-invitation').click();
      await page.waitForFunction(() => document.querySelector('#origin')?.value === 'https://acceptance.example.ts.net:9443');
      await page.locator('#vault-password').fill('synthetic-unlock-password');
      await page.locator('#pair-button').click();
      await page.locator('#workspace').waitFor({state: 'visible', timeout: 10000});
      await page.locator('#live-voice').waitFor({state: 'visible', timeout: 10000});

      // 1) Empty-state Home, first fold only (no scroll).
      await page.screenshot({path: outPath(`home-empty-${viewport.label}.png`)});

      await page.locator('#text').fill('목표: 연결 상태 오류 표시를 확인해줘.');
      await page.locator('#submit-command').click();
      await page.locator('#message').filter({hasText: '주 모델 연결이 필요합니다'}).waitFor({timeout: 10000});
      if (await page.locator('#connection').textContent() !== '코어 응답 확인됨') {
        throw new Error('A responsive core rejection appeared as PC offline');
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({path: outPath(`rejection-status-${viewport.label}.png`)});
      await page.locator('#message').scrollIntoViewIfNeeded();
      await page.screenshot({path: outPath(`rejection-${viewport.label}.png`)});

      // 2) A real memory receipt (synchronous, no AI/job queue needed) so
      // "latest result" and the status line reflect real, not fabricated, data.
      await page.locator('#text').fill('기억해: 모바일 화면 검증용 기록');
      await page.locator('#submit-command').click();
      await page.locator('#command-result').waitFor({state: 'visible', timeout: 10000});
      await page.screenshot({path: outPath(`home-with-result-${viewport.label}.png`)});

      // 3) Two real document requests must have distinct titles in Work.
      const firstTitle = `모바일 ${viewport.label} 화면 검증용 문서 첫 번째`;
      const secondTitle = `모바일 ${viewport.label} 화면 검증용 문서 두 번째`;
      await page.locator('#text').fill(`문서 만들어: 모바일 ${viewport.label} 화면 검증용 문서 첫 번째`);
      await page.locator('#submit-command').click();
      await page.locator('#receipt-meta').filter({hasText: `모바일 ${viewport.label} 화면 검증용 문서 첫 번째`}).waitFor({timeout: 10000});
      await page.locator('#text').fill(`문서 만들어: 모바일 ${viewport.label} 화면 검증용 문서 두 번째`);
      await page.locator('#submit-command').click();
      await page.locator('#receipt-meta').filter({hasText: `모바일 ${viewport.label} 화면 검증용 문서 두 번째`}).waitFor({timeout: 10000});
      await page.locator('[data-native-view="jobs"]').click();
      await page.locator('#jobs .job').filter({hasText: firstTitle}).waitFor({timeout: 10000});
      await page.locator('#jobs .job').filter({hasText: secondTitle}).waitFor({timeout: 10000});
      if (await page.locator('#jobs .job').filter({hasText: firstTitle}).count() !== 1 || await page.locator('#jobs .job').filter({hasText: secondTitle}).count() !== 1) throw new Error('Expected one distinct card for each current-viewport request');
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Document titles caused horizontal overflow');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({path: outPath(`work-${viewport.label}.png`)});

      // A Work card is only a receipt. Verify the actual completed file can
      // be opened and that the app confirms its bytes against the core hash.
      const firstCard = page.locator('#jobs .job').filter({hasText: firstTitle});
      await firstCard.locator('button.artifact').waitFor({timeout: 15000});
      const artifactContrast = await firstCard.locator('button.artifact').evaluate(button => {
        const {color, backgroundColor} = getComputedStyle(button);
        const luminance = value => {
          const channels = value.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(channel => {
            const scaled = Number(channel) / 255;
            return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
          });
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const foreground = luminance(color), background = luminance(backgroundColor);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
      if (artifactContrast < 4.5) throw new Error(`Artifact button text contrast is ${artifactContrast.toFixed(2)}:1`);
      contrastReadings.push({viewport: viewport.label, ratio: Number(artifactContrast.toFixed(2))});
      await firstCard.locator('button.artifact').click();
      await page.locator('#artifact-result').waitFor({state: 'visible', timeout: 10000});
      const artifactMeta = await page.locator('#artifact-meta').textContent();
      const artifactBody = await page.locator('#artifact-body').textContent();
      if (!artifactMeta?.includes('SHA-256 확인됨') || !artifactBody?.includes(firstTitle)) {
        throw new Error('Completed phone request did not open a SHA-checked matching result');
      }
      await page.locator('#artifact-result').scrollIntoViewIfNeeded();
      await page.screenshot({path: outPath(`result-${viewport.label}.png`)});

      const beforeMissing = await page.locator('#message').textContent();
      await page.evaluate(() => { window.__artifactFault = 'missing'; });
      await firstCard.locator('button.artifact').click();
      await page.waitForFunction(previous => { const current = document.querySelector('#message')?.textContent?.trim(); return current && current !== previous; }, beforeMissing?.trim() || '', {timeout: 10000});
      if (await page.locator('#connection').textContent() !== '코어 응답 확인됨' || await page.locator('#artifact-result').isVisible()) {
        throw new Error('Missing artifact was shown as PC offline or as a verified result');
      }
      await page.evaluate(() => { window.__artifactFault = 'corrupt'; });
      await firstCard.locator('button.artifact').click();
      await page.locator('#message').filter({hasText: 'SHA-256이 일치하지 않아'}).waitFor({timeout: 10000});
      if (await page.locator('#connection').textContent() !== '코어 응답 확인됨' || await page.locator('#artifact-result').isVisible()) {
        throw new Error('Corrupt artifact was shown as PC offline or as a verified result');
      }
      await page.screenshot({path: outPath(`artifact-integrity-error-${viewport.label}.png`)});

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

      const afterDevices = await fetch(`${proxyOrigin}/api/devices`, {headers: {authorization: `Bearer ${owner}`}});
      if (afterDevices.status !== 200) throw new Error('Owner device inventory failed after browser pairing');
      const enrolledDeviceId = (await afterDevices.json()).devices.find(device => !priorDeviceIds.has(device.id))?.id;
      if (!enrolledDeviceId) throw new Error('Current browser viewport did not enroll a device');
      const revoked = await fetch(`${proxyOrigin}/api/devices/${encodeURIComponent(enrolledDeviceId)}/revoke`, {
        method: 'POST', headers: {authorization: `Bearer ${owner}`, 'content-type': 'application/json'},
        body: JSON.stringify({requestId: crypto.randomUUID()}),
      });
      if (revoked.status !== 200) throw new Error(`Owner revocation failed: HTTP ${revoked.status}`);
      await page.locator('[data-native-view="jobs"]').click();
      await page.locator('[data-native-view="studio"]').click();
      await page.locator('#connection').filter({hasText: '기기 인증 거부됨'}).waitFor({timeout: 10000});
      if ((await page.locator('#message').textContent())?.includes('SHA-256')) {
        throw new Error('Stale artifact-integrity alert obscures the revoked-device recovery guidance');
      }
      await page.locator('#connection-guidance').waitFor({state: 'visible', timeout: 10000});
      if (!(await page.locator('#submit-command').isDisabled()) || !(await page.locator('#stop').isDisabled())) {
        throw new Error('Revoked device still allows command or emergency control submission');
      }
      await page.locator('[data-native-view="jobs"]').click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({path: outPath(`revoked-status-${viewport.label}.png`)});
      await page.locator('.connection-tools summary').click();
      await page.locator('#local-forget').waitFor({state: 'visible', timeout: 10000});
      if (!(await page.locator('#disconnect').isDisabled())) throw new Error('Server revocation is still offered with rejected authentication');
      await page.locator('#local-forget').scrollIntoViewIfNeeded();
      await page.screenshot({path: outPath(`revoked-recovery-${viewport.label}.png`)});
      await page.locator('[data-native-view="studio"]').click();
      if (!(await page.locator('.living-voice-cta').isDisabled())) throw new Error('Home voice CTA is still offered with rejected authentication');
      await page.screenshot({path: outPath(`revoked-home-${viewport.label}.png`)});
      await page.locator('#connection-guidance').scrollIntoViewIfNeeded();
      await page.screenshot({path: outPath(`revoked-guidance-${viewport.label}.png`)});
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({ok: true, outDir: outDir.pathname, viewports: VIEWPORTS.map(v => v.label), artifactButtonContrast: contrastReadings, completedResultScreenshots: VIEWPORTS.map(v => `result-${v.label}.png`), rejectionScreenshots: VIEWPORTS.map(v => [`rejection-status-${v.label}.png`, `rejection-${v.label}.png`]).flat(), artifactIntegrityScreenshots: VIEWPORTS.map(v => `artifact-integrity-error-${v.label}.png`), revokedScreenshots: VIEWPORTS.map(v => [`revoked-status-${v.label}.png`, `revoked-recovery-${v.label}.png`, `revoked-home-${v.label}.png`, `revoked-guidance-${v.label}.png`]).flat()}, null, 2));
} finally {
  await browser?.close();
  proxy.close();
  core.shutdown();
  rmSync(dataDir, {recursive: true, force: true});
}
