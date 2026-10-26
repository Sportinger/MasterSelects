// Shared by tutorial-video.mjs and tutorial-tab.mjs: the browser a tutorial is recorded in.
//
// Default: a headless Chrome with the hardware GPU at 2560×1440 CSS px and scale 1, so the screencast
// delivers real 2560×1440 frames (a visible window cannot be larger than the monitor, and an emulated
// device scale does not raise the screencast size). Its profile is a folder of the take, usually a copy
// of a checkpoint (scripts/tutorialCheckpoint.mjs). Nothing appears on the desktop, the real mouse cannot
// cross it, and Chrome asks for no permission.
//
// --attach: the user's running Chrome instead, reached over its DevTools port
// (chrome://inspect/#remote-debugging writes DevToolsActivePort into the profile; Chrome asks the user to
// allow each new connection). There the recording gets one tab of its own (reused by later runs, never
// closed) and an emulated viewport; its screencast stays at the window's own size (1280×720 on a 1440p
// monitor), so it is for trying things, not for takes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

// Headless Chrome finds no WebGPU adapter without Vulkan through ANGLE; --disable-vulkan-surface lets
// Vulkan run without a window surface (measured on Roman's AMD RDNA 3: hardware WebGPU, 26 fps screencast
// at 2560×1440 with the whole page repainting).
const headlessArgs = ['--headless=new', '--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface',
  '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'];
const TAB_NAME = 'masterselects-tutorial-recorder';

export const DEFAULT_VIEWPORT = { width: 2560, height: 1440 };

/**
 * A headless Chrome on `profile` (a folder; created when missing) at `viewport` CSS px, scale 1.
 * Returns { page, context, done }: done() closes Chrome, which also flushes the profile to disk. Call warmGpu
 * before the editor loads.
 */
export async function launchTutorialChrome({ profile, viewport = DEFAULT_VIEWPORT }) {
  fs.mkdirSync(profile, { recursive: true });
  // A Chrome that crashed leaves its lock behind, and the next launch on that profile then fails.
  for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(path.join(profile, lock), { force: true });
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome', headless: false, args: [...headlessArgs, `--window-size=${viewport.width},${viewport.height}`],
    viewport, deviceScaleFactor: 1, acceptDownloads: true,
  });
  const page = context.pages()[0] ?? await context.newPage();
  return { page, context, headless: true, done: () => context.close() };
}

/**
 * Waits until the headless Chrome's GPU answers and returns the WebGPU adapter's name. Right after the
 * launch, requestAdapter() answers null for about a second, and an editor that asked then would start
 * without WebGPU; so this asks from a small page of the editor's origin (WebGPU needs a secure context)
 * before the editor loads.
 */
export async function warmGpu(page, origin) {
  await page.goto(`${origin}/favicon.png`);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const adapter = await page.evaluate(async () => {
      const found = await navigator.gpu?.requestAdapter();
      return found ? [found.info.vendor, found.info.architecture, found.info.description].filter(Boolean).join(' ') || 'unnamed adapter' : null;
    });
    if (adapter) return adapter;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Headless Chrome found no WebGPU adapter in 15 s: check the Vulkan flags in scripts/tutorialBrowser.mjs');
}

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
 * connect for this run only; without it a headless Chrome is launched on `profile`.
 * Returns { page, context, emulate?, done }: done() closes a launched browser or releases the tab.
 */
export async function tutorialPage({ viewport, scale = 1, chrome, profile }) {
  if (chrome) return recorderTab(chrome === 'attach' ? await connectChrome() : chrome, { viewport, scale });
  if (scale !== 1) console.warn(`scale ${scale} ignored: the headless Chrome records at its real size, scale 1`);
  return launchTutorialChrome({ profile, viewport });
}
