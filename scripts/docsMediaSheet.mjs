// The contact sheet of a docs media run (scripts/docs-media.mjs): every picture and clip the run made,
// labelled, so a reviewer sees all of them at once. A picture fills its cell; a clip shows four frames
// (at 10, 35, 60 and 85 % of its length) in a 2 × 2 grid. A long run gets several pages of ROWS_PER_PAGE
// rows (contact-sheet-1.jpg, -2 …), so no JPEG comes near the format's 65,535 px limit.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CELL = 640;
const LABEL = 30;
const GAP = 10;
const COLUMNS = 3;
/** Rows per page: a clip cell is at most about 1,100 px tall, so a page stays below 15,000 px. */
export const ROWS_PER_PAGE = 12;
const BACKGROUND = { r: 17, g: 17, b: 17, alpha: 1 };

const escapeXml = (text) => text.replace(/[<>&"]/gu, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char]);

function videoFrames(file, width) {
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim()) || 1;
  return [0.1, 0.35, 0.6, 0.85].map((share) => execFileSync('ffmpeg', ['-v', 'error', '-ss', (duration * share).toFixed(3), '-i', file,
    '-frames:v', '1', '-vf', `scale=${width}:-2`, '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 64 * 1024 * 1024 }));
}

/** One cell: the picture (or the clip's frames) at the cell width, with its label below. */
async function cell(sharp, { file, label }) {
  let body;
  if (/\.(mp4|webm)$/iu.test(file)) {
    const frames = videoFrames(file, CELL / 2);
    const sizes = await Promise.all(frames.map((frame) => sharp(frame).metadata()));
    const height = Math.max(...sizes.map((size) => size.height));
    body = await sharp({ create: { width: CELL, height: height * 2, channels: 4, background: BACKGROUND } })
      .composite(frames.map((frame, index) => ({ input: frame, left: (index % 2) * (CELL / 2), top: Math.floor(index / 2) * height }))).png().toBuffer();
  } else {
    body = await sharp(file).resize({ width: CELL, height: CELL, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  }
  const { height } = await sharp(body).metadata();
  const text = `<svg width="${CELL}" height="${LABEL}" xmlns="http://www.w3.org/2000/svg"><text x="6" y="20" font-family="sans-serif" font-size="15" fill="#e8e8e8">${escapeXml(label)}</text></svg>`;
  return { height: height + LABEL, image: await sharp({ create: { width: CELL, height: height + LABEL, channels: 4, background: BACKGROUND } })
    .composite([{ input: body, left: 0, top: 0 }, { input: Buffer.from(text), left: 0, top: height }]).png().toBuffer() };
}

/** The files of a sheet with `pages` pages: `out` itself for one page, else out-1.jpg, out-2.jpg … */
export const sheetPages = (out, pages) => (pages === 1 ? [out]
  : Array.from({ length: pages }, (_, index) => out.replace(/(\.jpe?g)?$/iu, (ext) => `-${index + 1}${ext || '.jpg'}`)));

/**
 * Writes the sheet of `items` ({ file, label }) to `out` (JPEG, split into pages); returns the written files,
 * or [] when there is nothing to show.
 */
export async function writeContactSheet(items, out, { title = 'docs media' } = {}) {
  const shown = items.filter((item) => fs.existsSync(item.file) && /\.(webp|png|jpe?g|mp4|webm)$/iu.test(item.file));
  if (!shown.length) return [];
  const { default: sharp } = await import('sharp');
  const perPage = ROWS_PER_PAGE * COLUMNS;
  const files = sheetPages(out, Math.ceil(shown.length / perPage));
  for (const [page, file] of files.entries()) {
    const cells = [];
    for (const item of shown.slice(page * perPage, (page + 1) * perPage)) cells.push(await cell(sharp, item));
    await writePage(sharp, cells, file, files.length > 1 ? `${title} · page ${page + 1} of ${files.length}` : title);
  }
  return files;
}

async function writePage(sharp, cells, out, title) {
  const rows = [];
  for (let index = 0; index < cells.length; index += COLUMNS) rows.push(cells.slice(index, index + COLUMNS));
  const heading = 40;
  const width = COLUMNS * CELL + (COLUMNS + 1) * GAP;
  const height = heading + rows.reduce((sum, row) => sum + Math.max(...row.map((entry) => entry.height)) + GAP, GAP);
  const layers = [{ input: Buffer.from(`<svg width="${width}" height="${heading}" xmlns="http://www.w3.org/2000/svg"><text x="${GAP}" y="28" font-family="sans-serif" font-size="20" fill="#ffffff">${escapeXml(title)}</text></svg>`), left: 0, top: 0 }];
  let top = heading + GAP;
  for (const row of rows) {
    row.forEach((entry, column) => layers.push({ input: entry.image, left: GAP + column * (CELL + GAP), top }));
    top += Math.max(...row.map((entry) => entry.height)) + GAP;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp({ create: { width, height, channels: 4, background: BACKGROUND }, limitInputPixels: false })
    .composite(layers).jpeg({ quality: 82 }).toFile(out);
}
