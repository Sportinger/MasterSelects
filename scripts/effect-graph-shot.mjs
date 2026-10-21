// Effect graph shots: renders an effect's real default node graph on the Node Workspace canvas
// (?test=effect-graph) in hardware-GPU Chrome and writes a WebP for the docs.
//
//   node scripts/effect-graph-shot.mjs --manifest scripts/effect-graph-shots/blur.json   # a docs page's shots
//   node scripts/effect-graph-shot.mjs gaussian-blur box-blur
//   node scripts/effect-graph-shot.mjs 'gaussian-blur?focus=horizontal-pass-premultiplied@gaussian-blur-horizontal-pass'
//       [--url http://localhost:5176] [--out docs/Features/assets/effects/graphs]
//       [--width 800] [--max-height 900] [--scale 2] [--max-bytes 200000] [--list]
//
// A shot is `<effect>[?query][@name]`. The query takes the test page parameters:
//   level=stages|all   folded stage folders (default, as when an effect is opened) or everything open
//   open=a,b           open these folders too (label slug, `parent/child` path or group id)
//   focus=folder       only the contents of this folder; values from outside become named stub
//                      cards (Constants excepted)
//   rows=n             split a focused folder's flow into n rows (default: landscape fit)
//   break=a,b          start a new row at these node ids instead (keeps short cables)
//   only=a,b           with focus: just these nodes (local ids, see --list), laid out compactly;
//                      their other inputs become named stubs (a recipe, not the whole folder),
//                      the literal values they read from Constants become value cards, and the
//                      folder's own unpicked number cards (limits such as 0 and 1) are left out
//                      (without focus: picked from the whole effect, for effects without folders)
//   name.<id>=Label    with only: picture name of the stub fed by node <id> (or <id>:<port>, as the
//                      error for an unknown id lists them), e.g. name.smooth-or-banded=Time map
//   constants=hide     with only: leave those literal values cut instead
//   plumbing=hide      leave out the Constants and Coordinates & Resources folders and their
//                      cables (overview pictures: the stages read as one path, laid out afresh
//                      so no cable runs behind a stage it does not belong to)
//   omit=a,b           leave out these cards and their cables (local ids), e.g. omit=output: an
//                      overview ends at the stage that hands the image back
//                      (in a recipe also stubs, as <id>:<port>, before the layout: no gap)
//   chain=1            keep the clip chain (source, transform, output) around the effect
//   cables=avoid       route cables around cards (the Node Workspace's Avoid), so no cable runs
//                      behind a card; use it whenever a wrapped row or a stub hides a cable
// (a composition's `@` id may be given without its `@`) and two picture options:
// marks=id[:from][:reach],...  numbered callouts on these node cards (from = left|right|above|below,
// reach = arrow length in overlay units, default 84), printed with the figure markup; the crop
// grows into the canvas margin so every arrow keeps its length; layout=full|float sizes the callouts.
// The file is `<out>/<name or effect>.webp`. `--list` prints every shot's folders and node ids instead.
//
// Two checks keep pictures readable. A cable that runs through a card other than its own two ends
// looks like a connection of that card: the shot fails (crossings=allow lets an overview of the
// editor's own layout pass with a warning). Card titles must show at least 11 px at the docs width
// of their layout (720 px full, 418 px float): smaller shots print a warning with the size.
//
// The page is laid out `--width` CSS pixels wide (smaller for tall graphs) and captured at
// `--scale` device pixels per CSS pixel, so a full-width docs column shows the canvas at about
// its overview size: card titles use the canvas' enlarged overview lettering and stay legible.
// Needs a running Vite of this checkout (`npx vite --port 5176 --strictPort`).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { encodeDocShotWebp } from './docShotWebp.mjs';
import { calloutOverlay, cropWithCallouts, docsFigure } from './docShotFigure.mjs';

