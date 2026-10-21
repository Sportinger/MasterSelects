// Effect Lab: renders effects through the real EffectsPipeline on the hardware GPU and
// writes PNGs plus one labelled contact sheet per run, for effect review and doc stills.
//
//   node scripts/effect-lab.mjs --list                       # effect ids, kinds, params (JSON)
//   node scripts/effect-lab.mjs --effect gaussian-blur --out <dir>
//       [--variants '[{"label":"soft","params":{"radius":4}}, ...]' | --variants-file f.json]
//       (a variant with "recipe": "earlier" renders a rebuilt stylize effect as saved projects keep it)
//       [--images dancer_stage,harbor_town,neon_rain_street] [--width 960]
//       [--times 0,0.033,0.067] [--url http://localhost:5175]
//       [--inset 0.7]   # image at 70 % on transparency; the sheet shows cells over a checkerboard
//   node scripts/effect-lab.mjs --pairs scripts/effect-lab-shots/blur.json [--only <name>]
//
// Each variant renders on each image; "original" (effect bypassed) is always the first column.
// `--pairs` writes docs close-ups: each entry of `{ "pairs": [...] }` renders two effects on one
// image and puts the same crop of both side by side as a WebP:
//   { "name", "out": "docs/Features/assets/effects/<file>.webp", "image": "neon_rain_street",
//     "width": 1920, "crop": [x, y, w, h] (px of the rendered frame), "zoom": 1.5 (enlarges the
//     crop, for small lights), "gap": 6,
//     "left": { "effect": "gaussian-blur", "params": {...} }, "right": { "effect": ..., "params": ... } }
// (an effect of "original" is the unchanged image).
// `"layout": "split"` shows one picture: the crop (default: the whole frame) of the left side up to
// `"split"` (0.5) of its width, the right side's crop after it, and a thin light divider; `"stack"`
// puts the two crops one above the other with `gap` between them. `"outWidth"` scales the result.
// Needs a running Vite of this checkout (`npx vite --port 5175 --strictPort`).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { encodeDocShotWebp } from './docShotWebp.mjs';

