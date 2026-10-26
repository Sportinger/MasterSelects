// Shared by doc-clip.mjs: a visible mouse pointer for docs clips (Playwright does not draw the OS
// cursor) and calm, human mouse moves to drive it. The pointer is page DOM that follows the real
// pointer events, so hover states, clicks and drags still act on the editor itself. A short
// transform transition runs on the compositor: while the editor's main thread is busy (effect
// thumbnails, a re-rendering preview) and takes a move late, the pointer still glides instead of
// jumping.

/**
 * Page side: draws the pointer and a click ripple (docs-callout yellow); installs once. scale: their size
 * in CSS px against the 26 px pointer of a 1280 px wide page.
 */
function pointerOverlay(scale = 1) {
  if (document.getElementById('doc-clip-pointer')) return;
  const tip = 2 * scale;
  const style = document.createElement('style');
  style.textContent = `
    #doc-clip-pointer { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; will-change: transform;
      transform: translate(-200px, -200px); filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .6)); transition: transform 90ms linear; }
    #doc-clip-pointer svg { display: block; transform-origin: ${tip}px ${tip}px; transition: transform 110ms ease-out; }
    #doc-clip-pointer.pressed svg { transform: scale(.86); }
    .doc-clip-ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: ${46 * scale}px; height: ${46 * scale}px;
      margin: ${-23 * scale}px 0 0 ${-23 * scale}px; border-radius: 50%; border: ${2 * scale}px solid rgba(255, 213, 74, .95); background: rgba(255, 213, 74, .16);
      animation: doc-clip-ripple 560ms ease-out forwards; }
    @keyframes doc-clip-ripple { from { transform: scale(.2); opacity: 1; } to { transform: scale(1); opacity: 0; } }`;
  const pointer = document.createElement('div');
  pointer.id = 'doc-clip-pointer';
  pointer.innerHTML = `<svg width="${26 * scale}" height="${26 * scale}" viewBox="0 0 26 26">`
    + '<path d="M2 2 L2 21 L7 16.6 L10.3 23.8 L13.9 22.2 L10.7 15.2 L17.4 15.2 Z" '
    + 'fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  document.documentElement.append(style, pointer);
  // The browser window is on a real desktop: when the real mouse crosses it, its events are as
  // trusted as the script's. The pointer follows only the positions the script announced (the
  // last few: a busy page handles input after later announcements), and every other event is
  // counted, so the recording can say it was disturbed.
  const state = window.__docClipPointer = { expected: [], foreign: 0, tip, announce(point) { this.expected = [...this.expected.slice(-15), point]; } };
  const ours = event => !state.expected.length || state.expected.some(point => Math.hypot(event.clientX - point.x, event.clientY - point.y) < 3);
  const follow = event => {
    if (!ours(event)) { state.foreign += 1; return false; }
    pointer.style.transform = `translate(${event.clientX - tip}px, ${event.clientY - tip}px)`;
    return true;
  };
  const options = { capture: true, passive: true };
  addEventListener('pointermove', follow, options);
  addEventListener('pointerdown', event => {
    if (!follow(event)) return;
    pointer.classList.add('pressed');
    const ripple = document.createElement('div');
    ripple.className = 'doc-clip-ripple';
    Object.assign(ripple.style, { left: `${event.clientX}px`, top: `${event.clientY}px` });
    document.documentElement.append(ripple);
    setTimeout(() => ripple.remove(), 650);
  }, options);
  addEventListener('pointerup', () => pointer.classList.remove('pressed'), options);
}

/**
 * Page side: the point (CSS px) a step aims at.
 *   "slider:<row label>"         the handle of that row's slider (with `value`: where that value sits)
 *   "preview:<x>,<y>"            a point in the preview canvas (0–1)
 *   "@<x>,<y>"                   a page point
 *   anything else                the visible element whose text is exactly that ("+ Add Effect", "Glitch")
 */
