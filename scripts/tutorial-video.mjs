// Tutorial videos: a narrated screen recording of the real editor of this checkout, made from a
// recipe (scripts/tutorials/*.json), for the website and social channels.
//
//   node scripts/tutorial-video.mjs scripts/tutorials/cut-a-video.json [--url http://localhost:5192]
//       [--out <folder>] [--media <folder>] [--voice flamer|male|female|<voice id>|none] [--recut] [--attach]
//
// 1. Narration: every scene's `say`, spoken by ElevenLabs in one request with word times
//    (scripts/tutorialVoice.mjs; default voice "flamer", with ELEVENLABS_BROWSER_API_KEY or
//    ELEVENLABS_API_KEY). --voice none times the words at an even pace instead, to check a recording
//    before paying for a voice. A recipe with `audio` brings a recorded voice: Deepgram times its words
//    (DEEPGRAM_API_KEY), and the recording keeps the voice's own pauses (each scene lasts until the
//    next scene's first word). Cached in the work folder.
// 2. Recording: a fresh project, recorded with Chrome's screencast at `scale` device pixels per CSS
//    px while the steps drive the real mouse, with a drawn pointer (scripts/docClipPointer.mjs) and
//    the overlays of scripts/tutorialStage.mjs. The browser is a hardware-GPU Chrome with its own
//    profile, or with --attach a tab of the user's running Chrome (scripts/tutorialBrowser.mjs;
//    scripts/tutorial-tab.mjs keeps that connection open between runs).
//    Each scene lasts at least as long as its sentence.
// 3. Cut: the frames through the scene cameras, sped-up waits, the narration and word captions
//    (scripts/tutorialCut.mjs). --recut encodes the kept recording again (camera, captions, voice).
//
// Writes <out>/<name>.mp4 (default out: tutorial-videos/, not tracked); <out>/<name>.work keeps the
// screencast frames, recording.json and the narration.
//
// Recipe: { name, project, viewport { width, height }, scale (default 2), output { width, height, fps },
//   voice { voice, model, stability, similarity, speed, prefix } | audio "<voice file>", music { file, cues }
//   (scripts/tutorialMusic.mjs),
//   captions { font, size, maxWords },
//   lead (s before a scene's first word), media { "<name shown>": "<file name or path>" },
//   storage { remove: [localStorage keys], settings: { <editor setting>: value } } (applied before the editor loads),
//   hide [CSS selectors], setup [step] (after the project opens, not recorded), scenes [scene] }
// Scene: { id, say, camera, captions: "top" | "bottom", tail (s after the last word), steps [step] }
// Steps:
//   { "card": { title, subtitle, brand }, "ms" }     a title card; "keep": true leaves it up
//   { "hideCard": true }
//   { "camera": <spec>, "ms" }                        frame dock groups (["left-group", "timeline-group"]),
//                                                     "all", or { panes, pad, maxZoom } / { box } (cameraFor),
//                                                     or { focus: "pointer" | <target>, zoom } (a push in or out)
//   { "defaultLayout": true }                       (setup) load the default dock layout and check that it stays
//   { "word": "<word>", "nth": 1, "early": 0.2 }     wait until the scene's narration reaches that word
//                                                     (`early` s before it)
//   { "files": [<media names>], "title", "at": <target> }   a desktop window, its top left at the target
//   { "pick": [0, 1] }                                click the files of the window (more than one: shift-click)
//   { "dropFiles": <target> }                         carry the picked files there and drop them
//   { "drag": <target>, "via": [<target>], "to": <target>, "label", "ms", "hold" }  press (hold ms: 650 for a dock tab),
//                                                     drag (through `via`), release
//   { "click": <target>, "until": "<text>", "button": "right" }  click; with `until`, again until that text shows
//                                                     (at most 3 times); "button": "right" for a context menu
//   { "dblclick": <target> }                         double-click (a value field opens for typing)
//   { "connect": { from, output, to, input, group }, "ms" }  drag a cable from the output port of node card `from`
//                                                     to the input port of `to` (ports by their aria-label)
//   { "marquee": [<node card labels>], "group", "pad" } right-drag a selection marquee around those cards
//   { "cableClick": { from, output, to, input, group } }  right-click the cable between two node cards
//   { "scroll": <target>, "dy": 240, "turns": 6 }     wheel turns there: scroll a panel, or zoom the node canvas (dy < 0 zooms in)
//   { "move": <target> } | { "pause": ms } | { "type": "text" } | { "press": "Enter" }
//   { "circle": <target>, "r", "ry", "turns", "ms" } loop the pointer around the target
//   { "wave": <target>, "amp", "cycles", "ms" } | { "nod": … }   swing sideways (hello) or up and down (yes)
//   { "trace": [<target>, …], "curve": true, "ms" }  follow a line through the targets (curve: like a cable)
//   { "key": "c", "label": "C" }                      press a key and show its cap by the pointer
//   { "waitFor": "media" | "clips", "count": 2 } | { "waitFor": "download" } | { "waitFor": "text" | "gone", "text": "…" }
//                                                     "fast": 6 plays the wait six times faster in the cut
// Targets: see locateTutorialTarget in scripts/tutorialStage.mjs (clip:, time:, ruler:, pane:, node:, handle:,
//   aria:, option:, input:, file:, text), "button:<name>", or "~<dx>,<dy>" relative to the pointer.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const now = () => Date.now() / 1000;
const plain = text => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A small poster of a media file for the desktop window, as a data URL. */
function thumbnail(file) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'scale=256:-2',
    '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', '-'], { maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`No thumbnail of ${file}: ${result.stderr}`);
  return `data:image/jpeg;base64,${result.stdout.toString('base64')}`;
}

