// Effect Lab: renders effects through the real EffectsPipeline on the hardware GPU and
// writes PNGs plus one labelled contact sheet per run, for effect review and doc stills.
//
//   node scripts/effect-lab.mjs --list                       # effect ids, kinds, params (JSON)
//   node scripts/effect-lab.mjs --effect gaussian-blur --out <dir>
//       [--variants '[{"label":"soft","params":{"radius":4}}, ...]' | --variants-file f.json]
//       [--images dancer_stage,harbor_town,neon_rain_street] [--width 960]
//       [--times 0,0.033,0.067] [--url http://localhost:5175]
//
// Each variant renders on each image; "original" (effect bypassed) is always the first column.
// Needs a running Vite of this checkout (`npx vite --port 5175 --strictPort`).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

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
    const results = [];
    for (const image of images) {
      const row = [];
      const original = await page.evaluate(job => window.__effectLab.render(job), { effectId, image: `${image}.jpg`, width, bypass: true });
      row.push({ label: 'original', ...original });
      for (const variant of variants) {
        const result = await page.evaluate(job => window.__effectLab.render(job), { effectId, image: `${image}.jpg`, width, params: variant.params, times });
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
