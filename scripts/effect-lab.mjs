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
//   A variant may carry its own "times" (e.g. one variant per frame of an animation) instead of --times.
//       [--quality export]  # particle-render effects: export particle budget instead of preview
//       [--metrics]     # per cell: meanAlpha, edgeTransparent (alpha < 250 in the outer 8 px),
//                       # newBlack (max channel < 20 where the original's mean is above 60)
//       [--require-filled-border]  # with --metrics: fail when a variant leaves a transparent pixel in the
//                       # outer 8 px (an effect that should fill the layer, e.g. Voxel Relief at its defaults)
//   node scripts/effect-lab.mjs --compile-probe --effect voxel-relief [--width 1920]
//       # first frame (waits for the driver to build the pipelines) vs steady frame, in a fresh page
//   node scripts/effect-lab.mjs --pairs scripts/effect-lab-shots/blur.json [--only <name>]
//   node scripts/effect-lab.mjs --presets scripts/effect-lab-shots/presets.json [--only <effect id>]
//       # the preset strip of an effect page: one still per preset of the registry, named under it
//
// Each variant renders on each image; "original" (effect bypassed) is always the first column.
// `--pairs` writes docs close-ups: each entry of `{ "pairs": [...] }` renders two effects on one
// image and puts the same crop of both side by side as a WebP:
//   { "name", "out": "docs/Features/assets/effects/<file>.webp", "image": "neon_rain_street",
//     "width": 1920, "crop": [x, y, w, h] (px of the rendered frame), "zoom": 1.5 (enlarges the
//     crop, for small lights), "smooth": false (nearest-neighbour enlargement), "gap": 6,
//     "left": { "effect": "gaussian-blur", "params": {...} }, "right": { "effect": ..., "params": ..., "times": [0.5] } }
//     (a side's optional "times" renders an animated effect at those timeline seconds; the last one is kept;
//      a side's own "crop", "zoom" and "smooth" override the entry's, e.g. a whole frame beside a magnified detail)
// (`times`: timeline seconds rendered in order, for feedback effects that build up over frames)
// `"backdrop": "checker"` shows transparent pixels as a checkerboard, `"#3c6ec8"` as a flat colour.
// (an effect of "original" is the unchanged image).
// `"backdrop": "checker"` draws a checkerboard behind both crops, so transparent pixels show; a colour
// (`"backdrop": "#3c6ec8"`) fills them flat instead, which stays readable at float size.
// `"layout": "split"` shows one picture: the crop (default: the whole frame) of the left side up to
// `"split"` (0.5) of its width, the right side's crop after it, and a thin light divider; `"stack"`
// puts the two crops one above the other with `gap` between them. `"outWidth"` scales the result.
// `--presets` reads `{ "strips": [{ "effect", "image", "width": 1920, "crop": [x, y, w, h], "times": [1.2],
//   "cellWidth": 400, "columns": 2, "backdrop", "maxBytes" }] }` and renders every preset the effect declares
// (EffectPreset in src/effects/types.ts, read from the live registry, so names and values never drift)
// on that image, crops each, and lays them out in rows of `columns` (default: 2 for four presets, else up
// to 3) with the preset name under each cell, as docs/Features/assets/effects/presets/<effect>.webp.
// Needs a running Vite of this checkout (`npx vite --port 5175 --strictPort`).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { encodeDocShotWebp } from './docShotWebp.mjs';

