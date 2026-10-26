// Shared by tutorial-video.mjs and tutorial-tab.mjs: the pictures an agent looks at while it builds a
// tutorial. Every setup step leaves one (steps.jpg shows them all), a take leaves one per step from its
// own frames (scenes.jpg), a failed step leaves the page before and after it side by side, and a part
// that continues a checkpoint is compared with the checkpoint's last frame (seam.jpg).
import fs from 'node:fs';
import sharp from 'sharp';

const escapeXml = text => String(text).replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);

/** The page as a JPEG (or PNG for a .png file), through DevTools: Playwright's page.screenshot resets the
 * emulated pixel ratio of an attached tab. `clip` is a CSS px rectangle. */
export async function snapshot(context, page, file, { clip } = {}) {
  const session = await context.newCDPSession(page);
  try {
    const png = file.endsWith('.png');
    const { data } = await session.send('Page.captureScreenshot', { format: png ? 'png' : 'jpeg', ...(png ? {} : { quality: 82 }),
      ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  } finally {
    await session.detach().catch(() => {});
  }
}

/** A step in a few words, for picture labels and messages: "click Effects@right-group". */
export function stepLabel(step) {
  const kind = Object.keys(step).find(key => !['ms', 'after', 'approach', 'hold', 'label', 'until', 'button', 'delay', 'timeout', 'early', 'nth'].includes(key)) ?? 'step';
  const value = step[kind];
  const text = typeof value === 'string' || typeof value === 'number' ? value : value === true ? '' : JSON.stringify(value);
  return `${kind} ${text}${step.button === 'right' ? ' (right)' : ''}${step.to ? ` → ${step.to}` : ''}`.trim().slice(0, 70);
}

/** A label strip under a picture, as an SVG for sharp's composite. */
function caption(text, width, height = 34, { color = '#e8ecf3', background = '#14171d' } = {}) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${background}"/>`
    + `<text x="10" y="${height * 0.68}" font-family="DejaVu Sans, sans-serif" font-size="${Math.round(height * 0.5)}" fill="${color}">${escapeXml(text)}</text></svg>`);
}

/**
 * A contact sheet: every picture small, with its label under it, `columns` across, at most `perPage` per
 * sheet (more pictures go on <name>-2.jpg, <name>-3.jpg …, so each sheet stays readable).
 * items: [{ file, label, bad? }] (bad: a red label). Writes `file` (JPEG) and returns the sheets written
 * (the first is `file`), or null without pictures.
 */
export async function contactSheet(items, file, { columns = 4, width = 640, perPage = 16 } = {}) {
  const present = items.filter(item => item.file && fs.existsSync(item.file));
  if (!present.length) return null;
  const meta = await sharp(present[0].file).metadata();
  const height = Math.round(width * meta.height / meta.width), label = 34, cell = height + label;
  const sheets = [];
  for (let page = 0; page * perPage < present.length; page += 1) {
    const chunk = present.slice(page * perPage, (page + 1) * perPage);
    const rows = Math.ceil(chunk.length / columns);
    const tiles = await Promise.all(chunk.map(async (item, index) => {
      const left = (index % columns) * width, top = Math.floor(index / columns) * cell;
      const picture = await sharp(item.file).resize(width, height, { fit: 'contain', background: '#000' }).jpeg({ quality: 80 }).toBuffer();
      return [{ input: picture, left, top },
        { input: caption(item.label, width, label, item.bad ? { color: '#fff', background: '#b3261e' } : {}), left, top: top + height }];
    }));
    const sheet = page ? file.replace(/\.jpg$/, `-${page + 1}.jpg`) : file;
    await sharp({ create: { width: Math.min(columns, chunk.length) * width, height: rows * cell, channels: 3, background: '#0b0d12' } })
      .composite(tiles.flat()).jpeg({ quality: 82 }).toFile(sheet);
    sheets.push(sheet);
  }
  // Sheets of an earlier, longer run would otherwise stay next to these.
  for (let page = sheets.length + 1; fs.existsSync(file.replace(/\.jpg$/, `-${page}.jpg`)); page += 1) fs.rmSync(file.replace(/\.jpg$/, `-${page}.jpg`));
  return sheets;
}

