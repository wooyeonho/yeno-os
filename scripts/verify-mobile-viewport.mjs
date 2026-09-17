// Real Chromium, real viewport, real layout - the one thing a jsdom test
// (see runtime/test/growth-ui.test.mjs) structurally cannot check, because
// jsdom has no CSS layout engine and cannot tell you whether real cockpit.css
// rules (which do use fixed pixel grid tracks and a real @media(max-width:650px)
// breakpoint) actually keep the growth screen inside a narrow phone's
// viewport. This script boots the real server, serves the real
// index.html/app.js/growth-view.mjs/cockpit.css exactly as a phone would
// receive them, and drives a real page with real navigation and real login.
//
// Scope: this is NOT run inside workers/developer's network-none, read-only,
// cap-dropped Docker verification sandbox (see verify-runtime.mjs) - that
// container has no browser binary and no network to fetch one, which is
// exactly why every *other* UI check that sandbox already runs
// (scripts/verify-web-ui.mjs, scripts/verify-research-ui.mjs) uses jsdom
// instead of a real browser. Adding Chromium to that hardened image is a
// separate, security-relevant infrastructure decision (bigger image, unverified
// compatibility with --cap-drop ALL/--read-only, and this project's own
// declared capabilities explicitly say browserAutomation:false) that this
// script does not make unilaterally. Run it directly: `npm run verify:mobile`.
import {createRequire} from 'node:module';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {start} from '../runtime/server.mjs';

const require = createRequire(new URL('../apps/controller/package.json', import.meta.url));
const {chromium} = require('playwright');

const dataDir = mkdtempSync(join(tmpdir(), 'blackhole-mobile-viewport-'));
const owner = 'synthetic-mobile-viewport-owner-key';
const core = await start({host: '127.0.0.1', port: 0, dataDir, token: owner, env: {}});
const origin = `http://127.0.0.1:${core.server.address().port}`;
// No hardcoded fallback path: leave it undefined so Playwright resolves its
// own installed browser the normal way unless an environment explicitly
// points at a different one (e.g. a dev container with a pre-installed
// Chromium outside Playwright's usual cache location).
const executablePath = process.env.YENO_CHROMIUM_PATH || undefined;

// The two real phone sizes the owner actually asked to verify, plus one
// wider viewport that independently reproduces the historical .cockpit-hero
// bug through real Chromium layout rather than through the deterministic
// class-name guard below. This was empirically re-verified in this session
// by reconstructing the actual pre-fix markup (per commit 38bff70's diff)
// against today's growth-view.mjs and re-running this script with the
// class-name guard below temporarily disabled: the fixed 290px
// .cockpit-hero-copy track measured 286/328px (87%) at 360px and
// 338/380px (89%) at 412px - both above the 80% threshold the
// section-width assertion below uses, confirming the width-ratio check
// alone cannot reliably catch this bug at phone widths - but the same
// markup measured only 220/779px (28%) at 1024px, which fails that
// assertion outright. So this 1024px entry is a real, independently
// re-confirmed second detector for this exact bug class, not just extra
// coverage of already-correct code. It is not a phone and is not part of
// the mobile-viewport claim.
const VIEWPORTS = [
  {width: 360, height: 800, label: '360x800', mobile: true},
  {width: 412, height: 915, label: '412x915', mobile: true},
  {width: 1024, height: 800, label: '1024x800 (historical-bug reproduction, not a phone size)', mobile: false},
];
const proof = {at: new Date().toISOString(), scope: 'real Chromium against the real running server; not a physical device', viewports: []};

