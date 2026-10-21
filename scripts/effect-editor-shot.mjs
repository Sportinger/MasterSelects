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
//   top      "panel" (from the dock tabs, default), "tabs" (from the Properties sub-tabs, below
//            the dock tab row) or "card" (only the effect's card)
//   view     "inspector" (default: Properties → Effects) or "nodes": the Nodes tab showing the
//            clip's graph (source set to the clip, Clip graph view, node inspector hidden, fitted), from the
//            dock tab row down; preview/top do not apply
//   hide     button texts left out of the picture (e.g. an unrelated quick-add button)
//   layout   "full" (docs column) or "float" (beside text): sizes the callouts, default "full"
//   marks    numbered callouts, in order. A mark is a target or { target, from, reach, label }:
//              a parameter row label ("Radius", "Center X"; the arrow points at the label text),
//              "tab:<sub-tab>" ("tab:Effects"), "bypass", "remove", "add" (+ Add Effect) or
//              "preview:<x>,<y>" (0–1 in the preview); in the nodes view "dock:<tab>" ("dock:Nodes"),
//              "source" (the graph source picker), "expand:<card title>" (the › of a folded card) or
//              "port:<port name>" (a port row); text targets point at the text itself, not at the
//              empty rest of its row; from = left (default) | right | above | below places the
//              number, reach its arrow length (overlay units, default 84; the crop grows to keep it);
//              label goes into the printed caption.
//   viewport { width, height } of the editor window (default 1600 x 900): a wider window gives the
//            Properties panel room, so an effect with sections shows its rows with sliders
//   alt, caption  printed into the figure
// Needs a Vite of this checkout (`npx vite --port 5176 --strictPort`); each shot's project lives in
// a throwaway browser context.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { encodeDocShotWebp } from './docShotWebp.mjs';
import { calloutOverlay, cropWithCallouts, docsFigure } from './docShotFigure.mjs';

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
const defaultViewport = { width: 1600, height: 900 };
let viewport = defaultViewport;

const launchArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,VulkanFromANGLE', '--use-angle=vulkan',
  '--ignore-gpu-blocklist', '--window-position=0,0'];

async function openNodes(page, shot) {
  await page.getByRole('tab', { name: 'Nodes', exact: true }).first().click();
  await page.getByRole('combobox', { name: 'Node graph source' }).click();
  await page.getByRole('option').filter({ hasText: shot.image ?? 'harbor_town.jpg' }).first().click();
  await page.getByRole('button', { name: 'Clip graph', exact: true }).first().click().catch(() => {});
  const inspector = page.locator('.node-workspace-inspector-handle[aria-expanded="true"]');
  if (await inspector.count()) await inspector.first().click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => [...document.querySelectorAll('.node-workspace-toolbar button')].find(button => button.textContent === 'Fit')?.click());
  await page.mouse.move(viewport.width / 2, viewport.height - 4);
  await page.waitForTimeout(2500);
}

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
  // Controls named in `hide` are not part of what the picture explains.
  if (shot.hide?.length) await page.evaluate(texts => {
    for (const element of document.querySelectorAll('button')) if (texts.includes(element.textContent.trim())) element.style.display = 'none';
  }, shot.hide);
  // No hover state or pointer in the picture; the preview settles on the effect.
  await page.mouse.move(viewport.width / 2, viewport.height - 4);
  await page.waitForTimeout(2500);
}