const args = process.argv.slice(2);
const valueOptions = new Set(['--url', '--out', '--width', '--max-height', '--scale', '--max-bytes', '--manifest']);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
// A manifest keeps a page's shots reproducible: `{ "shots": ["<effect>?<query>@<name>", ...] }`.
const manifest = option('--manifest');
const shots = [...manifest ? JSON.parse(fs.readFileSync(manifest, 'utf8')).shots : [],
  ...args.filter((arg, index) => !arg.startsWith('--') && !valueOptions.has(args[index - 1]))];
if (!shots.length) throw new Error('Name at least one shot, e.g. gaussian-blur or "gaussian-blur?focus=vertical-pass@gaussian-vertical".');
const url = option('--url', 'http://localhost:5176').replace(/\/$/, '');
const out = path.resolve(option('--out', 'docs/Features/assets/effects/graphs'));
const cssWidth = Number(option('--width', '800'));
const maxCssHeight = Number(option('--max-height', '900'));
const scale = Number(option('--scale', '2'));
const maxBytes = Number(option('--max-bytes', '200000'));
const maxPixelWidth = 1600;
// Docs column widths per layout and the smallest legible card title there (CSS px).
const DISPLAY_WIDTH = { full: 720, float: 418 };
const MIN_TITLE_PX = 11;
// The canvas fit margin on both sides (FIT_MARGIN in canvasGeometry.ts).
const margin = 2 * 42;

const parseShot = (spec) => {
  const [target, name] = spec.split('@');
  const [effect, query = ''] = target.split('?');
  const params = new URLSearchParams(query);
  // `id[:from][:reach]`; stub ids contain a colon themselves (`wave-uv-split:y`), so read from the end.
  const marks = (params.get('marks') ?? '').split(',').filter(Boolean).map(item => {
    const parts = item.split(':');
    const reach = /^\d+$/.test(parts.at(-1)) && parts.length > 1 ? Number(parts.pop()) : undefined;
    const from = ['left', 'right', 'above', 'below'].includes(parts.at(-1)) && parts.length > 1 ? parts.pop() : 'left';
    return { id: parts.join(':'), from, ...(reach !== undefined ? { reach } : {}) };
  });
  const layout = params.get('layout') ?? 'full';
  if (!DISPLAY_WIDTH[layout]) throw new Error(`${spec}: layout must be full or float.`);
  const allowCrossings = params.get('crossings') === 'allow';
  params.delete('marks'); params.delete('layout'); params.delete('crossings');
  return { effect, query: params.toString(), name: name || effect, marks, layout, allowCrossings };
};

const launchArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,VulkanFromANGLE', '--use-angle=vulkan',
  '--ignore-gpu-blocklist', '--window-position=0,0'];
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: launchArgs });
const results = [], failures = [];
try {
  const context = await browser.newContext({ deviceScaleFactor: scale, viewport: { width: cssWidth, height: 600 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // The page runs without the local API and agent bridge; their connection errors are noise here.
  const noise = /Failed to load resource|WebSocket connection to/;
  page.on('console', message => { if (message.type() === 'error' && !noise.test(message.text())) errors.push(message.text().slice(0, 300)); });
  const open = async (shot) => {
    await page.goto(`${url}/?test=effect-graph&effect=${encodeURIComponent(shot.effect)}${shot.query ? `&${shot.query}` : ''}`);
    await page.waitForFunction(() => window.__effectGraphDoc?.ready, null, { timeout: 120000 });
    const state = await page.evaluate(() => window.__effectGraphDoc);
    if (state.error) throw new Error(`${shot.effect}: ${state.error}`);
    return state;
  };
  for (const spec of shots) {
    const shot = parseShot(spec);
    const state = await open(shot);
    if (args.includes('--list')) {
      results.push({ shot: spec, title: state.title, nodes: state.nodes, bounds: state.bounds,
        folders: state.folders.map(folder => `${folder.path}${folder.collapsed ? '' : ' (open)'}`), cards: state.cards });
      continue;
    }
    // Fit by width, unless the graph is tall: then the height decides and the page narrows.
    // Cables that bend out past the cards get room on both sides of one axis: the canvas' Fit
    // centres the graph and keeps the zoom set by the other, tight axis.
    const calloutRoom = shot.marks.some(mark => mark.from === 'above' || mark.from === 'below') ? 120 : 0;
    const frame = async (pageWidth) => {
      const { width, height } = state.bounds;
      const bend = state.overhang ?? { left: 0, top: 0, right: 0, bottom: 0 };
      const extraX = 2 * Math.max(bend.left, bend.right), extraY = extraX ? 0 : 2 * Math.max(bend.top, bend.bottom);
      const zoom = Math.min((pageWidth - margin) / (width + extraX), (maxCssHeight - margin) / (height + extraY));
      // Callouts above or below cards get spare canvas above and below the graph: the Fit is set by
      // the width, so the graph stays the same size and the crop can grow into the room.
      const viewport = { width: Math.ceil((width + extraX) * zoom + margin), height: Math.ceil((height + extraY) * zoom + margin) + calloutRoom };
      await page.setViewportSize(viewport);
      // The worker canvas reports readiness on the canvas element; cards, cables and the flow
      // layout settle in the following frames. Then the canvas' own Fit frames the settled graph.
      await page.waitForSelector('.node-workspace-canvas.canvas-rendered', { timeout: 20000 })
        .catch(() => errors.push('Canvas renderer did not report ready; the DOM fallback is captured.'));
      await page.waitForTimeout(2000);
      await page.evaluate(() => [...document.querySelectorAll('.node-workspace-toolbar button')].find(button => button.textContent === 'Fit')?.click());
      await page.waitForTimeout(1200);
      // Crop the fit margin down to a slim border of canvas grid around the frame, the cards and
      // the cables that bend out past them (a wrapped row's last cable turns back outside).
      const clip = await page.evaluate(({ pad, viewport, bounds, overhang }) => {
        const rects = [...document.querySelectorAll('.node-workspace-canvas-inner .node-workspace-group, .node-workspace-canvas-inner .node-workspace-node')]
          .map(element => element.getBoundingClientRect()).filter(rect => rect.width && rect.height);
        if (!rects.length) return undefined;
        const box = { left: Math.min(...rects.map(rect => rect.left)), top: Math.min(...rects.map(rect => rect.top)),
          right: Math.max(...rects.map(rect => rect.right)), bottom: Math.max(...rects.map(rect => rect.bottom)) };
        const scale = (box.right - box.left) / Math.max(1, bounds.width), bend = overhang ?? { left: 0, top: 0, right: 0, bottom: 0 };
        const left = Math.max(0, Math.floor(box.left - bend.left * scale - pad));
        const top = Math.max(0, Math.floor(box.top - bend.top * scale - pad));
        const right = Math.min(viewport.width, Math.ceil(box.right + bend.right * scale + pad));
        const bottom = Math.min(viewport.height, Math.ceil(box.bottom + bend.bottom * scale + pad));
        return { x: left, y: top, width: right - left, height: bottom - top };
      }, { pad: 18, viewport, bounds: state.bounds, overhang: state.overhang });
      // The title size a reader sees: painted size × zoom, scaled from the crop to the docs width
      // (the picture is at least that wide in device pixels, so it always fills the column).
      const title = await page.evaluate(() => window.__effectGraphDocTitle?.());
      const cropWidth = clip ? clip.width : viewport.width;
      const titlePx = title ? Math.round(title.titleSize * title.zoom * DISPLAY_WIDTH[shot.layout] / cropWidth * 10) / 10 : undefined;
      return { pageWidth, zoom, viewport, clip, titlePx };
    };
    // A narrower page lowers the zoom; the canvas then letters titles larger relative to the cards,
    // and the picture is shown at the docs width. Narrow until titles reach the minimum.
    const base = Math.round(cssWidth * DISPLAY_WIDTH[shot.layout] / DISPLAY_WIDTH.full);
    let framed = await frame(base), last = framed;
    for (const share of [0.9, 0.8, 0.7]) {
      if (framed.titlePx === undefined || framed.titlePx >= MIN_TITLE_PX) break;
      last = await frame(Math.round(base * share));
      if ((last.titlePx ?? 0) > framed.titlePx) framed = last;
    }
    if (last !== framed) framed = await frame(framed.pageWidth);
    const { zoom, viewport, clip, titlePx } = framed;
    const boxes = await page.evaluate(ids => ids.map(id => {
      // Effect node ids are scoped (`clip-graph:…/taper`): a mark names the local id.
      const card = [...document.querySelectorAll('.node-workspace-node[data-node-id]')]
        .find(element => [id, `@${id}`].some(local => element.dataset.nodeId === local || element.dataset.nodeId.endsWith(`/${local}`)));
      if (!card) return { missing: id };
      const rect = card.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }), shot.marks.map(mark => mark.id));
    const missing = boxes.filter(box => box.missing).map(box => box.missing);
    if (missing.length) throw new Error(`${shot.name}: no node card ${missing.join(', ')} (use --list for the ids)`);
    // Callouts keep their full arrows: the crop grows into the canvas margin where they need room.
    if (clip && shot.marks.length) {
      const grown = cropWithCallouts({ layout: shot.layout, crop: { left: clip.x, top: clip.y, right: clip.x + clip.width, bottom: clip.y + clip.height },
        boxes, marks: shot.marks, bounds: { left: 0, top: 0, right: viewport.width, bottom: viewport.height } });
      Object.assign(clip, { x: grown.left, y: grown.top, width: grown.right - grown.left, height: grown.bottom - grown.top });
    }
    const warnings = [];
    if (state.crossings?.length) {
      const message = `${shot.name}: cables run through other cards: ${state.crossings.join('; ')}`;
      if (!shot.allowCrossings) { failures.push(message); continue; }
      warnings.push(message);
    }
    if (titlePx !== undefined && titlePx < MIN_TITLE_PX) warnings.push(`${shot.name}: card titles show at ${titlePx} px in a ${DISPLAY_WIDTH[shot.layout]} px `
      + `${shot.layout} figure (at least ${MIN_TITLE_PX}): pick fewer nodes, use rows/break, or a full-width layout.`);
    const png = await page.screenshot({ type: 'png', ...(clip ? { clip } : {}) });
    const encoded = await encodeDocShotWebp(page, png, { maxBytes, maxPixelWidth })
      .catch(error => { throw new Error(`${shot.name}: ${error.message} Use focus/open or --max-bytes.`); });
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, `${shot.name}.webp`);
    fs.writeFileSync(file, encoded.buffer);
    const crop = clip ? { left: clip.x, top: clip.y, right: clip.x + clip.width, bottom: clip.y + clip.height }
      : { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
    const figure = docsFigure({ file, alt: state.title, caption: shot.marks.map((mark, index) => `${index + 1} — ${mark.id}.`).join(' ') || state.title,
      svg: shot.marks.length ? calloutOverlay({ name: shot.name, layout: shot.layout, crop, boxes, marks: shot.marks }) : '',
      classes: 'docs-shot--graph' });
    results.push({ shot: spec, file: path.relative(process.cwd(), file), nodes: state.nodes, zoom: Math.round(zoom * 100) / 100, titlePx,
      pixels: `${encoded.width}x${encoded.height}`, bytes: encoded.size, quality: encoded.quality, ...(shot.marks.length ? { figure } : {}),
      ...(warnings.length ? { warnings } : {}), ...(state.displaced?.length ? { displaced: state.displaced } : {}) });
  }
  console.log(JSON.stringify({ results, failures, errors: [...new Set(errors)] }, null, 1));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
