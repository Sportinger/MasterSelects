// Lightbox: a click on a docs picture (a.docs-shot-zoom) opens it full screen instead of the bare file.
//   - The callouts of the picture come along; their names and notes (from the caption, "1 — Preset: …")
//     stand left and right of it, on the side of their callout and in its order from top to bottom.
//     Hovering a note lights its callout and draws the line from the note to it (docsCallouts.js).
//   - The wheel zooms smoothly and without steps, towards the pointer when it is over the picture.
//     Zoom is exponential, so every wheel movement feels equally fast at any size, and a faster wheel
//     zooms faster. Dragging with the left button moves the picture; two fingers pinch and move it.
//   - Keys: Esc closes, + and - zoom, 0 fits, the arrows move. A double click zooms in there or fits.
// Without JavaScript the link still opens the full-size file.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const SVG = 'http://www.w3.org/2000/svg';
const ZOOM_PER_PIXEL = 0.0016; // wheel delta in px → change of ln(scale)
const MAX_ZOOM = 10; // × the fitted size
const SMOOTHING_MS = 70;

function wheelPixels(event) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
  // A trackpad pinch arrives as a wheel with ctrlKey and small deltas: give it more weight.
  return event.deltaY * unit * (event.ctrlKey ? 6 : 1);
}

function open(link) {
  const figure = link.closest('figure');
  const sourceStage = link.closest('.docs-shot-stage');
  const image = link.querySelector('img');
  if (!image) return;
  const opener = document.activeElement;

  const box = document.createElement('div');
  box.className = 'docs-lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', image.alt || 'Picture');
  box.innerHTML = `
    <div class="docs-lightbox-bar">
      <span class="docs-lightbox-hint">Scroll to zoom · drag to move · Esc to close</span>
      <button type="button" class="docs-lightbox-fit">Fit</button>
      <button type="button" class="docs-lightbox-close" aria-label="Close">×</button>
    </div>
    <div class="docs-lightbox-notes docs-lightbox-notes--left"></div>
    <div class="docs-lightbox-view"><div class="docs-lightbox-canvas"></div></div>
    <div class="docs-lightbox-notes docs-lightbox-notes--right"></div>`;
  const view = box.querySelector('.docs-lightbox-view');
  const canvas = box.querySelector('.docs-lightbox-canvas');

  // The picture with its callouts, at the picture's own pixel size; a transform places and scales it.
  const width = image.naturalWidth || Number(image.getAttribute('width')) || 1200;
  const height = image.naturalHeight || Number(image.getAttribute('height')) || 800;
  const stage = document.createElement('div');
  stage.className = 'docs-lightbox-stage';
  const picture = document.createElement('img');
  picture.src = image.currentSrc || image.src;
  picture.alt = image.alt;
  picture.draggable = false;
  stage.append(picture);
  const overlay = sourceStage?.querySelector('svg.docs-shot-overlay');
  if (overlay) {
    const copy = overlay.cloneNode(true);
    copy.querySelectorAll('.is-active').forEach((el) => el.classList.remove('is-active'));
    stage.append(copy);
    stage.classList.add('docs-callouts-live');
  }
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  canvas.append(stage);

  // Notes left and right: each callout's name and note, on the side of the callout.
  const groups = [...stage.querySelectorAll('.docs-callout[data-callout]')];
  const notes = [];
  for (const group of groups) {
    const circle = group.querySelector('circle.docs-shot-number');
    const svg = group.ownerSVGElement;
    const viewWidth = svg?.viewBox.baseVal.width || 1;
    const viewHeight = svg?.viewBox.baseVal.height || 1;
    const x = Number(circle?.getAttribute('cx')) / viewWidth;
    const y = Number(circle?.getAttribute('cy')) / viewHeight;
    const note = document.createElement('button');
    note.type = 'button';
    note.className = 'docs-lightbox-note';
    note.innerHTML = '<span class="docs-lightbox-badge"></span><span class="docs-lightbox-note-text"><strong></strong><span></span></span>';
    note.querySelector('.docs-lightbox-badge').textContent = group.dataset.callout;
    note.querySelector('strong').textContent = group.dataset.label || `Callout ${group.dataset.callout}`;
    note.querySelector('.docs-lightbox-note-text > span').textContent = group.dataset.note || '';
    notes.push({ note, group, circle, x, y });
  }
  // Each note goes to the side of its callout; when one side would hold far more, the callouts
  // nearest the middle move across, so the notes stand on both sides.
  const sides = { left: box.querySelector('.docs-lightbox-notes--left'), right: box.querySelector('.docs-lightbox-notes--right') };
  const left = notes.filter((item) => item.x < 0.5), right = notes.filter((item) => item.x >= 0.5);
  while (notes.length >= 3 && Math.abs(left.length - right.length) > 1) {
    const [from, to] = left.length > right.length ? [left, right] : [right, left];
    from.sort((a, b) => Math.abs(a.x - 0.5) - Math.abs(b.x - 0.5));
    to.push(from.shift());
  }
  for (const item of left.toSorted((a, b) => a.y - b.y)) sides.left.append(item.note);
  for (const item of right.toSorted((a, b) => a.y - b.y)) sides.right.append(item.note);
  box.classList.toggle('has-left', sides.left.childElementCount > 0);
  box.classList.toggle('has-right', sides.right.childElementCount > 0);
  if (!notes.length) {
    const caption = figure?.querySelector('figcaption');
    if (caption) {
      const text = document.createElement('p');
      text.className = 'docs-lightbox-caption';
      text.textContent = caption.textContent;
      box.querySelector('.docs-lightbox-bar').prepend(text);
    }
  }

  // The line from a note to its callout: out of the note's inner edge, across to the callout, then up
  // or down into its number, so it does not run along the callout's own arrow.
  const noteRoute = (note, circle) => {
    const n = note.getBoundingClientRect(), c = circle.getBoundingClientRect();
    if (!c.width) return undefined;
    const centre = { x: c.left + c.width / 2, y: c.top + c.height / 2 }, r = c.width / 2 + 3;
    const fromLeft = centre.x > n.right;
    const start = { x: fromLeft ? n.right + 4 : n.left - 4, y: n.top + n.height / 2 };
    if (Math.abs(start.y - centre.y) < r * 1.5) return [start, { x: centre.x + (fromLeft ? -r : r), y: start.y }];
    const down = centre.y > start.y;
    return [start, { x: centre.x, y: start.y }, { x: centre.x, y: centre.y + (down ? -r : r) }];
  };

  // The line from a note to its callout.
  const line = document.createElementNS(SVG, 'svg');
  line.classList.add('docs-lightbox-line');
  line.setAttribute('aria-hidden', 'true');
  const linePath = document.createElementNS(SVG, 'path');
  const lineDot = document.createElementNS(SVG, 'circle');
  lineDot.setAttribute('r', '3.5');
  line.append(linePath, lineDot);
  box.append(line);
  let lit;
  const drawLine = (animate) => {
    if (!lit || !window.docsCallouts) return;
    const points = noteRoute(lit.note, lit.circle);
    if (!points) return;
    linePath.setAttribute('d', window.docsCallouts.elbowPath(points));
    lineDot.setAttribute('cx', String(points[0].x));
    lineDot.setAttribute('cy', String(points[0].y));
    if (!animate) return;
    const length = linePath.getTotalLength();
    linePath.style.transition = 'none';
    linePath.style.strokeDasharray = `${length}`;
    linePath.style.strokeDashoffset = reducedMotion.matches ? '0' : `${length}`;
    line.getBoundingClientRect();
    linePath.style.transition = '';
    linePath.style.strokeDashoffset = '0';
  };
  const light = (item) => {
    if (lit === item) return;
    unlight();
    lit = item;
    item.group.classList.add('is-active');
    item.note.classList.add('is-active');
    line.classList.add('is-active');
    drawLine(true);
  };
  const unlight = () => {
    if (!lit) return;
    lit.group.classList.remove('is-active');
    lit.note.classList.remove('is-active');
    line.classList.remove('is-active');
    lit = undefined;
  };
  for (const item of notes) {
    item.note.addEventListener('pointerenter', () => light(item));
    item.note.addEventListener('pointerleave', unlight);
    item.note.addEventListener('focus', () => light(item));
    item.note.addEventListener('blur', unlight);
    item.group.addEventListener('pointerenter', () => light(item));
    item.group.addEventListener('pointerleave', unlight);
  }

  // Zoom and pan. `zoom` is ln(scale); the shown value glides towards the target.
  let fit = 1, scale = 1, x = 0, y = 0, zoom = 0, target = 0;
  let anchor = null; // { x, y } in view pixels that stays put while the zoom glides
  let frame = 0, last = 0;
  const bounds = () => view.getBoundingClientRect();
  const clampPan = () => {
    const area = bounds();
    const w = width * scale, h = height * scale;
    x = w <= area.width ? (area.width - w) / 2 : Math.min(0, Math.max(area.width - w, x));
    y = h <= area.height ? (area.height - h) / 2 : Math.min(0, Math.max(area.height - h, y));
  };
  const apply = () => {
    canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    // Callouts keep their size on screen while the picture grows.
    stage.style.setProperty('--docs-lightbox-k', String(fit / scale));
    box.classList.toggle('is-zoomed', scale > fit * 1.01);
    drawLine(false);
  };
  const setScale = (next, at) => {
    const point = at ?? { x: bounds().width / 2, y: bounds().height / 2 };
    const imageX = (point.x - x) / scale, imageY = (point.y - y) / scale;
    scale = next;
    x = point.x - imageX * scale;
    y = point.y - imageY * scale;
    clampPan();
    apply();
  };
  const limits = () => [Math.log(fit), Math.log(fit * MAX_ZOOM)];
  const step = (time) => {
    frame = 0;
    const dt = last ? Math.min(64, time - last) : 16;
    last = time;
    zoom += (target - zoom) * (1 - Math.exp(-dt / SMOOTHING_MS));
    if (Math.abs(target - zoom) < 0.0005) zoom = target;
    setScale(Math.exp(zoom), anchor);
    if (zoom !== target) frame = requestAnimationFrame(step);
    else last = 0;
  };
  const zoomTo = (next, at) => {
    const [low, high] = limits();
    target = Math.min(high, Math.max(low, next));
    anchor = at;
    if (reducedMotion.matches) { zoom = target; setScale(Math.exp(zoom), anchor); return; }
    if (!frame) frame = requestAnimationFrame(step);
  };
  const pointerInView = (event) => {
    const area = bounds();
    return { x: event.clientX - area.left, y: event.clientY - area.top };
  };
  const overPicture = (point) => point.x >= x && point.x <= x + width * scale && point.y >= y && point.y <= y + height * scale;
  const fitNow = () => {
    const area = bounds();
    fit = Math.min(area.width / width, area.height / height) * 0.96;
    zoom = target = Math.log(fit);
    scale = fit;
    anchor = null;
    clampPan();
    apply();
  };

  view.addEventListener('wheel', (event) => {
    event.preventDefault();
    const point = pointerInView(event);
    zoomTo(target - wheelPixels(event) * ZOOM_PER_PIXEL, overPicture(point) ? point : null);
  }, { passive: false });

  // Drag to move (left button or one finger), pinch with two fingers.
  const pointers = new Map();
  let moved = 0, pinch = null;
  view.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.docs-callout')) return;
    view.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
    box.classList.add('is-dragging');
  });
  view.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, current);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const area = bounds();
      x += centre.x - pinch.centre.x;
      y += centre.y - pinch.centre.y;
      const [low, high] = limits();
      zoom = target = Math.min(high, Math.max(low, zoom + Math.log(distance / pinch.distance)));
      setScale(Math.exp(zoom), { x: centre.x - area.left, y: centre.y - area.top });
      pinch = { distance, centre };
      moved += 10;
      return;
    }
    moved += Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
    x += current.x - previous.x;
    y += current.y - previous.y;
    clampPan();
    apply();
  });
  const release = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) box.classList.remove('is-dragging');
  };
  view.addEventListener('pointerup', (event) => {
    const click = moved < 5 && pointers.size === 1;
    release(event);
    // A click beside the picture closes, like a click on the dark backdrop.
    if (click && !overPicture(pointerInView(event))) close();
  });
  view.addEventListener('pointercancel', release);
  view.addEventListener('dblclick', (event) => {
    const point = pointerInView(event);
    if (scale > fit * 1.05) zoomTo(Math.log(fit), null);
    else zoomTo(Math.log(fit * 2.5), overPicture(point) ? point : null);
  });

  const keys = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === '+' || event.key === '=') zoomTo(target + 0.35, null);
    else if (event.key === '-' || event.key === '_') zoomTo(target - 0.35, null);
    else if (event.key === '0') zoomTo(Math.log(fit), null);
    else if (event.key.startsWith('Arrow') && !event.target.closest('.docs-lightbox-note')) {
      const delta = 80;
      if (event.key === 'ArrowLeft') x += delta;
      if (event.key === 'ArrowRight') x -= delta;
      if (event.key === 'ArrowUp') y += delta;
      if (event.key === 'ArrowDown') y -= delta;
      clampPan();
      apply();
    } else if (event.key === 'Tab') {
      // Keep the focus inside the dialog.
      const focusable = [...box.querySelectorAll('button')];
      const index = focusable.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1).focus(); }
      else if (!event.shiftKey && index === focusable.length - 1) { event.preventDefault(); focusable[0].focus(); }
      return;
    } else return;
    event.preventDefault();
  };
  const resize = () => {
    const ratio = scale / fit;
    const area = bounds();
    fit = Math.min(area.width / width, area.height / height) * 0.96;
    scale = fit * ratio;
    zoom = target = Math.log(scale);
    clampPan();
    apply();
  };
  function close() {
    cancelAnimationFrame(frame);
    removeEventListener('keydown', keys, true);
    removeEventListener('resize', resize);
    box.remove();
    document.documentElement.classList.remove('docs-lightbox-open');
    if (opener instanceof HTMLElement) opener.focus({ preventScroll: true });
  }
  box.querySelector('.docs-lightbox-close').addEventListener('click', close);
  // A click on the dark space around the notes closes as well.
  box.addEventListener('click', (event) => { if (event.target === box || event.target.matches('.docs-lightbox-notes')) close(); });
  box.querySelector('.docs-lightbox-fit').addEventListener('click', () => zoomTo(Math.log(fit), null));
  addEventListener('keydown', keys, true);
  addEventListener('resize', resize);

  document.documentElement.classList.add('docs-lightbox-open');
  document.body.append(box);
  const start = () => { fitNow(); box.classList.add('is-open'); };
  if (picture.complete) requestAnimationFrame(start); else picture.addEventListener('load', start, { once: true });
  box.querySelector('.docs-lightbox-close').focus({ preventScroll: true });
}

document.addEventListener('click', (event) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest?.('.sl-markdown-content a.docs-shot-zoom')
    // A click on a callout opens its picture too.
    ?? event.target.closest?.('.sl-markdown-content .docs-shot-stage .docs-callout')?.closest('.docs-shot-stage')?.querySelector('a.docs-shot-zoom');
  if (!link || link.closest('.docs-compare')) return;
  event.preventDefault();
  open(link);
});
