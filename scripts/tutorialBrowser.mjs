// Shared by tutorial-video.mjs and tutorial-tab.mjs: the browser a tutorial is recorded in. Either a
// fresh hardware-GPU Chrome with its own profile (default), or the user's running Chrome, reached
// over its DevTools port (chrome://inspect/#remote-debugging writes DevToolsActivePort into the
// profile; Chrome asks the user to allow each new connection). There the recording gets one tab of
// its own (reused by later runs, never closed) and an emulated viewport, so the user's window size
// does not matter; the user's other tabs stay untouched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const launchArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,VulkanFromANGLE', '--use-angle=vulkan',
  '--ignore-gpu-blocklist', '--window-position=0,0', '--autoplay-policy=no-user-gesture-required'];
const TAB_NAME = 'masterselects-tutorial-recorder';

/** The browser context of the user's running Chrome (one connection, one approval in Chrome). */
export async function connectChrome(profile = path.join(os.homedir(), '.config', 'google-chrome')) {
  const file = path.join(profile, 'DevToolsActivePort');
  if (!fs.existsSync(file)) throw new Error(`No ${file}: enable remote debugging in chrome://inspect/#remote-debugging`);
  const [port, browserPath] = fs.readFileSync(file, 'utf8').trim().split('\n');
  const browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${browserPath}`, { timeout: 60000 });
  return browser.contexts()[0];
}

/**
 * The recording tab in the user's Chrome: the one an earlier run left open (marked by window.name),
 * else a new one, at `viewport` CSS px and `scale` device pixels per CSS px.
 * Returns { page, context, emulate, done }: done() clears the emulation and leaves the tab open.
 */
export async function recorderTab(context, { viewport, scale = 2 }) {
  let page;
  for (const candidate of context.pages()) {
    if (await candidate.evaluate(name => window.name === name, TAB_NAME).catch(() => false)) { page = candidate; break; }
  }
  page ??= await context.newPage();
  await page.bringToFront();
  const cdp = await context.newCDPSession(page);
  const override = () => cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: scale, mobile: false });
  const mark = () => page.evaluate(name => { window.name = name; }, TAB_NAME).catch(() => {});
  // A navigation drops the override (Playwright restores its own viewport-less emulation), and Chrome
  // clears window.name on a cross-site navigation, so every new document gets both again.
  const onLoad = () => { override().catch(() => {}); mark(); };
  page.on('domcontentloaded', onLoad);
  await override();
  await mark();
  return {
    page, context,
    /** Applies the viewport again and checks it took. */
    emulate: async () => {
      // A page that is still settling after a project switch can report its own size for a few seconds.
      let size;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await override();
        size = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]).catch(() => null);
        if (size?.[0] === viewport.width && size[1] === viewport.height && size[2] === scale) return;
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      throw new Error(`The tab keeps its own viewport (${size?.join('×') ?? 'unreadable'}) instead of ${viewport.width}×${viewport.height} @${scale}x`);
    },
    done: async () => {
      page.off('domcontentloaded', onLoad);
      await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await cdp.detach().catch(() => {});
    },
  };
}

/**
 * A page to record in. chrome: a context from connectChrome (the user's Chrome), or "attach" to
 * connect for this run only; without it a fresh Chrome is launched.
 * Returns { page, context, emulate?, done }: done() closes a launched browser or releases the tab.
 */
export async function tutorialPage({ viewport, scale = 2, chrome }) {
  if (chrome) return recorderTab(chrome === 'attach' ? await connectChrome() : chrome, { viewport, scale });
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: [...launchArgs, `--window-size=${viewport.width},${viewport.height + 120}`] });
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, acceptDownloads: true });
  return { page: await context.newPage(), context, done: () => browser.close() };
}
