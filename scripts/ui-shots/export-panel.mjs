// Docs picture: the Export panel top to bottom for docs/Features/Export.md (assets/export/export-panel.webp),
// with numbered callouts on its sections. Needs a running editor (Vite dev server, default
// http://localhost:5173): it makes a new project, opens the Export tab in a tall window so the whole
// panel fits, and prints the docs <figure> to paste into the page.
//   node scripts/ui-shots/export-panel.mjs [--base http://localhost:5204] [--out <file.webp>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { encodeDocShotWebp } from '../docShotWebp.mjs';
import { calloutOverlay, docsFigure } from '../docShotFigure.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const base = arg('--base', 'http://localhost:5173');
const out = path.resolve(repoRoot, arg('--out', 'docs/Features/assets/export/export-panel.webp'));
// Section header labels in panel order, then the Export button; the numbers match the list on the page.
const TARGETS = ['Presets', 'Output', 'Video', 'Audio', 'Range & Summary', 'Render Quality', 'export-button'];
const GUTTER = 96; // CSS px of plain panel colour left of the panel, where the callout numbers sit

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--window-size=1400,1800'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1660 }, deviceScaleFactor: 2 });
  await page.goto(`${base}/editor`);
  await page.getByRole('button', { name: /New project/ }).click({ timeout: 60000 });
  await page.locator('form input').first().fill('Export panel');
  await page.getByRole('button', { name: 'Continue' }).click();
  for (let i = 0; i < 20 && await page.locator('.editor-project-backdrop').count(); i += 1) await page.waitForTimeout(1000);
  // Without the local API the setup dialog can stay up; the editor behind it works.
  await page.addStyleTag({ content: '.editor-project-backdrop, .editor-project-dialog { display: none !important; }' });
  await page.getByRole('button', { name: 'End walkthrough' }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('[role=tab][title="Export"]').first().click();
  await page.mouse.move(5, 900);
  await page.waitForTimeout(1200);
  const { crop, boxes } = await page.evaluate(({ targets, gutter }) => {
    const panel = document.querySelector('.export-panel');
    const panelBox = panel.getBoundingClientRect();
    const textBox = (element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      const box = range.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    };
    const found = targets.map((target) => {
      if (target === 'export-button') {
        const box = panel.querySelector('.export-quick-submit').getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      }
      const button = [...panel.querySelectorAll('.export-inspector-disclosure')].find((element) => element.textContent.trim() === target);
      const label = button && [...button.querySelectorAll('*'), button].find((element) => element.children.length === 0 && element.textContent.trim() === target);
      if (!label) return null;
      // The arrow ends at the header's left edge, before its chevron and on/off switch.
      return { ...textBox(label), left: button.getBoundingClientRect().left };
    });
    const area = { left: panelBox.left - gutter, top: panelBox.top + 1, right: panelBox.right, bottom: panelBox.bottom };
    let background = 'transparent';
    for (let element = panel; element && /rgba\(0, 0, 0, 0\)|transparent/.test(background); element = element.parentElement) background = getComputedStyle(element).backgroundColor;
    const cover = document.createElement('div');
    Object.assign(cover.style, { position: 'fixed', left: `${area.left}px`, top: `${area.top}px`, width: `${gutter}px`,
      height: `${area.bottom - area.top}px`, background, zIndex: '2147483647', pointerEvents: 'none' });
    document.body.append(cover);
    return { crop: area, boxes: found };
  }, { targets: TARGETS, gutter: GUTTER });
  const missing = TARGETS.filter((_, index) => !boxes[index]);
  if (missing.length) throw new Error(`Not found in the Export panel: ${missing.join(', ')}`);
  const png = await page.screenshot({ clip: { x: crop.left, y: crop.top, width: crop.right - crop.left, height: crop.bottom - crop.top } });
  const webp = await encodeDocShotWebp(page, png, { maxBytes: 120000, maxPixelWidth: 1600 });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, webp.buffer);
  console.log(`${path.relative(repoRoot, out)} ${webp.width}x${webp.height} ${webp.size} bytes\n`);
  const marks = TARGETS.map(() => ({ from: 'left' }));
  // A tall, narrow panel: as a float it would squeeze the list beside it, so it stands alone at detail width.
  console.log(docsFigure({ file: out, alt: 'ALT', caption: 'CAPTION', classes: 'docs-shot--detail',
    svg: calloutOverlay({ name: 'export-panel', layout: 'detail', crop, boxes, marks }) }));
} finally {
  await browser.close();
}
