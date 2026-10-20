// Effect editor excerpts: puts an Effect Lab test image on the timeline of a fresh editor project,
// adds an effect, opens Properties → Effects and captures the inspector (with a strip of the
// preview) in hardware-GPU Chrome as WebP. Prints the docs `<figure>` with numbered callouts.
//
//   node scripts/effect-editor-shot.mjs scripts/effect-editor-shots/blur.json [--only <name>]
//       [--url http://localhost:5176] [--out docs/Features/assets/effects/editor]
//
// The shot file is `{ "shots": [shot, ...] }`; a shot:
//   name     file name (`<out>/<name>.webp`)
//   effect   effect id (`gaussian-blur`), params: { radius: 12 } on top of the defaults
//   image    Effect Lab image (tests/browser/effect-lab/images), default harbor_town.jpg
//   preview  CSS px of the preview kept left of the inspector (0: inspector only), default 380
//   top      "panel" (from the Properties tabs, default) or "card" (only the effect's card)
//   layout   "full" (docs column) or "float" (beside text): sizes the callouts, default "full"
//   marks    numbered callouts, in order. A mark is a target or { target, from, label }:
//              a parameter row label ("Radius", "Center X"), "tab:<sub-tab>" ("tab:Effects"),
//              "bypass", "remove", "add" (+ Add Effect) or "preview:<x>,<y>" (0–1 in the preview);
//              from = left (default) | right | above | below places the number; label goes into
//              the printed caption.
//   alt, caption  printed into the figure
// Needs a Vite of this checkout (`npx vite --port 5176 --strictPort`); each shot's project lives in
// a throwaway browser context.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { encodeDocShotWebp } from './docShotWebp.mjs';
import { calloutOverlay, docsFigure } from './docShotFigure.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const shotFile = args.find((arg, index) => !arg.startsWith('--') && !['--only', '--url', '--out'].includes(args[index - 1]));
if (!shotFile) throw new Error('Name a shot file, e.g. scripts/effect-editor-shots/blur.json');
const only = option('--only');
const shots = JSON.parse(fs.readFileSync(shotFile, 'utf8')).shots.filter(shot => !only || shot.name === only);
if (!shots.length) throw new Error(`No shot named ${only} in ${shotFile}`);
const url = option('--url', 'http://localhost:5176').replace(/\/$/, '');
const out = path.resolve(option('--out', 'docs/Features/assets/effects/editor'));
const imageDir = path.resolve('tests/browser/effect-lab/images');
const viewport = { width: 1600, height: 900 };

const launchArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,VulkanFromANGLE', '--use-angle=vulkan',
  '--ignore-gpu-blocklist', '--window-position=0,0'];

async function setUp(page, shot) {
  const tool = async (name, input) => {
    const result = await page.evaluate(([toolName, toolInput]) => window.aiTools.execute(toolName, toolInput), [name, input]);
    if (!result?.success) throw new Error(`${name}: ${result?.error ?? 'failed'}`);
    return result.data;
  };
  await page.goto(`${url}/editor`);
  await page.getByRole('button', { name: /New project/ }).click({ timeout: 60000 });
  await page.locator('form input').first().fill('Effect editor shot');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'End walkthrough' }).click({ timeout: 10000 }).catch(() => {});
  await page.setInputFiles('#media-panel-import-input', path.join(imageDir, shot.image ?? 'harbor_town.jpg'));
  let imported;
  for (let attempt = 0; attempt < 120 && !imported; attempt += 1) {
    imported = (await tool('getMediaItems', {})).files?.find(file => !file.isImporting);
    if (!imported) await page.waitForTimeout(250);
  }
  if (!imported) throw new Error(`${shot.name}: the image was not imported`);
  const added = await tool('addClipSegment', { mediaFileId: imported.id, trackId: null, startTime: 0, inPoint: 0, outPoint: 5 });
  const clipId = added.clips[0].id;
  await tool('addEffect', { clipId, effectType: shot.effect, params: shot.params ?? {} });
  await tool('selectClips', { clipIds: [clipId] });
  await tool('setPlayhead', { time: 1 });
  await page.getByRole('tab', { name: 'Properties' }).first().click();
  await page.locator('.effect-header').first().waitFor({ state: 'attached', timeout: 2000 }).catch(async () => {
    await page.locator('button').filter({ hasText: /^Effects/ }).first().click();
  });
  await page.locator('.effect-header').first().waitFor({ timeout: 10000 });
  // No hover state or pointer in the picture; the preview settles on the effect.
  await page.mouse.move(viewport.width / 2, viewport.height - 4);
  await page.waitForTimeout(2500);
}