/** The page before a failed step and at the failure, side by side with the error under them. */
export async function beforeAfter({ before, after, message, file, width = 1280 }) {
  const items = [before && { file: before, label: 'before the step' }, { file: after, label: 'when it failed', bad: true }].filter(Boolean);
  const sheet = (await contactSheet(items, `${file}.tmp.jpg`, { columns: items.length, width }))?.[0];
  if (!sheet) return null;
  const meta = await sharp(sheet).metadata();
  const lines = String(message).match(/.{1,150}(\s|$)/g)?.slice(0, 4) ?? [String(message)];
  const note = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${lines.length * 30 + 16}"><rect width="100%" height="100%" fill="#2a0f0d"/>`
    + lines.map((line, index) => `<text x="12" y="${30 + index * 30}" font-family="DejaVu Sans, sans-serif" font-size="20" fill="#ffd9d4">${escapeXml(line.trim())}</text>`).join('') + '</svg>');
  await sharp(sheet).extend({ bottom: lines.length * 30 + 16, background: '#2a0f0d' })
    .composite([{ input: note, left: 0, top: meta.height }]).jpeg({ quality: 82 }).toFile(file);
  fs.rmSync(sheet, { force: true });
  return file;
}

/**
 * How far two pictures of the page differ (a checkpoint's last frame and the next part's first one):
 * share of pixels that differ visibly, and the box around them in CSS px (`width`: the page width).
 * Writes `file`: before | now | difference. Returns { changed, box, file }.
 */
export async function seamDifference({ before, now, file, width }) {
  const size = { width: 640, height: 360 };
  const gray = source => sharp(source).resize(size.width, size.height, { fit: 'fill' }).grayscale().raw().toBuffer();
  const [a, b] = await Promise.all([gray(before), gray(now)]);
  const diff = Buffer.alloc(a.length);
  let changed = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let i = 0; i < a.length; i += 1) {
    const delta = Math.abs(a[i] - b[i]);
    diff[i] = Math.min(255, delta * 4);
    if (delta <= 24) continue;
    changed += 1;
    const x = i % size.width, y = Math.floor(i / size.width);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const toPage = (width ?? size.width) / size.width;
  const box = maxX < 0 ? null : { x: Math.round(minX * toPage), y: Math.round(minY * toPage),
    width: Math.round((maxX - minX + 1) * toPage), height: Math.round((maxY - minY + 1) * toPage) };
  const diffFile = `${file}.diff.png`;
  await sharp(diff, { raw: { ...size, channels: 1 } }).png().toFile(diffFile);
  await contactSheet([{ file: before, label: 'checkpoint: last frame' }, { file: now, label: 'this part: first frame' },
    { file: diffFile, label: 'difference', bad: changed > 0 }], file, { columns: 3, width: 640 });
  fs.rmSync(diffFile, { force: true });
  return { changed: changed / a.length, box, file };
}

/** Page side: is the preview canvas showing something (not a black or empty frame)? Its rectangle, for a picture. */
export function previewRect() {
  const canvas = [...document.querySelectorAll('.preview-canvas-wrapper canvas')]
    .map(element => element.getBoundingClientRect()).filter(rect => rect.width > 20 && rect.height > 20)
    .toSorted((a, b) => b.width * b.height - a.width * a.height)[0];
  return canvas ? { x: canvas.left, y: canvas.top, width: canvas.width, height: canvas.height } : null;
}

/** Mean luminance of a picture (0–255) and the share of its pixels brighter than 30: a black preview has almost none. */
export async function luminance(file) {
  const { data } = await sharp(file).grayscale().raw().toBuffer({ resolveWithObject: true });
  let sum = 0, lit = 0;
  for (const value of data) { sum += value; if (value > 30) lit += 1; }
  return { mean: sum / data.length, lit: lit / data.length };
}