/** Crop (CSS px) and the target box of every mark, measured in the page. */
function measure({ preview, top, marks, view }) {
  const box = element => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; };
  // A label's own text, not the row or bar it fills: callouts end at the words.
  const textBox = element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();
    return rect.width ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : box(element);
  };
  if (view === 'nodes') {
    const canvas = document.querySelector('.node-workspace-canvas');
    const dockTab = name => [...document.querySelectorAll('[role=tab]')].find(element => element.textContent.trim() === name);
    const tabs = dockTab('Nodes')?.parentElement;
    const canvasBox = box(canvas), tabsBox = tabs ? box(tabs) : canvasBox;
    // Down to the lowest card: the empty canvas below it explains nothing.
    const cards = [...document.querySelectorAll('.node-workspace-canvas .node-workspace-node')].map(element => element.getBoundingClientRect().bottom);
    const crop = { left: Math.max(0, Math.min(tabsBox.left, canvasBox.left)), top: Math.max(0, tabsBox.top), right: canvasBox.right,
      bottom: Math.min(canvasBox.bottom, cards.length ? Math.max(...cards) + 20 : canvasBox.bottom) };
    const find = target => {
      if (target.startsWith('dock:')) { const tab = dockTab(target.slice(5)); return tab && textBox(tab); }
      if (target === 'source') { const select = document.querySelector('[aria-label="Node graph source"]'); return select && box(select); }
      if (target.startsWith('expand:')) {
        // The › is painted at graph offset (5…25, 31…51) of the card; the card's layout size gives the zoom.
        const card = [...document.querySelectorAll('.node-workspace-node[aria-label]')].find(element => element.getAttribute('aria-label') === target.slice(7));
        if (!card) return undefined;
        const rect = card.getBoundingClientRect(), zoom = rect.width / card.offsetWidth;
        return { left: rect.left + 5 * zoom, top: rect.top + 31 * zoom, right: rect.left + 25 * zoom, bottom: rect.top + 51 * zoom };
      }
      if (target.startsWith('port:')) {
        const port = [...document.querySelectorAll('.node-workspace-port')].find(element => /^(Input|Output) /.test(element.getAttribute('aria-label') ?? '')
          && element.getAttribute('aria-label').replace(/^(Input|Output) /, '').startsWith(`${target.slice(5)}:`));
        return port && box(port);
      }
      return undefined;
    };
    return { crop, marks: marks.map(mark => { const target = typeof mark === 'string' ? mark : mark.target; return find(target) ?? { missing: target }; }),
      text: [...document.querySelectorAll('.node-workspace-node[aria-label]')].map(element => element.getAttribute('aria-label')).join(', ').slice(0, 300) };
  }
  const header = document.querySelector('.effect-header');
  let panel = header;
  while (panel.parentElement && panel.parentElement.getBoundingClientRect().width < window.innerWidth * 0.45) panel = panel.parentElement;
  const card = header.parentElement;
  const panelBox = box(panel), cardBox = box(card);
  const canvas = [...document.querySelectorAll('canvas')].map(element => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.right <= panelBox.left + 2).sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
  const find = target => {
    if (target.startsWith('preview:')) {
      const [x, y] = target.slice(8).split(',').map(Number), rect = canvas.rect;
      const px = rect.left + x * rect.width, py = rect.top + y * rect.height;
      return { left: px, right: px, top: py, bottom: py };
    }
    if (target.startsWith('tab:')) {
      const name = target.slice(4);
      const tab = [...panel.querySelectorAll('button, [role=tab]')].find(element => element.textContent.trim().startsWith(name));
      return tab && box(tab);
    }
    if (target === 'bypass') return card.querySelector('.effect-bypass-btn');
    if (target === 'remove') return card.querySelector('.btn-danger');
    if (target === 'add') {
      const bar = [...panel.querySelectorAll('button, summary, [role=button]')].find(element => element.textContent.includes('Add Effect'));
      const label = bar && [...bar.querySelectorAll('*'), bar].find(element => element.children.length === 0 && element.textContent.includes('Add Effect'));
      return label && textBox(label);
    }
    // A parameter: the label text of its row.
    const label = [...card.querySelectorAll('*')].find(element => element.children.length === 0 && !header.contains(element)
      && element.textContent.trim() === target);
    return label && textBox(label);
  };
  // `tabs`: from the row of Properties sub-tabs (Transform, Color, Effects, …), below the dock tabs.
  const tabRow = top === 'tabs' ? [...panel.querySelectorAll('button, [role=tab]')].find(element => element.textContent.trim().startsWith('Effects'))?.parentElement : undefined;
  const cropTop = top === 'card' ? cardBox.top - 8 : tabRow ? tabRow.getBoundingClientRect().top : panelBox.top;
  // A card taller than the panel scrolls inside it: the picture ends at the panel, not in the timeline below.
  const crop = { left: Math.max(0, panelBox.left - preview), top: Math.max(0, cropTop), right: panelBox.right,
    bottom: Math.min(window.innerHeight, panelBox.bottom, cardBox.bottom + 12) };
  return { crop, marks: marks.map(mark => {
    const target = typeof mark === 'string' ? mark : mark.target;
    const found = find(target);
    if (!found) return { missing: target };
    if (!(found instanceof Element)) return found;
    // A parameter label is right-aligned in a wide cell: point at its text, not at the empty cell.
    const special = /^(preview:|tab:)/.test(target) || ['bypass', 'remove', 'add'].includes(target);
    if (special || found.children.length) return box(found);
    const range = document.createRange(); range.selectNodeContents(found);
    const text = range.getBoundingClientRect();
    return text.width ? { left: text.left, top: text.top, right: text.right, bottom: text.bottom } : box(found);
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
  viewport = shot.viewport ?? defaultViewport;
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
    if (shot.view === 'nodes') await openNodes(page, shot);
    const { crop, marks, text } = await page.evaluate(measure, { preview: shot.preview ?? 380, top: shot.top ?? 'panel', marks: shot.marks ?? [], view: shot.view ?? 'inspector' });
    const missing = marks.filter(mark => mark.missing).map(mark => mark.missing);
    if (missing.length) {
      await page.screenshot({ path: path.join(out, `${shot.name}.missing.png`) }).catch(() => {});
      throw new Error(`${shot.name}: no control found for ${missing.join(', ')}; the page reads "${text}" (screenshot: ${shot.name}.missing.png)`);
    }
    // Callouts keep their full arrows: the crop grows where a number would sit outside it.
    const marked = (shot.marks ?? []).map(mark => typeof mark === 'string' ? { target: mark } : mark);
    if (marked.length) Object.assign(crop, cropWithCallouts({ layout: shot.layout ?? 'full', crop, boxes: marks, marks: marked,
      bounds: { left: 0, top: 0, right: viewport.width, bottom: viewport.height } }));
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