/** Renders both sides of a pair entry, crops them and composes them side by side (PNG buffer). */
async function composePair(page, entry) {
  const side = spec => page.evaluate(job => window.__effectLab.render(job), {
    effectId: spec.effect === 'original' ? 'gaussian-blur' : spec.effect, image: `${entry.image}.jpg`, width: entry.width ?? 1920,
    params: spec.params ?? {}, bypass: spec.effect === 'original' });
  const [left, right] = [await side(entry.left), await side(entry.right)];
  for (const [label, cell] of [['left', left], ['right', right]]) if (cell.gpuFailure) throw new Error(`${entry.name} ${label}: ${cell.gpuFailure}`);
  const png = await page.evaluate(async ({ left, right, crop, gap, zoom, layout, split, outWidth }) => {
    const bitmaps = [await createImageBitmap(await (await fetch(left)).blob()), await createImageBitmap(await (await fetch(right)).blob())];
    const [x, y, w, h] = crop ?? [0, 0, bitmaps[0].width, bitmaps[0].height];
    const scale = !outWidth ? zoom : layout === 'pair' ? (outWidth - gap) / (w * 2) : outWidth / w;
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    const size = layout === 'split' ? [cw, ch] : layout === 'stack' ? [cw, ch * 2 + gap] : [cw * 2 + gap, ch];
    const canvas = new OffscreenCanvas(size[0], size[1]), context = canvas.getContext('2d');
    context.fillStyle = '#111'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    if (layout === 'split') {
      const cut = Math.round(w * split);
      context.drawImage(bitmaps[0], x, y, cut, h, 0, 0, Math.round(cut * scale), ch);
      context.drawImage(bitmaps[1], x + cut, y, w - cut, h, Math.round(cut * scale), 0, cw - Math.round(cut * scale), ch);
      context.fillStyle = 'rgba(255, 255, 255, 0.85)'; context.fillRect(Math.round(cut * scale) - 1, 0, 2, ch);
    } else {
      for (const [index, bitmap] of bitmaps.entries()) {
        context.drawImage(bitmap, x, y, w, h, layout === 'stack' ? 0 : index * (cw + gap), layout === 'stack' ? index * (ch + gap) : 0, cw, ch);
      }
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }, { left: left.png, right: right.png, crop: entry.crop, gap: entry.gap ?? 6, zoom: entry.zoom ?? 1, layout: entry.layout ?? 'pair',
    split: entry.split ?? 0.5, outWidth: entry.outWidth });
  return Buffer.from(png, 'base64');
}

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const url = option('--url', 'http://localhost:5175');
const launchArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,VulkanFromANGLE', '--use-angle=vulkan',
  '--ignore-gpu-blocklist', '--window-position=0,0', '--window-size=480,320'];

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: launchArgs });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 300)); });
  await page.goto(`${url}/tests/browser/effect-lab/index.html`);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'ready', null, { timeout: 120000 });

  if (args.includes('--list')) {
    console.log(JSON.stringify(await page.evaluate(() => window.__effectLab.describe()), null, 1));
  } else if (option('--pairs')) {
    const entries = JSON.parse(fs.readFileSync(option('--pairs'), 'utf8')).pairs.filter(entry => !option('--only') || entry.name === option('--only'));
    if (!entries.length) throw new Error(`No pair ${option('--only')} in ${option('--pairs')}`);
    for (const entry of entries) {
      const encoded = await encodeDocShotWebp(page, await composePair(page, entry), { maxBytes: entry.maxBytes ?? 200000, maxPixelWidth: 1600 });
      fs.mkdirSync(path.dirname(path.resolve(entry.out)), { recursive: true });
      fs.writeFileSync(path.resolve(entry.out), encoded.buffer);
      console.log(`${entry.out}: ${encoded.width}x${encoded.height}, ${encoded.size} bytes, quality ${encoded.quality}`);
    }
    if (errors.length) console.log(`page errors: ${[...new Set(errors)].join(' | ')}`);
  } else {
    const effectId = option('--effect');
    if (!effectId) throw new Error('--effect <id> or --list is required');
    const out = path.resolve(option('--out', `effect-lab-out/${effectId}`));
    fs.mkdirSync(out, { recursive: true });
    const variantsSource = option('--variants-file') ? fs.readFileSync(option('--variants-file'), 'utf8') : option('--variants', '[{"label":"default","params":{}}]');
    const variants = JSON.parse(variantsSource);
    const images = option('--images', 'dancer_stage,harbor_town,neon_rain_street').split(',');
    const width = Number(option('--width', '960'));
    const times = option('--times') ? option('--times').split(',').map(Number) : undefined;
    const inset = option('--inset') ? Number(option('--inset')) : undefined;
    const results = [];
    for (const image of images) {
      const row = [];
      const original = await page.evaluate(job => window.__effectLab.render(job), { effectId, image: `${image}.jpg`, width, bypass: true, inset });
      row.push({ label: 'original', ...original });
      for (const variant of variants) {
        const result = await page.evaluate(job => window.__effectLab.render(job), { effectId, image: `${image}.jpg`, width, params: variant.params, times, inset, recipe: variant.recipe });
        row.push({ label: variant.label, params: variant.params, ...result });
      }
      for (const cell of row) {
        const file = path.join(out, `${image}--${cell.label.replace(/[^a-z0-9-]+/gi, '_')}.png`);
        fs.writeFileSync(file, Buffer.from(cell.png.split(',')[1], 'base64'));
        cell.file = file;
      }
      results.push({ image, row });
    }
    // Contact sheet: rows = images, columns = original + variants, labels on top.
    const sheet = await page.evaluate(async ({ rows, effectId }) => {
      const thumbWidth = 480, label = 22;
      const first = rows[0].row[0];
      const thumbHeight = Math.round(thumbWidth * first.height / first.width);
      const columns = rows[0].row.length;
      const canvas = new OffscreenCanvas(columns * thumbWidth, rows.length * (thumbHeight + label) + 28);
      const context = canvas.getContext('2d');
      context.fillStyle = '#111'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#eee'; context.font = '16px system-ui'; context.fillText(effectId, 8, 20);
      for (let r = 0; r < rows.length; r += 1) for (let c = 0; c < columns; c += 1) {
        const cell = rows[r].row[c];
        const bitmap = await createImageBitmap(await (await fetch(cell.png)).blob());
        const y = 28 + r * (thumbHeight + label);
        context.fillStyle = '#ccc'; context.font = '13px system-ui';
        context.fillText(`${cell.label}${cell.gpuFailure ? ' (GPU FAILURE)' : ''}`, c * thumbWidth + 6, y + 15);
        // Checkerboard behind each cell so transparent or dark-fringed edges are visible.
        for (let ty = 0; ty < thumbHeight; ty += 12) for (let tx = 0; tx < thumbWidth; tx += 12) {
          context.fillStyle = ((tx + ty) / 12) % 2 ? '#9a9a9a' : '#c8c8c8';
          context.fillRect(c * thumbWidth + tx, y + label + ty, Math.min(12, thumbWidth - tx), Math.min(12, thumbHeight - ty));
        }
        context.drawImage(bitmap, c * thumbWidth, y + label, thumbWidth, thumbHeight);
      }
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      return await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
    }, { rows: results, effectId });
    const sheetFile = path.join(out, 'contact-sheet.jpg');
    fs.writeFileSync(sheetFile, Buffer.from(sheet.split(',')[1], 'base64'));
    const summary = {
      effectId, sheet: sheetFile, errors,
      cells: results.flatMap(({ image, row }) => row.map(cell => ({ image, label: cell.label, file: cell.file, renderMs: cell.renderMs,
        gpuFailure: cell.gpuFailure, pipelineFailures: cell.pipelineFailures?.length ? cell.pipelineFailures : undefined }))),
    };
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
    console.log(JSON.stringify(summary, null, 1));
  }
} finally {
  await browser.close();
}
