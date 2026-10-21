// Live callouts: the yellow numbered markers of a picture (scripts/docShotFigure.mjs) rest at 10 %
// opacity. Hovering their word in the text – a bold name such as **Band Size**, or "2 — Band Size" in
// the caption – lifts the callout to full strength and draws a line with right-angle corners from the
// word to the callout's number on the picture. Hovering a callout lights its word the same way; on
// touch a tap on the word toggles it. Without JavaScript (and on GitHub) the callouts stay as they are.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const SVG = 'http://www.w3.org/2000/svg';
const CORNER = 8;

const normal = (text) => text.toLowerCase().replace(/\s+/gu, ' ').replace(/[\s.:;,–—-]+$/u, '').trim();
// A longer bold name still counts: **Line Shading & Alpha** for the callout label "Line Shading".
const sameName = (word, label) => word === label || word.startsWith(`${label} `);

/** The callouts of one overlay: arrow, circle and number of each, moved into a <g> per number. */
function callouts(svg) {
  const found = [];
  let current;
  for (const node of [...svg.children]) {
    if (node.matches('path.docs-shot-arrow')) {
      current = document.createElementNS(SVG, 'g');
      current.classList.add('docs-callout');
      node.before(current);
      found.push({ group: current });
    }
    if (!current || node.matches('defs')) continue;
    current.append(node);
    if (node.matches('circle.docs-shot-number')) found.at(-1).circle = node;
    if (node.matches('text.docs-shot-number-text')) found.at(-1).number = node.textContent.trim();
  }
  return found.filter((item) => item.circle && item.number);
}

/** "1 — Preset: pick a starting point. 2 — Band Size." → Map { '1' → 'preset', '2' → 'band size' } */
function captionLabels(caption) {
  const labels = new Map();
  const pattern = /(\d+)\s*[—–]\s*([^:.;—–]+?)(?=\s*(?:[:.;]|\d+\s*[—–]|$))/gu;
  for (const match of (caption?.textContent ?? '').matchAll(pattern)) labels.set(match[1], normal(match[2]));
  return labels;
}

/** Wraps "N — Label" in the caption's text into a span that acts like a word. */
function captionRefs(caption, numbers) {
  if (!caption) return [];
  const refs = [];
  const walker = document.createTreeWalker(caption, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const text of texts) {
    const pattern = /(\d+)\s*[—–]\s*[^:.;—–]+?(?=\s*(?:[:.;]|\d+\s*[—–]|$))/gu;
    const parts = [];
    let last = 0;
    for (const match of text.data.matchAll(pattern)) {
      if (!numbers.has(match[1])) continue;
      parts.push(text.data.slice(last, match.index));
      const span = document.createElement('span');
      span.className = 'docs-callout-word docs-callout-ref';
      span.dataset.callout = match[1];
      span.textContent = match[0];
      parts.push(span);
      refs.push(span);
      last = match.index + match[0].length;
    }
    if (!parts.length) continue;
    parts.push(text.data.slice(last));
    text.replaceWith(...parts);
  }
  return refs;
}

/** The elements of the page section (between two h2) that holds `figure`. */
function sectionOf(figure, content) {
  let top = figure;
  while (top.parentElement && top.parentElement !== content) top = top.parentElement;
  if (top.parentElement !== content) return [content];
  const isH2 = (el) => el.matches('h2, .sl-heading-wrapper.level-h2');
  const section = [top];
  for (let el = top.previousElementSibling; el && !isH2(el); el = el.previousElementSibling) section.unshift(el);
  for (let el = top.nextElementSibling; el && !isH2(el); el = el.nextElementSibling) section.push(el);
  return section;
}

function boldWords(scope, label) {
  return scope.flatMap((el) => [...el.querySelectorAll('strong, b')])
    .filter((word) => !word.closest('figure, h1, h2, h3, h4, a') && sameName(normal(word.textContent), label));
}

// One connector for the whole page, drawn in viewport coordinates.
let link, linkPath, linkDot, active;
function ensureLink() {
  if (link) return;
  link = document.createElementNS(SVG, 'svg');
  link.classList.add('docs-callout-link');
  link.setAttribute('aria-hidden', 'true');
  linkPath = document.createElementNS(SVG, 'path');
  linkDot = document.createElementNS(SVG, 'circle');
  linkDot.setAttribute('r', '3.5');
  link.append(linkPath, linkDot);
  document.body.append(link);
}

/** A path through `points` with rounded right-angle corners. */
function elbowPath(points) {
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
    const inLength = Math.hypot(b.x - a.x, b.y - a.y), outLength = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(CORNER, inLength / 2, outLength / 2);
    if (r < 0.5) { d += ` L${b.x} ${b.y}`; continue; }
    const before = { x: b.x - ((b.x - a.x) / inLength) * r, y: b.y - ((b.y - a.y) / inLength) * r };
    const after = { x: b.x + ((c.x - b.x) / outLength) * r, y: b.y + ((c.y - b.y) / outLength) * r };
    d += ` L${before.x} ${before.y} Q${b.x} ${b.y} ${after.x} ${after.y}`;
  }
  const end = points.at(-1);
  return `${d} L${end.x} ${end.y}`;
}

