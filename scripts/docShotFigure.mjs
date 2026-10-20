// Shared by the docs picture scripts (effect-editor-shot.mjs, effect-graph-shot.mjs): numbered
// callouts as an SVG overlay over a captured picture, and the docs `<figure>` around it.
import path from 'node:path';

// Callouts match the existing docs pictures: a 1017-unit overlay per 720 px docs column.
const DISPLAY_WIDTH = { full: 720, float: 418 };
const UNITS_PER_PX = 1017 / 720, RADIUS = 18, REACH = 84;

/**
 * `crop` and `boxes` are page CSS px ({ left, top, right, bottom }); `marks[i].from` places
 * number i (left | right | above | below, default left). Returns the overlay markup.
 */
export function calloutOverlay({ name, layout = 'full', crop, boxes, marks }) {
  const width = crop.right - crop.left, height = crop.bottom - crop.top;
  const scale = DISPLAY_WIDTH[layout] * UNITS_PER_PX / width;
  const vw = Math.round(width * scale), vh = Math.round(height * scale);
  const clamp = (value, max) => Math.min(max - RADIUS - 4, Math.max(RADIUS + 4, value));
  const marker = `${name}-arrow`;
  const lines = [`<svg class="docs-shot-overlay" viewBox="0 0 ${vw} ${vh}" aria-hidden="true" focusable="false">`,
    `<defs><marker id="${marker}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>`];
  boxes.forEach((target, index) => {
    const from = marks[index]?.from ?? 'left';
    const x = value => (value - crop.left) * scale, y = value => (value - crop.top) * scale;
    const middle = { x: x((target.left + target.right) / 2), y: y((target.top + target.bottom) / 2) };
    const tip = { left: { x: x(target.left) - 6, y: middle.y }, right: { x: x(target.right) + 6, y: middle.y },
      above: { x: middle.x, y: y(target.top) - 6 }, below: { x: middle.x, y: y(target.bottom) + 6 } }[from];
    const step = { left: [-REACH, 0], right: [REACH, 0], above: [0, -REACH], below: [0, REACH] }[from];
    const cx = Math.round(clamp(tip.x + step[0], vw)), cy = Math.round(clamp(tip.y + step[1], vh));
    lines.push(`<path class="docs-shot-arrow" d="M${cx} ${cy} L${Math.round(tip.x)} ${Math.round(tip.y)}" marker-end="url(#${marker})" />`,
      `<circle class="docs-shot-number" cx="${cx}" cy="${cy}" r="${RADIUS}" /><text x="${cx}" y="${cy}" class="docs-shot-number-text">${index + 1}</text>`);
  });
  lines.push('</svg>');
  return lines.join('\n');
}

/** The docs figure for `file` (relative to docs/Features when inside it), with an optional overlay. */
export function docsFigure({ file, alt, caption, svg, classes = '' }) {
  const featuresDir = path.resolve('docs/Features');
  const src = file.startsWith(featuresDir) ? path.relative(featuresDir, file) : file;
  const image = `![${alt}](${src})`;
  const body = svg ? `<div class="docs-shot-stage">\n\n${image}\n\n${svg}\n</div>` : image;
  return `<figure class="docs-shot${classes ? ` ${classes}` : ''}">\n\n${body}\n\n<figcaption>${caption}</figcaption>\n</figure>`;
}
