// Shared by tutorial-video.mjs and tutorial-tab.mjs: the editor a tutorial is made in, open and ready for
// steps. A take and the build server open it the same way, so what an agent checks in the build server is
// what the take records:
//   1. the browser (scripts/tutorialBrowser.mjs): a headless Chrome on a copy of the `from` checkpoint's
//      profile, or on an empty one;
//   2. the project: the checkpoint's project reopens by itself; without a checkpoint a new one is created;
//   3. a checkpoint's playhead, selection, pointer and its `resume` steps;
//   4. steps with a picture after each (runSteps), and the page before and after a step that fails.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Page side, before the editor loads: no folder dialog, and every saved download noted. */
function pageHooks() {
  if (window.__tutorialHooks) return;
  window.__tutorialHooks = true;
  // The bridge lists this editor under a tab id that says it is a take or build server editor, so the cut
  // (tutorial-ms-cut.mjs) finds the visible cut editor without --tab. The editor keeps its tab id here.
  try {
    const key = 'masterselects.aiBridgeTabId';
    if (!sessionStorage.getItem(key)?.startsWith('tutorial-')) sessionStorage.setItem(key, `tutorial-${crypto.randomUUID()}`);
  } catch { /* no sessionStorage: the cut then needs --tab */ }
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(`tutorial-${Date.now()}`, { create: true });
  Object.defineProperty(Navigator.prototype, 'doNotTrack', { configurable: true, get: () => '1' });
  // Scripted mouse moves cannot drive a pointer-locked drag: Chrome then reports each move's distance from
  // the lock point, so a value field jumped tenfold. Without pointer lock the fields drag by clientX.
  Object.defineProperty(Element.prototype, 'requestPointerLock', { configurable: true, value: undefined });
  // The editor saves an export through a download link; Playwright does not always report that
  // download, so the page notes every one itself (name and size of the blob behind the link).
  const blobs = new Map(), createObjectURL = URL.createObjectURL.bind(URL), click = HTMLAnchorElement.prototype.click;
  window.__tutorialDownloads = [];
  URL.createObjectURL = object => { const href = createObjectURL(object); if (object instanceof Blob) blobs.set(href, object.size); return href; };
  HTMLAnchorElement.prototype.click = function tutorialClick() {
    if (this.download) window.__tutorialDownloads.push({ name: this.download, size: blobs.get(this.href) ?? 0 });
    return click.call(this);
  };
}

/** The helper modules, imported fresh for a long-lived caller (the build server), so edits apply at once. */
export async function tutorialModules(fresh = false) {
  const local = name => import(`${pathToFileURL(path.join(import.meta.dirname, name)).href}${fresh ? `?t=${Date.now()}` : ''}`);
  const names = ['docClipPointer.mjs', 'docShotSettings.mjs', 'tutorialCut.mjs', 'tutorialStage.mjs', 'tutorialVoice.mjs', 'tutorialBrowser.mjs',
    'tutorialGestures.mjs', 'tutorialSteps.mjs', 'tutorialPictures.mjs', 'tutorialCheckpoint.mjs', 'tutorialPreviewWatch.mjs'];
  return Object.assign({}, ...await Promise.all(names.map(local)));
}

/**
 * Every file the recipe's `files` steps show, { <name>: <file> }. A name is the recipe's `media` entry for it (a file
 * name or path), else the name itself, looked up in the media folders (`folder` = --media, then the docs footage and
 * images): a step can name `opera_house_dolly.mp4` without a `media` entry. Throws before the take starts when a file
 * is missing. The build server passes the steps of one job as `setup`.
 */
export async function recipeMedia(recipe, folder) {
  const { findMedia, mediaDirs } = await import('./docShotSettings.mjs');
  const named = recipe.media ?? {};
  const steps = [...recipe.setup ?? [], ...recipe.resume ?? [], ...(recipe.scenes ?? []).flatMap(scene => scene.steps ?? [])];
  const names = [...new Set([...Object.keys(named), ...steps.flatMap(step => step.files ?? [])])];
  const files = Object.fromEntries(names.map(name => [name, findMedia(named[name] ?? name, { media: folder })]));
  const missing = names.filter(name => !files[name]).map(name => named[name] ?? name);
  if (missing.length) throw new Error(`Media ${missing.join(', ')} not found; pass --media <folder> (searched ${mediaDirs({ media: folder }).join(', ')})`);
  return files;
}

/**
 * Opens the editor. options: { url, viewport, chrome (a context of the user's Chrome, or "attach"), work (folder
 * for the profile copy, pictures and downloads), profile (to use as it is instead of a copy), from (checkpoint
 * name), project (name of a new project), storage, hide, pointer (start target), pointerScale, media, fresh }.
 * Returns the session: { page, context, mouse, run, locate, take, viewport, checkpoint, profile, headless, close }.
 */