let browser;
try {
  browser = await chromium.launch({headless: true, executablePath});
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({viewport: {width: viewport.width, height: viewport.height}, isMobile: viewport.mobile, hasTouch: viewport.mobile});
    const page = await context.newPage();
    try {
      await page.goto(origin, {waitUntil: 'networkidle'});
      await page.locator('.connection-alternative summary').click();
      await page.locator('#pair-token').fill(owner);
      await page.locator('#pair-form button[type="submit"]').click();
      // .sidebar-foot (which holds #connection-text) is deliberately hidden
      // below 720px by style.css's own real mobile nav layout - a hidden
      // pair-screen is the layout-agnostic real signal that login succeeded.
      await page.locator('#pair-screen').waitFor({state: 'hidden', timeout: 10000});
      await page.locator('[data-tab="control"]').waitFor({state: 'visible', timeout: 10000});

      // A real quest so "지금 하는 일"/"확인이 필요한 목표" have real content
      // to lay out, not just the empty state.
      await page.locator('[data-tab="quests"]').click();
      await page.locator('#quest-goal').fill('모바일 화면 검증용 목표를 저장한다');
      await page.locator('#quest-success').fill('실제 화면에서 잘림 없이 표시되는지 확인한다.');
      await page.locator('#quest-baseline').fill('아직 화면 검증을 하지 않았다');
      await page.locator('#save-quest').click();
      await page.locator('.quest-card').first().waitFor({timeout: 10000});

      await page.locator('[data-tab="growth"]').click();
      const growthRoot = page.locator('#growth-root');
      await growthRoot.locator('.cockpit-kirby').waitFor({timeout: 10000});

      // No horizontal overflow at this exact real viewport - the concrete
      // failure mode a fixed-pixel-track CSS grid with too few children
      // produces (see runtime/public/growth-view.mjs history).
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1, `${viewport.label}: horizontal overflow (${overflow.scrollWidth} > ${overflow.clientWidth})`);

      // A precise, deterministic regression guard for the actual historical
      // bug: .cockpit-hero is a two-column grid (a fixed 290px track plus the
      // core-orbit visual) built for the autopilot tab's hero, not a
      // single-content wrapper. Reusing it here squeezed "지금 하는 일" into
      // that fixed track - at these exact phone widths the visual loss is a
      // measured 286px of 328px (~13%, see the investigation that added this
      // line), too mild for a width-ratio heuristic to reliably catch at
      // every viewport, so this checks the actual, known cause directly
      // instead of only its narrow-viewport symptom.
      const misusedHeroClass = await growthRoot.locator('.cockpit-hero').count();
      assert.equal(misusedHeroClass, 0, `${viewport.label}: growth screen must not reuse .cockpit-hero (a two-column grid built for the autopilot core-orbit visual) for single-content sections`);

      // Every required piece of text is actually present and visible.
      const requiredText = [
        '모바일 화면 검증용 목표를 저장한다',
        'HOMUNCULUS · 일곱 욕망',
        'KIRBY · 성장 등급',
        /확인이 필요한 목표/,
        '부 · 명예 · 인지도',
        '전체 멈춤',
      ];
      for (const text of requiredText) {
        await growthRoot.getByText(text).first().waitFor({state: 'visible', timeout: 10000});
      }

      // A <section> itself is plain block flow and always fills its parent's
      // width regardless of what happens inside it - that will not reveal a
      // child squeezed into one fixed-pixel track of a CSS grid meant for two
      // children (exactly the real bug this test was written to catch, see
      // runtime/public/growth-view.mjs history). So measure each section's
      // own first direct content child instead: that is the actual grid item
      // when a section carries a multi-column grid class, and it must span
      // close to the section's width, not some narrow fixed track.
      const blockSections = await growthRoot.locator('section').all();
      assert.ok(blockSections.length >= 6, `${viewport.label}: expected at least 6 growth sections, found ${blockSections.length}`);
      for (const [index, section] of blockSections.entries()) {
        const sectionBox = await section.boundingBox();
        assert.ok(sectionBox && sectionBox.width > 0 && sectionBox.height > 0, `${viewport.label}: section #${index} has no real rendered area`);
        const firstChild = section.locator(':scope > *').first();
        const childBox = await firstChild.boundingBox();
        assert.ok(childBox && childBox.width > 0, `${viewport.label}: section #${index}'s first content child has no real rendered area`);
        assert.ok(childBox.width >= sectionBox.width * 0.8, `${viewport.label}: section #${index}'s content is only ${childBox.width}px wide inside a ${sectionBox.width}px section - looks squeezed into a fixed-width grid track meant for more children`);
      }

      // Every section must be reachable by real vertical scrolling - not
      // clipped outside a fixed-height container.
      await growthRoot.evaluate(el => el.scrollIntoView());
      const lastSection = growthRoot.locator('section').last();
      await lastSection.scrollIntoViewIfNeeded();
      const lastVisible = await lastSection.isVisible();
      assert.ok(lastVisible, `${viewport.label}: last growth section is not reachable by scrolling`);

      // Touch targets: the app's own .cockpit .button rule sets min-height,
      // so this is a real regression guard, not an invented threshold.
      const stopButton = growthRoot.getByRole('button', {name: '조종석에서 제어'});
      const stopBox = await stopButton.boundingBox();
      assert.ok(stopBox && stopBox.height >= 40, `${viewport.label}: 전체 멈춤 button is smaller than a real touch target (${stopBox?.height}px)`);

      // The real @media(max-width:650px) rule actually applies at this width -
      // computed style, not a string search of the stylesheet source.
      const mindPadding = await growthRoot.locator('.cockpit-mind').first().evaluate(el => getComputedStyle(el).paddingTop);
      const expectedNarrow = viewport.width <= 650;
      assert.equal(mindPadding, expectedNarrow ? '17px' : '25px', `${viewport.label}: @media(max-width:650px) padding rule did not apply as expected (got ${mindPadding})`);

      proof.viewports.push({...viewport, scrollWidth: overflow.scrollWidth, clientWidth: overflow.clientWidth, mindPaddingTop: mindPadding});
    } finally {
      await context.close();
    }
  }
  proof.ok = true;
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await browser?.close();
  core.shutdown();
  rmSync(dataDir, {recursive: true, force: true});
}
