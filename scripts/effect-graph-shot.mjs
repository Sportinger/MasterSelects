// Effect graph shots: renders an effect's real default node graph on the Node Workspace canvas
// (?test=effect-graph) in hardware-GPU Chrome and writes a WebP for the docs.
//
//   node scripts/effect-graph-shot.mjs gaussian-blur box-blur
//   node scripts/effect-graph-shot.mjs 'gaussian-blur?focus=horizontal-pass-premultiplied@gaussian-blur-horizontal-pass'
//       [--url http://localhost:5176] [--out docs/Features/assets/effects/graphs]
//       [--width 800] [--max-height 900] [--scale 2] [--max-bytes 200000] [--list]
//
// A shot is `<effect>[?query][@name]`. The query takes the test page parameters:
//   level=stages|all   folded stage folders (default, as when an effect is opened) or everything open
//   open=a,b           open these folders too (label slug, `parent/child` path or group id)
//   focus=folder       only the contents of this folder
//   rows=n             split a focused folder's flow into n rows (default: landscape fit)
//   chain=1            keep the clip chain (source, transform, output) around the effect
// The file is `<out>/<name or effect>.webp`. `--list` prints every shot's folders instead.
//
// The page is laid out `--width` CSS pixels wide (smaller for tall graphs) and captured at
// `--scale` device pixels per CSS pixel, so a full-width docs column shows the canvas at about
// its overview size: card titles use the canvas' enlarged overview lettering and stay legible.
// Needs a running Vite of this checkout (`npx vite --port 5176 --strictPort`).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { encodeDocShotWebp } from './docShotWebp.mjs';

const args = process.argv.slice(2);
const valueOptions = new Set(['--url', '--out', '--width', '--max-height', '--scale', '--max-bytes']);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const shots = args.filter((arg, index) => !arg.startsWith('--') && !valueOptions.has(args[index - 1]));
if (!shots.length) throw new Error('Name at least one shot, e.g. gaussian-blur or "gaussian-blur?focus=vertical-pass@gaussian-vertical".');
const url = option('--url', 'http://localhost:5176').replace(/\/$/, '');
const out = path.resolve(option('--out', 'docs/Features/assets/effects/graphs'));
const cssWidth = Number(option('--width', '800'));
const maxCssHeight = Number(option('--max-height', '900'));
const scale = Number(option('--scale', '2'));
const maxBytes = Number(option('--max-bytes', '200000'));
const maxPixelWidth = 1600;
// The canvas fit margin on both sides (FIT_MARGIN in canvasGeometry.ts).
const margin = 2 * 42;

const parseShot = (spec) => {
  const [target, name] = spec.split('@');
  const [effect, query = ''] = target.split('?');
  return { effect, query, name: name || effect };
};

const launchArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,VulkanFromANGLE', '--use-angle=vulkan',
  '--ignore-gpu-blocklist', '--window-position=0,0'];
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: launchArgs });
const results = [];
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
      results.push({ shot: spec, title: state.title, nodes: state.nodes, bounds: state.bounds, folders: state.folders.map(folder => `${folder.path}${folder.collapsed ? '' : ' (open)'}`) });
      continue;
    }
    // Fit by width, unless the graph is tall: then the height decides and the page narrows.
    const { width, height } = state.bounds;
    const zoom = Math.min((cssWidth - margin) / width, (maxCssHeight - margin) / height);
    const viewport = { width: Math.min(cssWidth, Math.ceil(width * zoom + margin)), height: Math.ceil(height * zoom + margin) };
    await page.setViewportSize(viewport);
    // The worker canvas reports readiness on the canvas element; cards, cables and the flow
    // layout settle in the following frames. Then the canvas' own Fit frames the settled graph.
    await page.waitForSelector('.node-workspace-canvas.canvas-rendered', { timeout: 20000 })
      .catch(() => errors.push('Canvas renderer did not report ready; the DOM fallback is captured.'));
    await page.waitForTimeout(2000);
    await page.evaluate(() => [...document.querySelectorAll('.node-workspace-toolbar button')].find(button => button.textContent === 'Fit')?.click());
    await page.waitForTimeout(1200);
    // Crop the fit margin down to a slim border of canvas grid around the frame and cards.
    const clip = await page.evaluate(({ pad, viewport }) => {
      const rects = [...document.querySelectorAll('.node-workspace-canvas-inner .node-workspace-group, .node-workspace-canvas-inner .node-workspace-node')]
        .map(element => element.getBoundingClientRect()).filter(rect => rect.width && rect.height);
      if (!rects.length) return undefined;
      const left = Math.max(0, Math.floor(Math.min(...rects.map(rect => rect.left)) - pad));
      const top = Math.max(0, Math.floor(Math.min(...rects.map(rect => rect.top)) - pad));
      const right = Math.min(viewport.width, Math.ceil(Math.max(...rects.map(rect => rect.right)) + pad));
      const bottom = Math.min(viewport.height, Math.ceil(Math.max(...rects.map(rect => rect.bottom)) + pad));
      return { x: left, y: top, width: right - left, height: bottom - top };
    }, { pad: 18, viewport });
    const png = await page.screenshot({ type: 'png', ...(clip ? { clip } : {}) });
    const encoded = await encodeDocShotWebp(page, png, { maxBytes, maxPixelWidth })
      .catch(error => { throw new Error(`${shot.name}: ${error.message} Use focus/open or --max-bytes.`); });
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, `${shot.name}.webp`);
    fs.writeFileSync(file, encoded.buffer);
    results.push({ shot: spec, file: path.relative(process.cwd(), file), nodes: state.nodes, zoom: Math.round(zoom * 100) / 100,
      pixels: `${encoded.width}x${encoded.height}`, bytes: encoded.size, quality: encoded.quality });
  }
  console.log(JSON.stringify({ results, errors: [...new Set(errors)] }, null, 1));
} finally {
  await browser.close();
}
