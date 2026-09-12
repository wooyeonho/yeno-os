import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldView } from '../public/world-view.mjs';

// Small DOM contract fixture, not a claim of real browser/device rendering.
function dom() {
  const nodes = new Map();
  class Element {
    constructor(id = '') { this.id = id; this.value = ''; this.hidden = false; this.disabled = false; this.textContent = ''; this.handlers = {}; this.attrs = {}; this.classList = { toggle() {} }; }
    set innerHTML(value) { this.html = value; if (value.includes('id="world-layer"') && !nodes.has('world-layer')) { const select = new Element('world-layer'); select.value = 'all'; nodes.set('world-layer', select); } }
    get innerHTML() { return this.html ?? ''; }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    setAttribute(name, value) { this.attrs[name] = value; }
    append() {}
    querySelector(selector) { return nodes.get(selector); }
    focus() { this.focused = true; }
    scrollIntoView() {}
  }
  for (const id of ['tab-world', 'h2', '.section-heading p', '.world-map-caption', '.world-bar', 'world-map', 'world-magnitude', 'world-total', 'world-largest', 'world-updated', 'world-coverage', 'world-markers', 'world-list', 'world-detail', 'world-refresh', 'world-status', 'world-error']) nodes.set(id, new Element(id));
  nodes.get('world-magnitude').value = '2.5';
  return { nodes, document: { getElementById: id => nodes.get(id), createElement: () => new Element() } };
}

test('world UI separates sources, offers keyboard hazard details, escapes titles and reports partial failures', async t => {
  const original = globalThis.document, fixture = dom(); globalThis.document = fixture.document;
  t.after(() => { if (original === undefined) delete globalThis.document; else globalThis.document = original; });
  const $ = id => fixture.nodes.get(id), at = new Date().toISOString();
  const snapshot = { format: 2, generatedAt: at, checkedAt: at, sourceCount: 1, invalidCount: 0, omittedCount: 0, events: [{ id: 'q1', magnitude: 4, place: 'Quake', occurredAt: at, updatedAt: at, longitude: 1, latitude: 2, depthKm: 10, reviewStatus: 'reviewed', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/q1' }], hazards: { status: 'ok', checkedAt: at, latestEventAt: at, sourceCount: 1, invalidCount: 0, omittedCount: 0, events: [{ id: 'EONET_1', title: '<img src=x onerror=alert(1)> wildfire', category: 'wildfires', longitude: 3, latitude: 4, occurredAt: at, url: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1' }] } };
  let result = { latestJobId: 'job1', snapshot }, submissions = 0;
  const view = createWorldView({ load: async () => result, submit: async () => { submissions++; } });
  await view.update({ latestJobId: 'job1', lastAttemptStatus: 'completed' }, true);
  assert.equal($('world-total').textContent, '2');
  assert.match($('world-markers').innerHTML, /<circle/); assert.match($('world-markers').innerHTML, /<path/);
  assert.match($('world-markers').innerHTML, /tabindex="0" role="button" data-hazard/);
  assert.match($('world-list').innerHTML, /&lt;img/); assert.doesNotMatch($('world-list').innerHTML, /<img/);
  assert.match($('world-updated').textContent, /원자료 생성 시각 미제공/);
  $('world-layer').value = 'eonet'; $('world-layer').handlers.change();
  assert.equal($('world-total').textContent, '1'); assert.equal($('world-magnitude').disabled, true); assert.doesNotMatch($('world-markers').innerHTML, /<circle/);
  const keyEvent = { type: 'keydown', key: 'Enter', preventDefault() {}, target: { closest: () => ({ dataset: { hazard: 'EONET_1' } }) } };
  $('world-map').handlers.keydown(keyEvent);
  assert.equal($('world-detail').hidden, false); assert.equal($('world-detail').focused, true);
  assert.match($('world-detail').innerHTML, /NASA EONET 원자료 열기/); assert.doesNotMatch($('world-detail').innerHTML, /<img/);
  result = { latestJobId: 'job2', snapshot: { ...snapshot, hazards: { ...snapshot.hazards, status: 'error', events: [] } } };
  await view.update({ latestJobId: 'job2', lastAttemptStatus: 'completed' }, true);
  assert.match($('world-status').textContent, /일부 출처 조회 실패/); assert.match($('world-error').textContent, /사건 없음으로 해석하지/);
  $('world-refresh').handlers.click(); assert.equal(submissions, 1);
  result = { latestJobId: 'job3', snapshot: { ...snapshot, format: 1, hazards: undefined } };
  await view.update({ latestJobId: 'job3', lastAttemptStatus: 'completed' }, true);
  assert.match($('world-updated').textContent, /이전 지진 전용 결과에 미포함/);
  view.reset(); assert.equal($('world-total').textContent, '—'); assert.equal($('world-refresh').disabled, true); assert.equal($('world-markers').innerHTML, '');
});