function locateTarget({ target, value }) {
  const visible = element => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return false;
    const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, (rect.left + rect.right) / 2)), Math.min(innerHeight - 1, Math.max(0, (rect.top + rect.bottom) / 2)));
    return !!hit && (element.contains(hit) || hit.contains(element));
  };
  const centre = rect => ({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });
  const byText = text => [...document.querySelectorAll('body *')].filter(element => element.id !== 'doc-clip-pointer'
    && element.textContent.trim() === text && ![...element.children].some(child => child.textContent.trim() === text) && visible(element));
  if (target.startsWith('@')) { const [x, y] = target.slice(1).split(',').map(Number); return { x, y }; }
  if (target.startsWith('preview:')) {
    const canvas = [...document.querySelectorAll('[data-group-id="preview-group"] canvas')].filter(visible)
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    if (!canvas) return { missing: 'no preview canvas' };
    const rect = canvas.getBoundingClientRect(), [x, y] = target.slice(8).split(',').map(Number);
    return { x: rect.left + x * rect.width, y: rect.top + y * rect.height };
  }
  if (target.startsWith('slider:')) {
    const label = target.slice(7);
    for (const element of byText(label)) {
      let row = element;
      while (row && !row.querySelector('.handle-only-range')) row = row.parentElement;
      const slider = row?.querySelector('.handle-only-range');
      if (!slider || !visible(slider)) continue;
      const min = Number(slider.getAttribute('aria-valuemin')), max = Number(slider.getAttribute('aria-valuemax'));
      const now = value ?? Number(slider.getAttribute('aria-valuenow'));
      const rect = slider.getBoundingClientRect(), thumb = 7;
      const ratio = Math.min(1, Math.max(0, (now - min) / (max - min || 1)));
      return { x: rect.left + thumb / 2 + ratio * (rect.width - thumb), y: (rect.top + rect.bottom) / 2 };
    }
    return { missing: `no visible slider in a row labelled "${label}"` };
  }
  const [element] = byText(target);
  if (!element) return { missing: `no visible element reading "${target}"` };
  // Aim at the words, not at the middle of a wide bar.
  const range = document.createRange();
  range.selectNodeContents(element);
  const text = range.getBoundingClientRect();
  return centre(text.width ? text : element.getBoundingClientRect());
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Installs the pointer (`scale`: its size, 1 = 26 px) and returns calm mouse actions that start at `start` (CSS px). */
export async function humanMouse(page, start, { scale = 1 } = {}) {
  await page.evaluate(pointerOverlay, scale);
  let position = { ...start };
  const moveTimes = [];
  await page.evaluate(point => window.__docClipPointer.announce(point), position);
  await page.mouse.move(position.x, position.y);
  const locate = async (target, value) => {
    const point = await page.evaluate(locateTarget, { target, value });
    if (point.missing) throw new Error(`Step target "${target}": ${point.missing}`);
    return point;
  };
  /** An eased move (~60 Hz) with a slight arc, as a hand moves; `straight` for slider drags. */
  const glide = async (to, { ms, straight = false } = {}) => {
    const from = { ...position }, dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy);
    const duration = ms ?? Math.min(1200, Math.max(450, 380 + distance * 0.75));
    const bend = straight ? 0 : Math.min(36, distance * 0.07), nx = -dy / (distance || 1), ny = dx / (distance || 1);
    const begin = Date.now();
    for (let t = 0; t < 1;) {
      t = Math.min(1, (Date.now() - begin) / duration);
      const k = ease(t), arc = Math.sin(Math.PI * k) * bend;
      const sent = Date.now(), x = from.x + dx * k + nx * arc, y = from.y + dy * k + ny * arc;
      await page.evaluate(point => window.__docClipPointer.announce(point), { x, y });
      await page.mouse.move(x, y);
      moveTimes.push(Date.now() - sent);
      if (t < 1) await pause(Math.max(0, 16 - (Date.now() - sent)));
    }
    position = { ...to };
  };
  /**
   * A move through `points` in `ms`, at an even speed along the way with a soft start and stop:
   * gestures such as circling a control or tracing a cable.
   */
  const path = async (points, { ms = 800 } = {}) => {
    const way = [{ ...position }, ...points];
    const lengths = way.slice(1).map((point, index) => Math.hypot(point.x - way[index].x, point.y - way[index].y));
    const total = lengths.reduce((sum, length) => sum + length, 0) || 1;
    const begin = Date.now();
    for (let t = 0; t < 1;) {
      t = Math.min(1, (Date.now() - begin) / ms);
      // Ease only the first and last tenth, so a circle keeps its pace in between.
      const k = t < 0.1 ? 5 * t * t : t > 0.9 ? 1 - 5 * (1 - t) ** 2 : t;
      let along = k * total, index = 0;
      while (index < lengths.length - 1 && along > lengths[index]) { along -= lengths[index]; index += 1; }
      const f = lengths[index] ? Math.min(1, along / lengths[index]) : 1, a = way[index], b = way[index + 1];
      const sent = Date.now(), x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
      await page.evaluate(point => window.__docClipPointer.announce(point), { x, y });
      await page.mouse.move(x, y);
      moveTimes.push(Date.now() - sent);
      if (t < 1) await pause(Math.max(0, 16 - (Date.now() - sent)));
    }
    position = { ...way.at(-1) };
  };
  return {
    locate,
    glide,
    path,
    position: () => ({ ...position }),
    /** After a reload of the page: the pointer again, where it was. */
    async reinstall() {
      await page.evaluate(pointerOverlay, scale);
      await page.evaluate(point => window.__docClipPointer.announce(point), position);
    },
    /** How long the page took to take each pointer move (ms): a busy page moves the pointer in jumps. */
    async moveStats() {
      const sorted = moveTimes.toSorted((a, b) => a - b);
      const foreign = await page.evaluate(() => window.__docClipPointer.foreign);
      return { moves: sorted.length, median: sorted[sorted.length >> 1] ?? 0, p90: sorted[Math.floor(sorted.length * 0.9)] ?? 0, foreign };
    },
    async move(target, options) { await glide(await locate(target), options); },
    async click(target, options) {
      await glide(await locate(target), options);
      await pause(140);
      await page.mouse.down();
      await pause(90);
      await page.mouse.up();
    },
    /** Drags the slider of row `label` through each value of `to` (one value or several). */
    async drag(label, to, { ms } = {}) {
      await glide(await locate(`slider:${label}`));
      await pause(180);
      await page.mouse.down();
      await pause(120);
      for (const value of [to].flat()) {
        const point = await locate(`slider:${label}`, value);
        await glide({ x: point.x, y: position.y }, { ms, straight: true });
        await pause(220);
      }
      await page.mouse.up();
    },
  };
}