/** Renders both sides of a pair entry, crops them and composes them side by side (PNG buffer). */
async function composePair(page, entry) {
  const side = spec => page.evaluate(job => window.__effectLab.render(job), {
    effectId: spec.effect === 'original' ? 'gaussian-blur' : spec.effect, image: `${entry.image}.jpg`, width: entry.width ?? 1920,
    params: spec.params ?? {}, bypass: spec.effect === 'original', times: spec.times });
  const [left, right] = [await side(entry.left), await side(entry.right)];
  for (const [label, cell] of [['left', left], ['right', right]]) if (cell.gpuFailure) throw new Error(`${entry.name} ${label}: ${cell.gpuFailure}`);
  // Each side may set its own crop, zoom and smooth (e.g. a whole frame beside a magnified detail);
  // split and stack show both sides through the left side's crop.
  const view = spec => ({ crop: spec.crop ?? entry.crop, zoom: spec.zoom ?? entry.zoom ?? 1, smooth: spec.smooth ?? entry.smooth ?? true });
  const png = await page.evaluate(async ({ cells, gap, layout, split, outWidth, backdrop }) => {
    const bitmaps = await Promise.all(cells.map(async cell => createImageBitmap(await (await fetch(cell.data)).blob())));
    const crops = cells.map((cell, index) => cell.crop ?? [0, 0, bitmaps[index].width, bitmaps[index].height]);
    let canvas, context;
    const start = (width, height) => {
      canvas = new OffscreenCanvas(width, height); context = canvas.getContext('2d');
      context.fillStyle = '#111'; context.fillRect(0, 0, canvas.width, canvas.height);
    };
    // smooth: false enlarges with nearest-neighbour, so scanlines and mask stripes stay crisp.
    const smoothing = smooth => { context.imageSmoothingEnabled = smooth; context.imageSmoothingQuality = 'high'; };
    // "checker" shows transparent pixels as a checkerboard instead of the dark page; a flat colour
    // ("#3c6ec8") reads as "nothing there" even at float size, where a checkerboard looks like dust.
    const paintBackdrop = (left, top, w, h) => {
      if (backdrop === 'checker') for (let ty = 0; ty < h; ty += 16) for (let tx = 0; tx < w; tx += 16) {
        context.fillStyle = ((tx + ty) / 16) % 2 ? '#8c8c8c' : '#bdbdbd';
        context.fillRect(left + tx, top + ty, Math.min(16, w - tx), Math.min(16, h - ty));
      }
      else if (typeof backdrop === 'string' && backdrop.startsWith('#')) { context.fillStyle = backdrop; context.fillRect(left, top, w, h); }
    };
    if (layout === 'split' || layout === 'stack') {
      const [x, y, w, h] = crops[0], scale = outWidth ? outWidth / w : cells[0].zoom;
      const cw = Math.round(w * scale), ch = Math.round(h * scale);
      start(cw, layout === 'stack' ? ch * 2 + gap : ch); smoothing(cells[0].smooth);
      if (layout === 'split') {
        paintBackdrop(0, 0, cw, ch);
        const cut = Math.round(w * split);
        context.drawImage(bitmaps[0], x, y, cut, h, 0, 0, Math.round(cut * scale), ch);
        context.drawImage(bitmaps[1], x + cut, y, w - cut, h, Math.round(cut * scale), 0, cw - Math.round(cut * scale), ch);
        context.fillStyle = 'rgba(255, 255, 255, 0.85)'; context.fillRect(Math.round(cut * scale) - 1, 0, 2, ch);
      } else {
        for (const [index, bitmap] of bitmaps.entries()) {
          paintBackdrop(0, index * (ch + gap), cw, ch);
          context.drawImage(bitmap, x, y, w, h, 0, index * (ch + gap), cw, ch);
        }
      }
    } else {
      let sizes = cells.map(({ zoom }, index) => [crops[index][2] * zoom, crops[index][3] * zoom]);
      if (outWidth) { const factor = (outWidth - gap) / (sizes[0][0] + sizes[1][0]); sizes = sizes.map(([w, h]) => [w * factor, h * factor]); }
      sizes = sizes.map(([w, h]) => [Math.round(w), Math.round(h)]);
      start(sizes[0][0] + gap + sizes[1][0], Math.max(sizes[0][1], sizes[1][1]));
      let x = 0;
      for (const [index, bitmap] of bitmaps.entries()) {
        smoothing(cells[index].smooth);
        const crop = crops[index];
        paintBackdrop(x, 0, sizes[index][0], sizes[index][1]);
        context.drawImage(bitmap, crop[0], crop[1], crop[2], crop[3], x, 0, sizes[index][0], sizes[index][1]);
        x += sizes[index][0] + gap;
      }
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }, { cells: [{ data: left.png, ...view(entry.left) }, { data: right.png, ...view(entry.right) }], gap: entry.gap ?? 6,
    layout: entry.layout ?? 'pair', split: entry.split ?? 0.5, outWidth: entry.outWidth, backdrop: entry.backdrop });
  return Buffer.from(png, 'base64');
}

/** Renders every preset of `entry.effect` on one image and composes the labelled preset strip (PNG buffer). */
async function composePresetStrip(page, entry) {
  const effect = (await page.evaluate(() => window.__effectLab.describe())).find(item => item.id === entry.effect);
  if (!effect) throw new Error(`--presets: "${entry.effect}" is not an effect id.`);
  if (!effect.presets?.length) throw new Error(`--presets: ${entry.effect} declares no presets.`);
  const cells = [];
  for (const preset of effect.presets) {
    const cell = await page.evaluate(job => window.__effectLab.render(job), { effectId: entry.effect, image: `${entry.image}.jpg`,
      width: entry.width ?? 1920, params: preset.params, times: entry.times });
    if (cell.gpuFailure) throw new Error(`${entry.effect} ${preset.name}: ${cell.gpuFailure}`);
    cells.push({ data: cell.png, label: preset.name });
  }
  const count = cells.length;
  const columns = entry.columns ?? (count === 4 ? 2 : Math.min(count, 3));
  const png = await page.evaluate(async ({ cells, crop, columns, cellWidth, gap, backdrop }) => {
    const bitmaps = await Promise.all(cells.map(async cell => createImageBitmap(await (await fetch(cell.data)).blob())));
    const [x, y, w, h] = crop ?? [0, 0, bitmaps[0].width, bitmaps[0].height];
    // The name stays readable when the strip is shown small (docs-shot--detail, about 200 px per cell).
    const cellHeight = Math.round(cellWidth * h / w), label = Math.round(cellWidth * 0.13), rows = Math.ceil(cells.length / columns);
    const canvas = new OffscreenCanvas(columns * cellWidth + (columns - 1) * gap, rows * (cellHeight + label) + (rows - 1) * gap);
    const context = canvas.getContext('2d');
    context.fillStyle = '#111'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    cells.forEach((cell, index) => {
      const left = (index % columns) * (cellWidth + gap), top = Math.floor(index / columns) * (cellHeight + label + gap);
      if (backdrop) { context.fillStyle = backdrop; context.fillRect(left, top, cellWidth, cellHeight); }
      context.drawImage(bitmaps[index], x, y, w, h, left, top, cellWidth, cellHeight);
      context.fillStyle = '#f2f2f2'; context.font = `600 ${Math.round(label * 0.56)}px system-ui, sans-serif`;
      context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(cell.label, left + cellWidth / 2, top + cellHeight + label / 2);
    });
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }, { cells, crop: entry.crop, columns, cellWidth: entry.cellWidth ?? 400, gap: entry.gap ?? 6, backdrop: entry.backdrop });
  return { png: Buffer.from(png, 'base64'), names: cells.map(cell => cell.label) };
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

  if (args.includes('--compile-probe')) {
    const job = { effectId: option('--effect'), image: 'dancer_stage.jpg', width: Number(option('--width', '1920')),
      params: option('--params') ? JSON.parse(option('--params')) : {} };
    console.log(JSON.stringify({ effectId: job.effectId, ...(await page.evaluate(probe => window.__effectLab.probeCompile(probe), job)), errors }));
  } else if (args.includes('--list')) {
    console.log(JSON.stringify(await page.evaluate(() => window.__effectLab.describe()), null, 1));
  } else if (option('--presets')) {
    const entries = JSON.parse(fs.readFileSync(option('--presets'), 'utf8')).strips.filter(entry => !option('--only') || entry.effect === option('--only'));
    if (!entries.length) throw new Error(`No preset strip ${option('--only')} in ${option('--presets')}`);
    for (const entry of entries) {
      const strip = await composePresetStrip(page, entry);
      const out = entry.out ?? `docs/Features/assets/effects/presets/${entry.effect}.webp`;
      const encoded = await encodeDocShotWebp(page, strip.png, { maxBytes: entry.maxBytes ?? 200000, maxPixelWidth: 1600 });
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(path.resolve(out), encoded.buffer);
      console.log(`${out}: ${encoded.width}x${encoded.height}, ${encoded.size} bytes, quality ${encoded.quality}; presets ${strip.names.join(', ')}`);
    }
    if (errors.length) console.log(`page errors: ${[...new Set(errors)].join(' | ')}`);
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
    const quality = option('--quality');
    const results = [];
    for (const image of images) {
      const row = [];
      const original = await page.evaluate(job => window.__effectLab.render(job), { effectId, image: `${image}.jpg`, width, bypass: true, inset });
      row.push({ label: 'original', ...original });
      for (const variant of variants) {
        const result = await page.evaluate(job => window.__effectLab.render(job), { effectId, image: `${image}.jpg`, width, params: variant.params,
          times: variant.times ?? times, inset, recipe: variant.recipe, quality });
        row.push({ label: variant.label, params: variant.params, ...result });
      }
      for (const cell of row) {
        const file = path.join(out, `${image}--${cell.label.replace(/[^a-z0-9-]+/gi, '_')}.png`);
        fs.writeFileSync(file, Buffer.from(cell.png.split(',')[1], 'base64'));
        cell.file = file;
      }
      results.push({ image, row });
    }
    // --metrics: coverage, transparent frame border and newly crushed black, against the original cell.
    if (args.includes('--metrics')) for (const { row } of results) {
      const metrics = await page.evaluate(async pngs => {
        const read = async png => { const bitmap = await createImageBitmap(await (await fetch(png)).blob());
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d');
          context.drawImage(bitmap, 0, 0); return context.getImageData(0, 0, bitmap.width, bitmap.height); };
        const original = await read(pngs[0]);
        return Promise.all(pngs.map(async png => {
          const { data, width, height } = await read(png);
          let alpha = 0, edgeTransparent = 0, newBlack = 0;
          for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * 4;
            alpha += data[i + 3];
            if ((x < 8 || y < 8 || x >= width - 8 || y >= height - 8) && data[i + 3] < 250) edgeTransparent += 1;
            const before = (original.data[i] + original.data[i + 1] + original.data[i + 2]) / 3;
            if (data[i + 3] > 0 && Math.max(data[i], data[i + 1], data[i + 2]) < 20 && before > 60) newBlack += 1;
          }
          return { meanAlpha: +(alpha / (255 * width * height)).toFixed(4), edgeTransparent, newBlack };
        }));
      }, row.map(cell => cell.png));
      row.forEach((cell, index) => { cell.metrics = metrics[index]; });
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
        gpuFailure: cell.gpuFailure, metrics: cell.metrics, pipelineFailures: cell.pipelineFailures?.length ? cell.pipelineFailures : undefined }))),
    };
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
    console.log(JSON.stringify(summary, null, 1));
    if (args.includes('--require-filled-border')) {
      const open = summary.cells.filter(cell => cell.label !== 'original' && cell.metrics?.edgeTransparent > 0);
      if (open.length) throw new Error(`transparent frame border: ${open.map(cell => `${cell.image} ${cell.label} (${cell.metrics.edgeTransparent} px)`).join(', ')}`);
      console.log('filled border: every variant covers the outer 8 px');
    }
  }
} finally {
  await browser.close();
}