/** Word box → callout circle: out of the word, round two corners, into the circle's edge. */
function route(word, circle) {
  const w = word.getBoundingClientRect();
  const ctm = circle.getScreenCTM();
  if (!ctm) return undefined;
  const centre = new DOMPoint(Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))).matrixTransform(ctm);
  const r = Number(circle.getAttribute('r')) * Math.hypot(ctm.a, ctm.b) + 3;
  const t = { x: centre.x, y: centre.y };
  const verticalGap = t.y > w.bottom ? t.y - w.bottom : t.y < w.top ? w.top - t.y : 0;
  const horizontalGap = t.x > w.right ? t.x - w.right : t.x < w.left ? w.left - t.x : 0;
  if (verticalGap >= horizontalGap) {
    const down = t.y > w.bottom;
    const start = { x: Math.min(Math.max(t.x, w.left + 6), w.right - 6), y: down ? w.bottom + 3 : w.top - 3 };
    if (Math.abs(start.x - t.x) < 2) return [start, { x: t.x, y: t.y + (down ? -r : r) }];
    const middle = start.y + (t.y - start.y) * 0.5;
    return [start, { x: start.x, y: middle }, { x: t.x, y: middle }, { x: t.x, y: t.y + (down ? -r : r) }];
  }
  const right = t.x > w.right;
  const start = { x: right ? w.right + 4 : w.left - 4, y: w.top + w.height / 2 };
  const middle = start.x + (t.x - start.x) * 0.5;
  return [start, { x: middle, y: start.y }, { x: middle, y: t.y }, { x: t.x + (right ? -r : r), y: t.y }];
}

function draw(animate) {
  if (!active) return;
  const points = route(active.word, active.callout.circle);
  if (!points) return;
  linkPath.setAttribute('d', elbowPath(points));
  linkDot.setAttribute('cx', String(points[0].x));
  linkDot.setAttribute('cy', String(points[0].y));
  if (!animate) return;
  const length = linkPath.getTotalLength();
  linkPath.style.transition = 'none';
  linkPath.style.strokeDasharray = `${length}`;
  linkPath.style.strokeDashoffset = reducedMotion.matches ? '0' : `${length}`;
  link.getBoundingClientRect();
  linkPath.style.transition = '';
  linkPath.style.strokeDashoffset = '0';
}

function activate(callout, word) {
  if (active?.callout === callout && active.word === word) return;
  deactivate();
  callout.group.classList.add('is-active');
  for (const each of callout.words) each.classList.add('is-active');
  if (!word) { active = { callout }; return; }
  ensureLink();
  active = { callout, word };
  link.classList.add('is-active');
  draw(true);
}

function deactivate() {
  if (!active) return;
  active.callout.group.classList.remove('is-active');
  for (const each of active.callout.words) each.classList.remove('is-active');
  link?.classList.remove('is-active');
  active = undefined;
}

let frame = 0;
const follow = () => { if (active?.word && !frame) frame = requestAnimationFrame(() => { frame = 0; draw(false); }); };
addEventListener('scroll', follow, { passive: true, capture: true });
addEventListener('resize', follow, { passive: true });
document.addEventListener('pointerdown', (event) => {
  if (active && !event.target.closest?.('.docs-callout-word, .docs-callout')) deactivate();
});

const content = document.querySelector('.sl-markdown-content');
for (const svg of content?.querySelectorAll('.docs-shot-stage > svg.docs-shot-overlay') ?? []) {
  const stage = svg.parentElement;
  const figure = stage.closest('figure') ?? stage;
  const caption = figure.querySelector('figcaption');
  const items = callouts(svg);
  if (!items.length) continue;
  const labels = captionLabels(caption);
  const section = sectionOf(figure, content);
  const refs = captionRefs(caption, new Set(items.map((item) => item.number)));
  for (const item of items) {
    const label = labels.get(item.number);
    let words = label ? boldWords(section, label) : [];
    if (label && !words.length) words = boldWords([content], label).slice(0, 1);
    item.words = [...refs.filter((ref) => ref.dataset.callout === item.number), ...words];
    for (const word of item.words) {
      word.classList.add('docs-callout-word');
      word.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch') activate(item, word); });
      word.addEventListener('pointerleave', (event) => { if (event.pointerType !== 'touch') deactivate(); });
      word.addEventListener('click', () => {
        if (active?.callout === item && active.word === word) deactivate(); else activate(item, word);
      });
    }
    item.group.addEventListener('pointerenter', () => activate(item, item.words.find((word) => !word.matches('.docs-callout-ref')) ?? item.words[0]));
    item.group.addEventListener('pointerleave', deactivate);
  }
  stage.classList.add('docs-callouts-live');
}