/** Crop (CSS px) and the target box of every mark, measured in the page. */
function measure({ preview, top, marks }) {
  const box = element => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; };
  const header = document.querySelector('.effect-header');
  let panel = header;
  while (panel.parentElement && panel.parentElement.getBoundingClientRect().width < window.innerWidth * 0.45) panel = panel.parentElement;
  const card = header.parentElement;
  const panelBox = box(panel), cardBox = box(card);
  const canvas = [...document.querySelectorAll('canvas')].map(element => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.right <= panelBox.left + 2).sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
  const crop = { left: Math.max(0, panelBox.left - preview), top: top === 'card' ? cardBox.top - 8 : panelBox.top, right: panelBox.right, bottom: Math.min(window.innerHeight, cardBox.bottom + 12) };
  const find = target => {
    if (target.startsWith('preview:')) {
      const [x, y] = target.slice(8).split(',').map(Number), rect = canvas.rect;
      const px = rect.left + x * rect.width, py = rect.top + y * rect.height;
      return { left: px, right: px, top: py, bottom: py };
    }
    if (target.startsWith('tab:')) {
      const name = target.slice(4);
      return [...panel.querySelectorAll('button, [role=tab]')].find(element => element.textContent.trim().startsWith(name));
    }
    if (target === 'bypass') return card.querySelector('.effect-bypass-btn');
    if (target === 'remove') return card.querySelector('.btn-danger');
    if (target === 'add') return [...panel.querySelectorAll('button, summary, [role=button]')].find(element => element.textContent.includes('Add Effect'));
    // A parameter: the label text of its row.
    return [...card.querySelectorAll('*')].find(element => element.children.length === 0 && !header.contains(element)
      && element.textContent.trim() === target);
  };
  return { crop, marks: marks.map(mark => {
    const target = typeof mark === 'string' ? mark : mark.target;
    const found = find(target);
    return found ? (found instanceof Element ? box(found) : found) : { missing: target };
  }), text: card.innerText.replace(/\s+/g, ' ').slice(0, 300) };
}

function figure(shot, file, crop, boxes) {
  const marks = (shot.marks ?? []).map(mark => typeof mark === 'string' ? { target: mark } : mark);
  const labels = marks.map((mark, index) => `${index + 1} — ${mark.label ?? mark.target}.`);
  return docsFigure({ file, alt: shot.alt ?? shot.name, caption: shot.caption ?? labels.join(' '),
    svg: marks.length ? calloutOverlay({ name: shot.name, layout: shot.layout ?? 'full', crop, boxes, marks }) : '',
    classes: shot.layout === 'float' ? 'docs-shot--float-right' : '' });
}

// One browser per shot: a fresh project in its own private file system, and one GPU device at a time.
for (const shot of shots) {
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: [...launchArgs, `--window-size=${viewport.width},${viewport.height + 120}`] });
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    // Project folders come from the browser's private file system instead of the native picker,
    // and the session does not count as product usage.
    await context.addInitScript(() => {
      window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('effect-editor-shot', { create: true });
      Object.defineProperty(Navigator.prototype, 'doNotTrack', { configurable: true, get: () => '1' });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await setUp(page, shot);
    const { crop, marks, text } = await page.evaluate(measure, { preview: shot.preview ?? 380, top: shot.top ?? 'panel', marks: shot.marks ?? [] });
    const missing = marks.filter(mark => mark.missing).map(mark => mark.missing);
    if (missing.length) throw new Error(`${shot.name}: no control found for ${missing.join(', ')}; the effect card reads "${text}"`);
    const clip = { x: crop.left, y: crop.top, width: crop.right - crop.left, height: crop.bottom - crop.top };
    const encoded = await encodeDocShotWebp(page, await page.screenshot({ type: 'png', clip }), { maxBytes: 200000, maxPixelWidth: 1600 });
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, `${shot.name}.webp`);
    fs.writeFileSync(file, encoded.buffer);
    const pageErrors = [...new Set(errors)];
    console.log(`\n${path.relative(process.cwd(), file)}: ${encoded.width}x${encoded.height}, ${encoded.size} bytes`
      + `${pageErrors.length ? `, page errors: ${pageErrors.join(' | ')}` : ''}\n`);
    console.log(figure(shot, file, crop, marks));
  } finally {
    await browser.close();
  }
}