/** Page side, before the editor loads: no folder dialog, and every saved download noted. */
function pageHooks() {
  if (window.__tutorialHooks) return;
  window.__tutorialHooks = true;
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(`tutorial-${Date.now()}`, { create: true });
  Object.defineProperty(Navigator.prototype, 'doNotTrack', { configurable: true, get: () => '1' });
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

/**
 * Makes the tutorial. chrome: a connected context of the user's Chrome to record in (a long-lived
 * connection, see tutorial-tab.mjs); it stays open. fresh: re-import the helper modules (a long-lived caller).
 */
export async function main(args, { chrome, fresh = false } = {}) {
  const local = name => import(`${pathToFileURL(path.join(import.meta.dirname, name)).href}${fresh ? `?t=${Date.now()}` : ''}`);
  const [{ humanMouse }, { applyEditorTheme, docShotSettings, findMedia, mediaDirs }, { cutTutorial, timeMap },
    { cameraFor, installStage, locateTutorialTarget }, { estimatedNarration, narrate, recordedNarration },
    { tutorialPage }, { circlePoints, swingPoints, tracePoints }] = await Promise.all(['docClipPointer.mjs', 'docShotSettings.mjs',
    'tutorialCut.mjs', 'tutorialStage.mjs', 'tutorialVoice.mjs', 'tutorialBrowser.mjs', 'tutorialGestures.mjs'].map(local));

  const valued = ['--url', '--out', '--media', '--voice'];
  const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
  const recipeFile = args.find((arg, index) => !arg.startsWith('--') && !valued.includes(args[index - 1]));
  if (!recipeFile) throw new Error('Name a recipe, e.g. scripts/tutorials/cut-a-video.json');
  const recipe = JSON.parse(fs.readFileSync(recipeFile, 'utf8'));
  const url = option('--url', 'http://localhost:5192').replace(/\/$/, '');
  const out = path.resolve(option('--out', 'tutorial-videos'));
  const work = path.join(out, `${recipe.name}.work`);
  const voice = option('--voice', recipe.voice?.voice ?? 'flamer');
  const lead = recipe.lead ?? 0.25;

  const media = Object.fromEntries(Object.entries(recipe.media ?? {}).map(([name, file]) => {
    const found = findMedia(file, { media: option('--media') });
    if (!found) throw new Error(`Media ${file} not found; pass --media <folder> (searched ${mediaDirs({ media: option('--media') }).join(', ')})`);
    return [name, found];
  }));

  async function record(narration) {
    const viewport = recipe.viewport ?? { width: 1280, height: 720 };
    const handle = await tutorialPage({ viewport, scale: recipe.scale ?? 2, chrome: chrome ?? (args.includes('--attach') ? 'attach' : undefined) });
    const { page, context } = handle;
    const errors = [], downloads = [];
    const onError = error => errors.push(error.message), onDownload = download => downloads.push(download);
    page.on('pageerror', onError);
    page.on('download', onDownload);
    try {
      await page.addInitScript(pageHooks);
      // The desktop window's files come from disk through this route.
      await page.unroute('**/__tutorial-media/**').catch(() => {});
      await page.route('**/__tutorial-media/**', route => {
        const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
        return media[name] ? route.fulfill({ path: media[name], contentType: 'video/mp4' }) : route.fulfill({ status: 404 });
      });
      await page.goto(`${url}/editor`);
      if (recipe.storage) {
        await page.evaluate(({ remove = [], settings }) => {
          for (const key of remove) localStorage.removeItem(key);
          if (!settings) return;
          const stored = JSON.parse(localStorage.getItem('masterselects-settings') ?? 'null') ?? { state: {}, version: 0 };
          Object.assign(stored.state, settings);
          localStorage.setItem('masterselects-settings', JSON.stringify(stored));
        }, recipe.storage);
        await page.reload();
      }
      // A fresh profile opens on the welcome screen; a used one reopens its last project, so the
      // new project comes from File > New Project there.
      const welcome = page.getByRole('button', { name: /New project/ }).first();
      const editor = page.locator('.dock-tab-pane[data-group-id="timeline-group"]');
      await Promise.any([welcome.waitFor({ timeout: 60000 }), editor.waitFor({ timeout: 60000 })]);
      if (await welcome.isVisible()) {
        await welcome.click();
        await page.locator('form input').first().fill(recipe.project ?? 'My first edit');
        await page.getByRole('button', { name: 'Continue' }).click();
      } else {
        await pause(1500);
        await page.getByText('File', { exact: true }).first().click();
        await page.getByText(/^New Project/).first().click();
        await page.keyboard.press('Control+A');
        await page.keyboard.type(recipe.project ?? 'My first edit');
        await page.keyboard.press('Enter');
      }
      await page.getByRole('button', { name: 'End walkthrough' }).click({ timeout: 6000 }).catch(() => {});
      await page.waitForFunction(() => window.aiTools && document.querySelector('.track-lane'), null, { timeout: 60000 });
      await handle.emulate?.();
      await applyEditorTheme(page, docShotSettings().theme);
      if (recipe.hide?.length) await page.addStyleTag({ content: `${recipe.hide.join(', ')} { display: none !important; }` });
      await page.evaluate(installStage);
      // The pointer starts at the recipe's point, or mid-frame while that target does not exist yet
      // (the layout of an earlier take, before setup restores the default).
      const startAt = recipe.pointer ? await page.evaluate(locateTutorialTarget, recipe.pointer) : null;
      const mouse = await humanMouse(page, startAt && !startAt.missing ? startAt : { x: viewport.width * 0.62, y: viewport.height * 0.45 });
      await pause(1500);

      const locate = async target => {
        // ~dx,dy: relative to where the pointer is.
        if (target.startsWith('~')) { const [dx, dy] = target.slice(1).split(',').map(Number); const at = mouse.position(); return { x: at.x + dx, y: at.y + dy }; }
        // button:<name>: the button whose accessible name starts with it ("button:Export" for "Export ~109 MB").
        if (target.startsWith('button:')) {
          const name = target.slice(7).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const box = await page.getByRole('button', { name: new RegExp(`^\\s*${name}`) }).first().boundingBox({ timeout: 5000 }).catch(() => null);
          if (!box) throw new Error(`Step target "${target}": no visible button`);
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }
        // A control that is still appearing (a menu, a freshly opened tab) gets a moment to render.
        let point;
        for (const until = Date.now() + 1500; ; await pause(150)) {
          point = await page.evaluate(locateTutorialTarget, target);
          if (!point.missing || Date.now() > until) break;
        }
        if (point.missing) throw new Error(`Step target "${target}": ${point.missing}`);
        return point;
      };
      const pointer = () => page.evaluate(() => window.__docClipPointer.expected.at(-1));
      // A click on an overlay (the desktop window): the ripple without a real click on the editor beneath.
      const fakeClick = () => page.evaluate(() => {
        const { x, y } = window.__docClipPointer.expected.at(-1), ripple = document.createElement('div');
        ripple.className = 'doc-clip-ripple';
        Object.assign(ripple.style, { left: `${x}px`, top: `${y}px` });
        document.documentElement.append(ripple);
        setTimeout(() => ripple.remove(), 650);
      });
      // A port of a node card by its aria-label, the one nearest the card (ports exist as page
      // elements only while the pointer is over their card).
      const portNear = async (label, card) => {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const point = await page.evaluate(({ label, card }) => {
            const ports = [...document.querySelectorAll('.node-workspace-port')].filter(port => port.getAttribute('aria-label') === label && port.getBoundingClientRect().width);
            const centers = ports.map(port => { const rect = port.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; });
            return centers.toSorted((a, b) => Math.hypot(a.x - card.x, a.y - card.y) - Math.hypot(b.x - card.x, b.y - card.y))[0] ?? null;
          }, { label, card });
          if (point) return point;
          await pause(120);
        }
        throw new Error(`no port "${label}" near the card`);
      };
      const press = async (button = 'left') => { await pause(140); await page.mouse.down({ button }); await pause(90); await page.mouse.up({ button }); };

      let t0 = now(), scene;
      const scenes = [], camera = [], fast = [];
      const saved = since => fast.filter(range => range.from >= since - t0).reduce((sum, range) => sum + (range.to - range.from) * (1 - 1 / range.factor), 0);

      const run = async step => {
        if (step.pause) await pause(step.pause);
        else if (step.defaultLayout) {
          // Setup: View > Layouts > Load Default Layout until the panels have their default widths (a project
          // that opens late may restore its own saved layout over it).
          const leftWidth = () => page.evaluate(() => document.querySelector('.dock-tab-pane[data-group-id="left-group"]')?.getBoundingClientRect().width ?? 0);
          for (let attempt = 0; ; attempt += 1) {
            await page.getByText('View', { exact: true }).first().click();
            await page.getByText('Layouts', { exact: true }).first().hover();
            await pause(300);
            await page.getByText('Load Default Layout', { exact: true }).first().click();
            await pause(1200);
            const width = await leftWidth();
            if (Math.abs(width - viewport.width * (step.defaultLayout.left ?? 0.293)) < 40) break;
            if (attempt >= 3) throw new Error(`the default layout did not stay: left group ${Math.round(width)} px`);
          }
        } else if (step.word) {
          // The narration reaches the word at the scene's start + lead + its offset in the sentence
          // (sped-up waits in between count at their output length).
          const matches = scene.part?.words.filter(word => plain(word.text) === plain(step.word)) ?? [];
          const word = matches[(step.nth ?? 1) - 1];
          if (!word) throw new Error(`no word "${step.word}" #${step.nth ?? 1} in scene ${scene.id}`);
          const at = scene.start + lead + (word.start - scene.part.start) + saved(scene.start) - (step.early ?? 0);
          const wait = at - now();
          if (wait < -0.15) console.warn(`  ${scene.id}: ${(-wait).toFixed(2)} s late for "${step.word}"`);
          if (wait > 0) await pause(wait * 1000);
        } else if (step.card) {
          await page.evaluate(card => window.__tutorial.card(card), step.card);
          await pause(step.ms ?? 2500);
          if (!step.keep) await page.evaluate(() => window.__tutorial.hideCard());
        } else if (step.hideCard) await page.evaluate(() => window.__tutorial.hideCard());
        else if (step.camera) {
          let framing;
          if (step.camera.focus) {
            // A push in (or out) around a point, kept inside the page.
            const at = step.camera.focus === 'pointer' ? mouse.position() : await locate(step.camera.focus);
            const zoom = step.camera.zoom ?? 1.15, halfW = viewport.width / zoom / 2, halfH = viewport.height / zoom / 2;
            framing = { zoom, cx: Math.min(viewport.width - halfW, Math.max(halfW, at.x)), cy: Math.min(viewport.height - halfH, Math.max(halfH, at.y)) };
          } else framing = await page.evaluate(cameraFor, step.camera);
          if (framing.missing) throw new Error(framing.missing);
          camera.push({ t: now() - t0, ms: step.ms ?? 900, ...framing });
        } else if (step.files) {
          const at = await locate(step.at ?? 'pane:preview-group:0.3,0.2');
          await page.evaluate(window_ => window.__tutorial.files(window_), {
            title: step.title ?? 'Desktop', x: at.x, y: at.y,
            list: step.files.map(name => ({ name, thumb: thumbnail(media[name]), url: `/__tutorial-media/${encodeURIComponent(name)}` })) });
          await pause(step.after ?? 500);
        } else if (step.pick) {
          for (const [order, index] of step.pick.entries()) {
            await mouse.glide(await locate(`file:${index}`), { ms: step.ms });
            if (order) await page.evaluate(() => window.__tutorial.key('Shift', window.__docClipPointer.expected.at(-1)));
            await pause(120);
            await fakeClick();
            await page.evaluate(([i, add]) => window.__tutorial.selectFile(i, add), [index, order > 0]);
            await pause(step.after ?? 380);
          }
        } else if (step.dropFiles) {
          await page.evaluate(() => window.__tutorial.pickUp());
          await mouse.glide(await locate(step.dropFiles), { ms: step.ms ?? 1300 });
          await pause(250);
          const at = await pointer();
          const target = await page.evaluate(({ x, y }) => window.__tutorial.drop(x, y), at);
          console.log(`  dropped the files on ${target}`);
          await pause(300);
          await page.evaluate(() => window.__tutorial.hideFiles());
        } else if (step.drag) {
          if (step.label) await page.evaluate(label => { window.__tutorial.dragLabel = label; }, step.label);
          await mouse.glide(await locate(step.drag), { ms: step.approach });
          await pause(180);
          await page.mouse.down();
          await pause(step.hold ?? 120);
          // A few pixels first, so the editor (and Chrome's HTML5 drag) recognize a drag before the long move.
          const from = await pointer();
          await mouse.glide({ x: from.x + 6, y: from.y + 2 }, { ms: 120, straight: true });
          if (step.via) {
            // Through the via points (a "~dx,dy" one is relative to the point before it) to `to`.
            const way = [];
            for (const target of [...step.via, step.to]) {
              const [dx, dy] = target.startsWith('~') ? target.slice(1).split(',').map(Number) : [];
              const last = way.at(-1) ?? mouse.position();
              way.push(target.startsWith('~') ? { x: last.x + dx, y: last.y + dy } : await locate(target));
            }
            await mouse.path(way, { ms: step.ms ?? 1500 });
          } else await mouse.glide(await locate(step.to), { ms: step.ms });
          await pause(220);
          await page.mouse.up();
          await pause(step.after ?? 200);
        } else if (step.click) {
          for (let attempt = 0; attempt < (step.until ? 3 : 1); attempt += 1) {
            if (step.until && await page.getByText(step.until, { exact: true }).first().isVisible().catch(() => false)) break;
            await mouse.glide(await locate(step.click), { ms: step.ms });
            await press(step.button);
            await pause(step.after ?? 250);
          }
        } else if (step.cableClick) {
          // Right-click the middle of the cable between two node cards (its context menu inserts nodes).
          const { from, output, to, input, group = 'left-group' } = step.cableClick;
          const source = await locate(`aria:${from}@${group}`);
          await mouse.glide(source, { ms: step.approach });
          await pause(150);
          const start = await portNear(output, source);
          const target = await locate(`aria:${to}@${group}`);
          await mouse.glide(target, { ms: 450 });
          await pause(150);
          const end = await portNear(input, target);
          await mouse.glide({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, { ms: step.ms ?? 450 });
          await press('right');
          await pause(step.after ?? 300);
        } else if (step.connect) {
          // A cable between two node cards: ports exist as page elements only under the pointer, so
          // the pointer rests on the source card, grabs its port, drags onto the target card and
          // settles on the input that appeared there.
          const { from, output, to, input, group = 'left-group' } = step.connect;
          const source = await locate(`aria:${from}@${group}`);
          await mouse.glide(source, { ms: step.approach });
          await pause(200);
          await mouse.glide(await portNear(output, source), { ms: 280 });
          await pause(120);
          await page.mouse.down();
          await pause(100);
          const target = await locate(`aria:${to}@${group}`);
          await mouse.glide(target, { ms: step.ms ?? 900 });
          await pause(220);
          await mouse.glide(await portNear(input, target), { ms: 300 });
          await pause(160);
          await page.mouse.up();
          await pause(step.after ?? 250);
        } else if (step.marquee) {
          // A right-drag marquee around the named node cards (with `pad` CSS px around them).
          const group = step.group ?? 'left-group', pad = step.pad ?? 10;
          const box = await page.evaluate(({ labels, group }) => {
            const pane = document.querySelector(`.dock-tab-pane[data-group-id="${group}"]`);
            const rects = labels.map(label => [...(pane?.querySelectorAll('[data-node-id][aria-label]') ?? [])]
              .filter(element => element.getAttribute('aria-label') === label).map(element => element.getBoundingClientRect())
              .filter(rect => rect.width > 8).toSorted((a, b) => b.width * b.height - a.width * a.height)[0]).filter(Boolean);
            if (rects.length !== labels.length) return { missing: `only ${rects.length} of ${labels.length} node cards visible` };
            return { left: Math.min(...rects.map(r => r.left)), top: Math.min(...rects.map(r => r.top)),
              right: Math.max(...rects.map(r => r.right)), bottom: Math.max(...rects.map(r => r.bottom)) };
          }, { labels: step.marquee, group });
          if (box.missing) throw new Error(`marquee: ${box.missing}`);
          await mouse.glide({ x: box.left - pad, y: box.bottom + pad }, { ms: step.approach });
          await pause(150);
          await page.mouse.down({ button: 'right' });
          await pause(80);
          await mouse.path([{ x: box.right + pad, y: box.top - pad }], { ms: step.ms ?? 900 });
          await pause(120);
          await page.mouse.up({ button: 'right' });
          await pause(step.after ?? 250);
        } else if (step.dblclick) {
          await mouse.glide(await locate(step.dblclick), { ms: step.ms });
          await pause(140);
          for (const clickCount of [1, 2]) { await page.mouse.down({ clickCount }); await pause(60); await page.mouse.up({ clickCount }); await pause(70); }
          await pause(step.after ?? 250);
        } else if (step.scroll) {
          // Wheel turns at the target: scrolls a panel, or zooms the node canvas (negative dy zooms in).
          await mouse.glide(await locate(step.scroll), { ms: step.ms });
          const turns = step.turns ?? 6;
          for (let turn = 0; turn < turns; turn += 1) { await page.mouse.wheel(0, (step.dy ?? 240) / turns); await pause(step.every ?? 70); }
          await pause(step.after ?? 250);
        } else if (step.move) await mouse.glide(await locate(step.move), { ms: step.ms });
        else if (step.circle) {
          const center = await locate(step.circle);
          await mouse.path(circlePoints(center, mouse.position(), step), { ms: step.ms ?? 900 });
        } else if (step.wave || step.nod) {
          const center = await locate(step.wave ?? step.nod);
          if (Math.hypot(center.x - mouse.position().x, center.y - mouse.position().y) > 3) await mouse.glide(center, { ms: step.approach });
          await mouse.path(swingPoints(center, { amp: step.amp ?? (step.wave ? 40 : 12), cycles: step.cycles ?? 2, axis: step.wave ? 'x' : 'y' }), { ms: step.ms ?? 900 });
        } else if (step.trace) {
          const points = [];
          for (const target of step.trace) points.push(await locate(target));
          await mouse.glide(points[0], { ms: step.approach });
          await mouse.path(tracePoints(points, step).filter((_, index) => step.curve || index > 0), { ms: step.ms ?? 900 });
        } else if (step.type) await page.keyboard.type(step.type, { delay: step.delay ?? 110 });
        else if (step.press) { await page.keyboard.press(step.press); await pause(step.after ?? 200); }
        else if (step.key) {
          await page.evaluate(label => window.__tutorial.key(label, window.__docClipPointer.expected.at(-1)), step.label ?? step.key.toUpperCase());
          await pause(250);
          await page.keyboard.press(step.key);
          await pause(step.after ?? 450);
        } else if (step.waitFor) {
          const from = now();
          const deadline = from + (step.timeout ?? 180);
          const count = downloads.length, savedDownloads = await page.evaluate(() => window.__tutorialDownloads.length);
          let saving;
          for (;;) {
            if (now() > deadline) throw new Error(`waitFor ${step.waitFor} timed out`);
            if (step.waitFor === 'media') {
              const items = await page.evaluate(() => window.aiTools.execute('getMediaItems', {}));
              if ((items?.data?.files ?? []).filter(file => !file.isImporting).length >= (step.count ?? 1)) break;
            } else if (step.waitFor === 'clips') {
              const state = await page.evaluate(() => window.aiTools.execute('getTimelineState', {}));
              if ([...(state?.data?.videoTracks ?? []), ...(state?.data?.audioTracks ?? [])].flatMap(track => track.clips).length >= (step.count ?? 1)) break;
            } else if (step.waitFor === 'download') {
              saving = await page.evaluate(index => window.__tutorialDownloads[index], savedDownloads);
              if (saving || downloads.length > count) break;
            } else if (step.waitFor === 'text') {
              if (await page.getByText(step.text, { exact: true }).first().isVisible().catch(() => false)) break;
            } else if (step.waitFor === 'gone') {
              if (!await page.getByText(step.text, { exact: true }).first().isVisible().catch(() => false)) break;
            } else throw new Error(`unknown waitFor ${step.waitFor}`);
            await pause(200);
          }
          if (step.fast) fast.push({ from: from - t0, to: now() - t0, factor: step.fast });
          if (step.waitFor === 'download') {
            const download = downloads.length > count ? downloads.at(-1) : undefined;
            const name = saving?.name ?? download.suggestedFilename();
            let size = saving?.size;
            if (download) {
              const file = path.join(work, name);
              await download.saveAs(file).catch(() => {});
              if (fs.existsSync(file)) size = fs.statSync(file).size;
            }
            await page.evaluate(chip => window.__tutorial.download(chip), { name, size: `${((size ?? 0) / 1e6).toFixed(1)} MB` });
            console.log(`  exported ${name} (${size} bytes)`);
          }
        } else throw new Error(`unknown step ${JSON.stringify(step)}`);
      };

      // Setup: steps on the open project before the recording starts.
      scene = { id: 'setup', start: now() };
      for (const step of recipe.setup ?? []) await run(step);
      camera.length = 0;
      fast.length = 0;
      await handle.emulate?.();
      // The panels the take starts with (a layout left over from an earlier take shows here).
      console.log(`layout: ${await page.evaluate(() => [...document.querySelectorAll('.dock-tab-pane[data-group-id]')]
        .map(pane => `${pane.dataset.groupId} ${Math.round(pane.getBoundingClientRect().width)} px`).join(', '))}`);

      // Screencast: a frame whenever the page changes, with its time; the cut evens them out.
      const cdp = await context.newCDPSession(page);
      const frameDir = path.join(work, 'frames');
      fs.rmSync(frameDir, { recursive: true, force: true });
      fs.mkdirSync(frameDir, { recursive: true });
      const frames = [];
      cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        const file = path.join(frameDir, `${String(frames.length).padStart(5, '0')}.jpg`);
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
        frames.push({ file, time: metadata.timestamp });
        cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      });
      t0 = now();
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: recipe.jpegQuality ?? 90, everyNthFrame: 1 });

      // A failed step still leaves the recording up to it (recording.json with "failed"), so --recut can show it.
      const keepRecording = failed => {
        const recording = { viewport, end: now() - t0, scenes, camera, fast, failed, frames: frames.map(frame => ({ file: frame.file, time: frame.time - t0 })) };
        fs.writeFileSync(path.join(work, 'recording.json'), JSON.stringify(recording));
        return recording;
      };
      const timedScenes = recipe.scenes.map(item => narration.scenes.find(part => part.id === item.id)).filter(part => part?.words.length);
      for (const item of recipe.scenes) {
        const start = now();
        const part = narration.scenes.find(entry => entry.id === item.id);
        scene = { id: item.id, start, part };
        scenes.push({ id: item.id, start: start - t0, captions: item.captions ?? 'bottom' });
        // A recorded voice keeps its pauses: the scene lasts until the next sentence starts.
        const next = timedScenes[timedScenes.indexOf(part) + 1];
        const needed = !part?.words.length ? 0 : (narration.recorded || recipe.keepPauses) && next
          ? next.start - part.start : lead + (part.end - part.start) + (item.tail ?? 0.45);
        if (item.camera) await run({ camera: item.camera, ms: item.cameraMs });
        for (const step of item.steps ?? []) {
          try {
            await run(step);
          } catch (error) {
            const shot = path.join(work, `${item.id}.failed.png`);
            await page.screenshot({ path: shot }).catch(() => {});
            keepRecording(item.id);
            throw new Error(`${item.id}: ${error.message} (the page at that moment: ${shot})`);
          }
        }
        // The scene lasts until its sentence is spoken (sped-up waits count at their output length).
        const rest = needed - (now() - start - saved(start));
        if (rest > 0) await pause(rest * 1000);
        else if (needed && rest < -0.15 && next) console.warn(`  ${item.id}: ran ${(-rest).toFixed(2)} s over; the next sentence starts that much later`);
        console.log(`${item.id}: ${(now() - start).toFixed(1)} s recorded${needed ? `, sentence ${needed.toFixed(1)} s` : ''}`);
      }
      await pause(recipe.end ?? 400);
      await cdp.send('Page.stopScreencast');
      await cdp.detach().catch(() => {});
      const foreign = await page.evaluate(() => window.__docClipPointer.foreign);
      if (foreign) console.warn(`WARNING ${foreign} pointer events did not come from the script – the real mouse crossed the browser window.`);
      if (errors.length) console.warn(`Page errors: ${[...new Set(errors)].join(' | ')}`);
      return keepRecording();
    } finally {
      page.off('pageerror', onError);
      page.off('download', onDownload);
      await handle.done();
    }
  }

  fs.mkdirSync(work, { recursive: true });
  const narration = recipe.audio ? await recordedNarration(recipe, work, path.dirname(path.resolve(recipeFile)))
    : voice === 'none' ? estimatedNarration(recipe.scenes) : await narrate(recipe, work, { voice });
  const recordingFile = path.join(work, 'recording.json');
  const recording = args.includes('--recut') ? JSON.parse(fs.readFileSync(recordingFile, 'utf8')) : await record(narration);
  const output = path.join(out, `${recipe.name}.mp4`);
  const music = recipe.music && { ...recipe.music, file: path.resolve(path.dirname(path.resolve(recipeFile)), recipe.music.file) };
  const result = await cutTutorial({ recording, narration, output, workDir: work, lead, captions: recipe.captions, music,
    ...recipe.output });
  const speed = timeMap(recording.fast);
  console.log(`\n${path.relative(process.cwd(), output)}: ${result.duration.toFixed(1)} s, ${result.frames} frames, ${result.words} caption words`
    + `${narration.file ? '' : ' (no voice: words at an estimated pace)'}`);
  for (const item of recording.scenes) console.log(`  ${speed.toOutput(item.start).toFixed(1).padStart(5)} s  ${item.id}`);
  return { output, ...result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
  // An attached Chrome keeps the connection (and node) alive.
  process.exit(0);
}