export async function openSession(options) {
  const m = await tutorialModules(options.fresh);
  const { url, chrome, work, from, media = {} } = options;
  const viewport = options.viewport ?? m.DEFAULT_VIEWPORT;
  if (chrome && from) throw new Error('a checkpoint ("from") needs the headless Chrome; leave out --attach');
  const checkpoint = from ? m.readCheckpoint(from) : null;
  if (checkpoint && checkpoint.viewport && (checkpoint.viewport.width !== viewport.width || checkpoint.viewport.height !== viewport.height)) {
    throw new Error(`checkpoint ${from} was saved at ${checkpoint.viewport.width}×${checkpoint.viewport.height}, this recipe uses ${viewport.width}×${viewport.height}`);
  }
  if (checkpoint?.origin && checkpoint.origin !== new URL(url).origin) {
    throw new Error(`checkpoint ${from} belongs to ${checkpoint.origin} (its project lives in that origin's storage), not ${new URL(url).origin}: pass --url ${checkpoint.origin}`);
  }
  fs.mkdirSync(work, { recursive: true });
  let profile = options.profile;
  if (!chrome && !profile) {
    profile = path.join(work, 'profile');
    m.copyProfile(checkpoint?.profile, profile);
  }

  const handle = await m.tutorialPage({ viewport, scale: options.scale ?? 1, chrome, profile });
  const { page, context } = handle;
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await handle.done(); } };
  const take = { t0: m.now(), scene: null, lead: options.lead ?? 0.25, camera: [], fast: [], downloads: [] };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('download', download => take.downloads.push(download));
  try {
    await page.addInitScript(pageHooks);
    // The desktop window's files come from disk through this route.
    await page.unroute('**/__tutorial-media/**').catch(() => {});
    await page.route('**/__tutorial-media/**', route => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
      return media[name] ? route.fulfill({ path: media[name], contentType: 'video/mp4' }) : route.fulfill({ status: 404 });
    });
    if (handle.headless) console.log(`headless Chrome ${viewport.width}×${viewport.height}, WebGPU: ${await m.warmGpu(page, new URL(url).origin)}`);
    await page.goto(`${url}/editor`);
    if (options.storage && (!checkpoint || options.storage.settings)) {
      // A checkpoint brings its own layout: only settings apply on top of it.
      await page.evaluate(({ remove = [], settings }) => {
        for (const key of remove) localStorage.removeItem(key);
        if (!settings) return;
        const stored = JSON.parse(localStorage.getItem('masterselects-settings') ?? 'null') ?? { state: {}, version: 0 };
        Object.assign(stored.state, settings);
        localStorage.setItem('masterselects-settings', JSON.stringify(stored));
      }, checkpoint ? { settings: options.storage.settings } : options.storage);
      await page.reload();
    }
    // A fresh profile opens on the welcome screen; a used one reopens its last project.
    const welcome = page.getByRole('button', { name: /New project/ }).first();
    const editor = page.locator('.dock-tab-pane[data-group-id="timeline-group"]');
    await Promise.any([welcome.waitFor({ timeout: 60000 }), editor.waitFor({ timeout: 60000 })]);
    if (checkpoint) {
      if (!await editor.isVisible()) throw new Error(`checkpoint ${from} did not reopen its project (the welcome screen shows)`);
    } else if (await welcome.isVisible()) {
      await welcome.click();
      await page.locator('form input').first().fill(options.project ?? 'My first edit');
      await page.getByRole('button', { name: 'Continue' }).click();
    } else if (options.project !== false) {
      // The name goes into the dialog's own field: typed before the dialog is open, its letters
      // reached the timeline as shortcuts (l played, and the setup ran against a playing project).
      await pause(1500);
      await page.getByText('File', { exact: true }).first().click();
      await page.getByText(/^New Project/).first().click();
      const dialog = page.locator('.project-name-dialog');
      await dialog.locator('input').first().fill(options.project ?? 'My first edit', { timeout: 15000 });
      await dialog.locator('input').first().press('Enter');
      await dialog.waitFor({ state: 'detached', timeout: 30000 });
    }
    await page.getByRole('button', { name: 'End walkthrough' }).click({ timeout: 6000 }).catch(() => {});
    await page.waitForFunction(() => window.aiTools && document.querySelector('.track-lane'), null, { timeout: 60000 });
    // Steps start paused: playing, the editor re-renders under every step and menus close mid-glide.
    const playing = page.locator('.dock-tab-pane[data-group-id="timeline-group"] button[aria-label="Pause"]').first();
    if (await playing.isVisible().catch(() => false)) { console.log('the project was playing: paused it'); await playing.click(); }
    await handle.emulate?.();
    await m.applyEditorTheme(page, m.docShotSettings().theme);
    if (options.hide?.length) await page.addStyleTag({ content: `${options.hide.join(', ')} { display: none !important; }` });
    const overlayScale = viewport.width / 1280;
    await page.evaluate(m.installStage, overlayScale);
    // The pointer starts where the checkpoint left it, at the recipe's point, or mid-frame while that target
    // does not exist yet (the layout of an earlier take, before setup restores the default).
    const startAt = checkpoint?.pointer ?? (options.pointer ? await page.evaluate(m.locateTutorialTarget, options.pointer) : null);
    const mouse = await m.humanMouse(page, startAt && !startAt.missing ? startAt : { x: viewport.width * 0.62, y: viewport.height * 0.45 },
      { scale: options.pointerScale ?? Math.max(1, overlayScale * 0.625) });
    // A reload of the page (Vite reloads it after a code change, e.g. a merge) drops the overlays and the pointer
    // the steps need; they come back by themselves, so a long-lived build server keeps working.
    page.on('load', () => void (async () => {
      await page.waitForFunction(() => document.body && window.aiTools, null, { timeout: 60000 });
      await m.applyEditorTheme(page, m.docShotSettings().theme);
      if (options.hide?.length) await page.addStyleTag({ content: `${options.hide.join(', ')} { display: none !important; }` });
      await page.evaluate(m.installStage, overlayScale);
      await mouse.reinstall();
      console.warn('the page reloaded (a code change?): overlays and pointer are back; the editor reopened its last project');
    })().catch(error => console.warn(`the page reloaded, and its overlays did not come back: ${error.message}`)));
    const runner = m.stepRunner({ page, context, mouse, viewport, media, work, take, helpers: m });
    const session = { page, context, mouse, ...runner, take, viewport, checkpoint, profile, work, headless: Boolean(handle.headless), errors,
      emulate: handle.emulate, close, modules: m };
    if (checkpoint) {
      const restored = await page.evaluate(m.restoreRuntime, checkpoint.runtime ?? {});
      if (restored.missing.length) console.warn(`checkpoint ${from}: selected clips no longer there: ${restored.missing.join(', ')}`);
      await pause(600);
      if (checkpoint.resume?.length) await runSteps(session, checkpoint.resume, { prefix: 'resume' });
      const at = mouse.position();
      if (Math.hypot(at.x - checkpoint.pointer.x, at.y - checkpoint.pointer.y) > 1) await mouse.glide(checkpoint.pointer, { ms: 300 });
    }
    return session;
  } catch (error) {
    await close();
    throw error;
  }
}

