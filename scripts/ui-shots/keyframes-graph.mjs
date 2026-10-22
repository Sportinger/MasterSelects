// Docs picture: the timeline in Graph mode for docs/Features/Keyframes.md (assets/keyframes/graph-mode.webp).
// Needs a running editor (Vite dev server, default http://localhost:5173): it makes a new project, adds a
// 6 s solid, gives its Position X four Bezier keys and Position Y two, selects the second X key (its
// handles show), zooms the 6 s across a 1200 px window (2x pixels, saved at the 1600 px docs budget), switches the timeline to Graph mode and crops the timeline area.
//   node scripts/ui-shots/keyframes-graph.mjs [--base http://localhost:5204] [--out <file.webp>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { encodeDocShotWebp } from '../docShotWebp.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const base = arg('--base', 'http://localhost:5173');
const out = path.resolve(repoRoot, arg('--out', 'docs/Features/assets/keyframes/graph-mode.webp'));

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--window-size=1200,1000'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`${base}/editor`);
  await page.getByRole('button', { name: /New project/ }).click({ timeout: 60000 });
  await page.locator('form input').first().fill('Keyframes graph');
  await page.getByRole('button', { name: 'Continue' }).click();
  for (let i = 0; i < 20 && await page.locator('.editor-project-backdrop').count(); i += 1) await page.waitForTimeout(1000);
  // Without the local API the setup dialog can stay up; the editor behind it works.
  await page.addStyleTag({ content: '.editor-project-backdrop, .editor-project-dialog { display: none !important; }' });
  await page.getByRole('button', { name: 'End walkthrough' }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/stores/timeline/index.ts');
    const state = useTimelineStore.getState();
    const track = state.tracks.find((candidate) => candidate.type === 'video');
    const clipId = state.addSolidClip(track.id, 0, '#c9873a', 6);
    const key = (id, property, time, value, extra) => ({ id, clipId, time, property, value, easing: 'bezier', ...extra });
    const keys = [
      key('kf-x1', 'position.x', 0.4, -0.36, { handleOut: { x: 0.85, y: 0.26 } }),
      key('kf-x2', 'position.x', 2.4, 0.42, { handleIn: { x: -0.7, y: -0.28 }, handleOut: { x: 0.95, y: -0.26 } }),
      key('kf-x3', 'position.x', 4.2, -0.16, { handleIn: { x: -0.6, y: 0.22 }, handleOut: { x: 0.55, y: 0.11 } }),
      key('kf-x4', 'position.x', 5.5, 0.26, { handleIn: { x: -0.5, y: -0.15 } }),
      key('kf-y1', 'position.y', 0.4, 0, {}),
      key('kf-y2', 'position.y', 5.5, -0.2, {}),
    ];
    useTimelineStore.setState((current) => ({ clipKeyframes: new Map(current.clipKeyframes).set(clipId, keys) }));
    const next = useTimelineStore.getState();
    next.selectClip(clipId);
    next.selectKeyframe('kf-x2');
    next.setPlayheadPosition?.(2.4);
    next.setZoom(160); // px per second: the 6 s clip fills the 1200 px timeline
  });
  await page.locator('.timeline-curve-mode-toggle').click();
  await page.waitForTimeout(1200);
  const timeline = await page.locator('.timeline-curve-mode-toggle').boundingBox();
  const top = Math.max(0, Math.round(timeline.y - 12));
  const png = await page.screenshot({ clip: { x: 0, y: top, width: 1200, height: 850 - top } });
  const webp = await encodeDocShotWebp(page, png, { maxBytes: 120000, maxPixelWidth: 1600 }); // the docs width budget;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, webp.buffer);
  console.log(`${path.relative(repoRoot, out)} ${webp.width}x${webp.height} ${webp.size} bytes`);
} finally {
  await browser.close();
}
