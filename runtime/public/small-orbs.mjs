import {MODE_DRAWS} from './vendor/thinking-orbs/adapted/registry.mjs';
import {resolvePreset} from './vendor/thinking-orbs/adapted/presets.mjs';
import {SMALL_ORB_LABELS} from './small-orb-state.mjs';

const instances = new Set();
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let frame = 0;
let observer;

function visible(item) { return item.element.isConnected && item.inView && !document.hidden; }
function draw(item, now) {
  const canvas = item.canvas;
  const size = item.size;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(size * ratio)) canvas.width = Math.round(size * ratio);
  if (canvas.height !== Math.round(size * ratio)) canvas.height = Math.round(size * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, size, size);
  if (item.state === 'still') {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--j-muted').trim();
    ctx.beginPath(); ctx.arc(size / 2, size / 2, Math.max(1.5, size / 16), 0, 2 * Math.PI); ctx.fill();
    return;
  }
  const preset = resolvePreset(item.state, size <= 32 ? 20 : 64);
  const dark = getComputedStyle(document.documentElement).colorScheme !== 'light';
  MODE_DRAWS[preset.mode](ctx, size, (motion.matches ? 0 : now / 1000) * preset.speed, dark, preset.opts);
}
function schedule() {
  if (frame || motion.matches || document.hidden || ![...instances].some(item => visible(item) && item.state !== 'still')) return;
  frame = requestAnimationFrame(now => {
    frame = 0;
    for (const item of instances) {
      if (!item.element.isConnected) { observer?.unobserve(item.element); instances.delete(item); continue; }
      if (visible(item) && item.state !== 'still') draw(item, now);
    }
    schedule();
  });
}
export function attachSmallOrb(element, {size = 24, state = 'still'} = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'small-orb-canvas'; canvas.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span'); label.className = 'small-orb-label';
  element.classList.add('small-orb'); element.append(canvas, label);
  const item = {element, canvas, label, size, state: 'still', inView: true};
  if (!observer && 'IntersectionObserver' in globalThis) observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const found = [...instances].find(candidate => candidate.element === entry.target);
      if (found) found.inView = entry.isIntersecting;
    }
    schedule();
  });
  instances.add(item); observer?.observe(element);
  function set(next) {
    item.state = Object.hasOwn(SMALL_ORB_LABELS, next) ? next : 'still';
    label.textContent = SMALL_ORB_LABELS[item.state];
    element.dataset.orbState = item.state;
    draw(item, performance.now()); schedule();
  }
  set(state);
  return {set};
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; }
  else schedule();
});
motion.addEventListener('change', () => {
  if (motion.matches && frame) { cancelAnimationFrame(frame); frame = 0; }
  for (const item of instances) if (item.element.isConnected) draw(item, performance.now());
  schedule();
});