/** Page side: the editor's latest warnings and errors, for a failed step. */
function recentWarnings() {
  return (window.Logger?.getBuffer?.('WARN') ?? []).slice(-6).map(entry => `${entry.level} ${entry.module}: ${entry.message}`.slice(0, 200));
}

/**
 * Runs steps with a picture after each (<work>/steps/<prefix>-NN.jpg) and writes the contact sheet
 * <work>/<prefix>.jpg. A failed step leaves <work>/<prefix>.failed.jpg (the page before and after it, the
 * error and the editor's latest warnings) and throws an error that names the step and the picture.
 * shots: false skips the pictures (not the failure picture).
 */
export async function runSteps(session, steps, { prefix = 'setup', shots = true, startIndex = 0 } = {}) {
  const { page, context, modules: m } = session;
  const dir = path.join(session.work, 'steps');
  fs.mkdirSync(dir, { recursive: true });
  const items = [];
  const picture = index => path.join(dir, `${prefix}-${String(index).padStart(2, '0')}.jpg`);
  let before = null;
  try {
    for (const [offset, step] of steps.entries()) {
      const index = startIndex + offset + 1;
      try {
        await session.run(step);
        if (shots) {
          await m.snapshot(context, page, picture(index));
          items.push({ file: picture(index), label: `${index} ${m.stepLabel(step)}` });
          before = picture(index);
        }
      } catch (error) {
        const after = path.join(dir, `${prefix}-${String(index).padStart(2, '0')}-failed.jpg`);
        await m.snapshot(context, page, after).catch(() => {});
        items.push({ file: after, label: `${index} ${m.stepLabel(step)}`, bad: true });
        const warnings = await page.evaluate(recentWarnings).catch(() => []);
        const message = `${prefix} step ${index} ${JSON.stringify(step)}: ${error.message}`;
        const file = path.join(path.dirname(dir), `${prefix}.failed.jpg`);
        await m.beforeAfter({ before, after, message: [message, ...warnings].join(' | '), file }).catch(() => {});
        throw new Error(`${message}${warnings.length ? `\n  editor warnings: ${warnings.join('\n    ')}` : ''}\n  the page before and after the step: ${file}`);
      }
    }
  } finally {
    const sheets = await m.contactSheet(items, path.join(path.dirname(dir), `${prefix}.jpg`)).catch(() => null);
    if (sheets) console.log(`${prefix}: ${items.length} pictures in ${sheets.map(sheet => path.relative(process.cwd(), sheet)).join(', ')}`);
  }
  return items;
}
