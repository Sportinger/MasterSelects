// Docs picture: a tab bar's + menu with its Editing group open, for docs/Features/UI-Panels.md
// (assets/ui-panels/add-panel-menu.webp). Needs a running editor (Vite dev server, default
// http://localhost:5173): it makes a new project, opens the + of the Preview tab bar and hovers Editing.
//   node scripts/ui-shots/add-panel-menu.mjs [--base http://localhost:5204] [--out <file.webp>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { encodeDocShotWebp } from '../docShotWebp.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const base = arg('--base', 'http://localhost:5173');
const out = path.resolve(repoRoot, arg('--out', 'docs/Features/assets/ui-panels/add-panel-menu.webp'));

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--window-size=1400,1000'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`${base}/editor`);
  await page.getByRole('button', { name: /New project/ }).click({ timeout: 60000 });
  await page.locator('form input').first().fill('Add panel menu');
  await page.getByRole('button', { name: 'Continue' }).click();
  for (let i = 0; i < 20 && await page.locator('.editor-project-backdrop').count(); i += 1) await page.waitForTimeout(1000);
  // Without the local API the setup dialog can stay up; the editor behind it works.
  await page.addStyleTag({ content: '.editor-project-backdrop, .editor-project-dialog { display: none !important; }' });
  await page.getByRole('button', { name: 'End walkthrough' }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // The + of the Preview tab bar (the second tab bar from the left).
  const plus = page.locator('[role=tab][title="Preview"]').first().locator('xpath=ancestor::*[.//button[contains(@class, "dock-tab-add")]][1]').locator('button[class*="dock-tab-add"]').first();
  await plus.click();
  await page.waitForTimeout(500);
  await page.locator('.dock-tab-add-menu-submenu-trigger').filter({ hasText: 'Editing' }).first().hover();
  await page.waitForTimeout(700);
  const box = await page.evaluate(() => {
    const parts = [...document.querySelectorAll('.dock-tab-add-menu, .dock-tab-add-submenu')].filter((element) => element.getBoundingClientRect().width > 0);
    const plusButton = document.querySelector('button[class*="dock-tab-add"]:focus, button[class*="dock-tab-add"][aria-expanded="true"]');
    const boxes = [...parts, plusButton].filter(Boolean).map((element) => element.getBoundingClientRect());
    return { left: Math.min(...boxes.map((b) => b.left)), top: Math.min(...boxes.map((b) => b.top)),
      right: Math.max(...boxes.map((b) => b.right)), bottom: Math.max(...boxes.map((b) => b.bottom)) };
  });
  const pad = 12;
  // The left edge stays tight: the Preview toolbar's Raster button sits just beside the menu.
  const clip = { x: box.left - 2, y: box.top - pad - 28, width: box.right - box.left + 2 + pad, height: box.bottom - box.top + 2 * pad + 28 };
  const png = await page.screenshot({ clip });
  const webp = await encodeDocShotWebp(page, png, { maxBytes: 80000, maxPixelWidth: 1600 });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, webp.buffer);
  console.log(`${path.relative(repoRoot, out)} ${webp.width}x${webp.height} ${webp.size} bytes`);
} finally {
  await browser.close();
}
