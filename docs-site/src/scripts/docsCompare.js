// Compare sliders: scripts/lib/compare.mjs turns <figure class="docs-shot docs-compare"> into a stage
// with the effect half below and the original half above it, clipped at --docs-compare (50 %).
// This script makes the divider draggable:
//   - pointer: press anywhere on the picture to move the line there and drag it; on touch a tap moves
//     it, a sideways drag drags it and a vertical swipe still scrolls the page (touch-action: pan-y);
//   - keyboard: the divider is a focusable role="slider"; arrows move it 5 % (Shift: 1 %), Page Up/Down
//     20 %, Home/End to the edges;
//   - loops: both halves are drawn from the one <video> into a canvas each, so original and effect
//     stay frame-synchronous and only one file loads. docsClips.js plays the video only while it is
//     in view; under reduced motion (or blocked autoplay) the poster halves stay and a small play
//     button appears.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (value) => Math.min(100, Math.max(0, value));
const KEY_STEPS = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -20, PageUp: 20 };

function slider(stage) {
  const handle = stage.querySelector('.docs-compare-handle');
  if (!handle) return;
  const before = stage.dataset.before || 'Original';
  const after = stage.dataset.after || 'Effect';
  let value = 50;
  handle.setAttribute('role', 'slider');
  handle.tabIndex = 0;
  handle.setAttribute('aria-label', `Compare ${before === 'Original' ? 'original' : before} and ${after}`);
  handle.setAttribute('aria-valuemin', '0');
  handle.setAttribute('aria-valuemax', '100');

  // glide: a jump (click, tap, key) eases to its place; a drag follows the pointer at once.
  const set = (next, glide) => {
    value = clamp(next);
    stage.toggleAttribute('data-glide', Boolean(glide) && !reducedMotion.matches);
    stage.style.setProperty('--docs-compare', `${value}%`);
    const shown = Math.round(value);
    handle.setAttribute('aria-valuenow', String(shown));
    handle.setAttribute('aria-valuetext', `${before} ${shown} %, ${after} ${100 - shown} %`);
  };
  const at = (clientX) => {
    const box = stage.getBoundingClientRect();
    return box.width ? ((clientX - box.left) / box.width) * 100 : value;
  };
  set(50);

  let press;
  stage.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0 || event.target.closest('button')) return;
    // A touch may become a page scroll: it moves the line only once it is a tap or a sideways drag.
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: event.pointerType !== 'touch' };
    if (!press.dragging) return;
    set(at(event.clientX), true);
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', (event) => {
    if (press?.id !== event.pointerId) return;
    if (!press.dragging) {
      const dx = Math.abs(event.clientX - press.x), dy = Math.abs(event.clientY - press.y);
      if (dx < 6 || dx <= dy) return;
      press.dragging = true;
      stage.setPointerCapture(event.pointerId);
    }
    set(at(event.clientX));
  });
  stage.addEventListener('pointerup', (event) => {
    if (press?.id !== event.pointerId) return;
    const tap = !press.dragging && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 10;
    if (tap) set(at(event.clientX), true);
    press = undefined;
  });
  // The browser took the touch over for scrolling (or the pointer was lost): leave the line where it is.
  stage.addEventListener('pointercancel', () => { press = undefined; });
  stage.addEventListener('dragstart', (event) => event.preventDefault());
  stage.addEventListener('transitionend', () => stage.removeAttribute('data-glide'));
  handle.addEventListener('keydown', (event) => {
    const step = KEY_STEPS[event.key];
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 100
      : step === undefined ? undefined : value + (event.shiftKey && Math.abs(step) === 5 ? Math.sign(step) : step);
    if (next === undefined) return;
    event.preventDefault();
    set(next, true);
  });
  stage.setAttribute('data-ready', '');
}

/** Draws each half of the pair video into its own canvas whenever the video shows a new frame. */
function liveHalves(stage, video) {
  const halves = [['.docs-compare-before', 0], ['.docs-compare-after', 1]].map(([selector, side]) => {
    const layer = stage.querySelector(selector);
    const canvas = document.createElement('canvas');
    canvas.className = 'docs-compare-frame';
    canvas.setAttribute('aria-hidden', 'true');
    layer.querySelector('img').after(canvas);
    return { canvas, context: canvas.getContext('2d'), side };
  });
  const draw = () => {
    const width = Math.floor(video.videoWidth / 2), height = video.videoHeight;
    if (!width || !height || video.readyState < 2) return;
    for (const { canvas, context, side } of halves) {
      if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
      context.drawImage(video, side * width, 0, width, height, 0, 0, width, height);
    }
    stage.setAttribute('data-live', '');
  };
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const frame = () => { draw(); video.requestVideoFrameCallback(frame); };
    video.requestVideoFrameCallback(frame);
  } else {
    let pending = 0;
    const tick = () => { draw(); pending = video.paused ? 0 : requestAnimationFrame(tick); };
    video.addEventListener('playing', () => { if (!pending) tick(); });
  }
  video.addEventListener('seeked', draw);

  // Under reduced motion, or when the browser blocks autoplay, docsClips.js marks the video
  // data-docs-manual; this button then lets the reader start and stop the loop by hand.
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'docs-compare-play';
  button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path class="docs-compare-play-icon" d="M5 3.5v9l7.5-4.5z"/><path class="docs-compare-pause-icon" d="M4.5 3.5h2.5v9H4.5zM9 3.5h2.5v9H9z"/></svg>';
  const label = () => {
    button.setAttribute('aria-label', video.paused ? 'Play the loop' : 'Pause the loop');
    button.toggleAttribute('data-playing', !video.paused);
  };
  label();
  video.addEventListener('play', label);
  video.addEventListener('pause', label);
  button.addEventListener('click', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
  stage.append(button);
}

for (const stage of document.querySelectorAll('.docs-compare-stage')) {
  slider(stage);
  const video = stage.querySelector('video.docs-compare-video');
  if (video) liveHalves(stage, video);
}
