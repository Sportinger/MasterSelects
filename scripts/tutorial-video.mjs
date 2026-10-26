// Tutorial videos: a narrated screen recording of the real editor of this checkout, made from a
// recipe (scripts/tutorials/*.json), for the website and social channels.
//
//   node scripts/tutorial-video.mjs scripts/tutorials/cut-a-video.json [--url http://localhost:5192]
//       [--out <folder>] [--media <folder>] [--voice flamer|male|female|<voice id>|none] [--recut]
//       [--setup-only [--save <checkpoint>]]  run the start and the setup, save the result as a checkpoint
//                                              (default name <recipe name>-start), record nothing
//       [--no-shots] (no picture after every setup step) [--no-seam] (skip the seamless check)
//       [--attach] (record in a tab of the user's running Chrome: 1280×720 only, for trying things)
//
// 1. Narration: every scene's `say`, spoken by ElevenLabs in one request with word times
//    (scripts/tutorialVoice.mjs; default voice "flamer", with ELEVENLABS_BROWSER_API_KEY or
//    ELEVENLABS_API_KEY). --voice none times the words at an even pace instead, to check a recording
//    before paying for a voice. A recipe with `audio` brings a recorded voice: Deepgram times its words
//    (DEEPGRAM_API_KEY), and the recording keeps the voice's own pauses (each scene lasts until the
//    next scene's first word). Cached in the work folder.
// 2. Start (scripts/tutorialSession.mjs): a headless Chrome with the hardware GPU at 2560×1440, scale 1
//    (scripts/tutorialBrowser.mjs). With `from`, on a copy of that checkpoint's profile: its project
//    reopens, and its playhead, selection, pointer and `resume` steps come back
//    (scripts/tutorialCheckpoint.mjs). Without `from`, on an empty profile with a new project.
//    Then the `setup` steps, each with a picture (<work>/steps/, all in <work>/setup.jpg). A failed step
//    names itself and leaves <work>/setup.failed.jpg: the page before and after it.
//    A part that continues a checkpoint is compared with the checkpoint's last frame first (<work>/seam.jpg);
//    if they differ visibly, it stops before recording.
// 3. Recording: Chrome's screencast while the steps drive the mouse, with a drawn pointer
//    (scripts/docClipPointer.mjs) and the overlays of scripts/tutorialStage.mjs. Each scene lasts at least
//    as long as its sentence. recording.json keeps every step's start and end; <work>/scenes.jpg shows the
//    frame after every step. A finished take saves its end as a checkpoint (named after the recipe, or its
//    `checkpoint`), so the next part can continue from it.
// 4. Cut: the frames through the scene cameras, sped-up waits, the narration and word captions
//    (scripts/tutorialCut.mjs). --recut encodes the kept recording again (camera, captions, voice).
//
// Writes <out>/<name>.mp4 (default out: tutorial-videos/, not tracked); <out>/<name>.work keeps the
// screencast frames, recording.json, the pictures and the narration.
//
// Recipe: { name, project, from "<checkpoint>", checkpoint "<name to save the end as>", viewport { width, height }
//   (default 2560×1440), output { width, height, fps },
//   voice { voice, model, stability, similarity, speed, prefix } | audio "<voice file>", music { file, cues }
//   (scripts/tutorialMusic.mjs),
//   captions { font, size, maxWords },
//   lead (s before a scene's first word), media { "<name shown>": "<file name or path>" },
//   storage { remove: [localStorage keys], settings: { <editor setting>: value } } (applied before the editor loads;
//   with `from` only the settings), pointer (start target), pointerScale, hide [CSS selectors],
//   setup [step] (after the project opens, not recorded), scenes [scene],
//   resume [step] (saved with this part's checkpoint: rebuild what a reload loses, such as the node graph's source
//   and an expanded group; a part that continues from the checkpoint runs them before its setup) }
// Scene: { id, say, camera, captions: "top" | "bottom", tail (s after the last word), steps [step] }
// Steps (scripts/tutorialSteps.mjs):
//   { "card": { title, subtitle, brand }, "ms" }     a title card; "keep": true leaves it up
//   { "hideCard": true }
//   { "camera": <spec>, "ms" }                        frame dock groups (["left-group", "timeline-group"]),
//                                                     "all", or { panes, pad, maxZoom } / { box } (cameraFor),
//                                                     or { focus: "pointer" | <target>, zoom } (a push in or out)
//   { "defaultLayout": true }                       (setup) load the default dock layout and check that it stays
//   { "expect": { clips, clip: { name, track, start, end }, playing, playhead, selected, text, gone, previewNotBlack } }
//                                                     check the editor; stops with what differs
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
//   { "move": <target> } | { "pause": ms } | { "press": "Enter" }
//   { "type": "text" }                                types into the focused text field (stops if none has the focus:
//                                                     letters elsewhere are timeline shortcuts)
//   { "circle": <target>, "r", "ry", "turns", "ms" } loop the pointer around the target
//   { "wave": <target>, "amp", "cycles", "ms" } | { "nod": … }   swing sideways (hello) or up and down (yes)
//   { "trace": [<target>, …], "curve": true, "ms" }  follow a line through the targets (curve: like a cable)
//   { "key": "c", "label": "C" }                      press a key and show its cap by the pointer
//   { "waitFor": "media" | "clips", "count": 2 } | { "waitFor": "download" } | { "waitFor": "text" | "gone", "text": "…" }
//                                                     "fast": 6 plays the wait six times faster in the cut
// Targets: see locateTutorialTarget in scripts/tutorialStage.mjs (clip:, time:, ruler:, pane:, node:, handle:,
//   aria:, option:, input:, file:, text), "button:<name>", or "~<dx>,<dy>" relative to the pointer.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Share of pixels that may differ between a checkpoint's last frame and the next part's first frame.
const SEAM_TOLERANCE = 0.003;

/**
 * Makes the tutorial. chrome: a connected context of the user's Chrome to record in (a long-lived
 * connection, see tutorial-tab.mjs); it stays open. fresh: re-import the helper modules (a long-lived caller).
 */
export async function main(args, { chrome, fresh = false } = {}) {
  const local = name => import(`${pathToFileURL(path.join(import.meta.dirname, name)).href}${fresh ? `?t=${Date.now()}` : ''}`);
  const { openSession, runSteps, tutorialModules } = await local('tutorialSession.mjs');
  const m = await tutorialModules(fresh);

  const valued = ['--url', '--out', '--media', '--voice', '--save'];
  const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
  const recipeFile = args.find((arg, index) => !arg.startsWith('--') && !valued.includes(args[index - 1]));
  if (!recipeFile) throw new Error('Name a recipe, e.g. scripts/tutorials/cut-a-video.json');
  const recipe = JSON.parse(fs.readFileSync(recipeFile, 'utf8'));
  const url = option('--url', 'http://localhost:5192').replace(/\/$/, '');
  const out = path.resolve(option('--out', 'tutorial-videos'));
  const work = path.join(out, `${recipe.name}.work`);
  const voice = option('--voice', recipe.voice?.voice ?? 'flamer');
  const lead = recipe.lead ?? 0.25;
  const attach = chrome ?? (args.includes('--attach') ? 'attach' : undefined);
  const viewport = recipe.viewport ?? (attach ? { width: 1280, height: 720 } : m.DEFAULT_VIEWPORT);

  const media = Object.fromEntries(Object.entries(recipe.media ?? {}).map(([name, file]) => {
    const found = m.findMedia(file, { media: option('--media') });
    if (!found) throw new Error(`Media ${file} not found; pass --media <folder> (searched ${m.mediaDirs({ media: option('--media') }).join(', ')})`);
    return [name, found];
  }));

  /** The page now as a PNG (for checkpoints and the seamless check). */
  const still = async (session, name) => m.snapshot(session.context, session.page, path.join(work, name));
  /** The checkpoint's state from an open session (call before closing it). */
  const checkpointState = async (session, camera) => ({
    recipe: recipe.name, origin: new URL(url).origin, viewport, project: recipe.project,
    runtime: await session.page.evaluate(m.readRuntime), pointer: session.mouse.position(), camera, resume: recipe.resume ?? [],
  });
  const restCamera = { cx: viewport.width / 2, cy: viewport.height / 2, zoom: 1 };

  async function record(narration) {
    const session = await openSession({ url, viewport, chrome: attach, scale: attach ? recipe.scale ?? 2 : 1, work, from: recipe.from,
      project: recipe.project, storage: recipe.storage, hide: recipe.hide, pointer: recipe.pointer, pointerScale: recipe.pointerScale,
      media, lead, fresh });
    const { page, context, take, mouse } = session;
    const steps = [];
    try {
      await runSteps(session, recipe.setup ?? [], { prefix: 'setup', shots: !args.includes('--no-shots') });
      await session.emulate?.();

      if (args.includes('--setup-only')) {
        const name = option('--save', `${recipe.name}-start`);
        if (!session.headless) throw new Error('--setup-only saves a checkpoint, which needs the headless Chrome (leave out --attach)');
        const last = await still(session, 'last.png');
        await m.saveCheckpoint({ name, page, profile: session.profile, close: session.close, lastPng: last,
          state: await checkpointState(session, session.checkpoint?.camera ?? restCamera) });
        return { checkpoint: name };
      }

      // The panels the take starts with (a layout left over from an earlier take shows here).
      console.log(`layout: ${(await page.evaluate(m.readRuntime)).layout.join(', ')}`);
      if (session.checkpoint && !args.includes('--no-seam')) {
        const first = await still(session, 'first.png');
        const seam = await m.seamDifference({ before: session.checkpoint.last, now: first, file: path.join(work, 'seam.jpg'), width: viewport.width });
        const where = seam.box ? ` around x ${seam.box.x}–${seam.box.x + seam.box.width}, y ${seam.box.y}–${seam.box.y + seam.box.height}` : '';
        if (seam.changed > SEAM_TOLERANCE) {
          throw new Error(`the first frame differs from checkpoint ${recipe.from}'s last frame in ${(seam.changed * 100).toFixed(1)} % of the picture${where}`
            + ` (compare: ${seam.file}). Bring it back with resume steps on the earlier part, or setup steps here; --no-seam records anyway.`);
        }
        console.log(`seamless: ${(seam.changed * 100).toFixed(2)} % of the picture differs from ${recipe.from}'s last frame${where}`);
      }

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
      take.camera.length = 0;
      take.fast.length = 0;
      take.t0 = m.now();
      // A part that continues a checkpoint starts with that part's last camera.
      if (session.checkpoint?.camera) take.camera.push({ t: 0, ms: 0, ...session.checkpoint.camera });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: recipe.jpegQuality ?? 90, everyNthFrame: 1 });

      // A failed step still leaves the recording up to it (recording.json with "failed"), so --recut can show it.
      const keepRecording = failed => {
        const recording = { viewport, end: m.now() - take.t0, scenes, steps, camera: take.camera, fast: take.fast, failed,
          frames: frames.map(frame => ({ file: frame.file, time: frame.time - take.t0 })) };
        fs.writeFileSync(path.join(work, 'recording.json'), JSON.stringify(recording));
        return recording;
      };
      const scenes = [];
      const timedScenes = recipe.scenes.map(item => narration.scenes.find(part => part.id === item.id)).filter(part => part?.words.length);
      for (const item of recipe.scenes) {
        const start = m.now();
        const part = narration.scenes.find(entry => entry.id === item.id);
        take.scene = { id: item.id, start, part };
        scenes.push({ id: item.id, start: start - take.t0, captions: item.captions ?? 'bottom' });
        // A recorded voice keeps its pauses: the scene lasts until the next sentence starts.
        const next = timedScenes[timedScenes.indexOf(part) + 1];
        const needed = !part?.words.length ? 0 : (narration.recorded || recipe.keepPauses) && next
          ? next.start - part.start : lead + (part.end - part.start) + (item.tail ?? 0.45);
        if (item.camera) await session.run({ camera: item.camera, ms: item.cameraMs });
        for (const [index, step] of (item.steps ?? []).entries()) {
          const begin = m.now() - take.t0;
          try {
            await session.run(step);
            steps.push({ scene: item.id, index: index + 1, label: m.stepLabel(step), start: begin, end: m.now() - take.t0 });
          } catch (error) {
            const failedAt = m.now() - take.t0;
            const after = path.join(work, `${item.id}.failed-now.jpg`);
            await m.snapshot(context, page, after).catch(() => {});
            const before = frames.findLast(frame => frame.time - take.t0 <= begin)?.file;
            const message = `${item.id} step ${index + 1} ${JSON.stringify(step)}: ${error.message}`;
            const file = path.join(work, `${item.id}.failed.jpg`);
            await m.beforeAfter({ before, after, message, file }).catch(() => {});
            steps.push({ scene: item.id, index: index + 1, label: m.stepLabel(step), start: begin, end: failedAt, failed: error.message });
            keepRecording(item.id);
            throw new Error(`${message}\n  the page before and after the step: ${file}`);
          }
        }
        // The scene lasts until its sentence is spoken (sped-up waits count at their output length).
        const rest = needed - (m.now() - start - session.saved(start));
        if (rest > 0) await pause(rest * 1000);
        else if (needed && rest < -0.15 && next) console.warn(`  ${item.id}: ran ${(-rest).toFixed(2)} s over; the next sentence starts that much later`);
        console.log(`${item.id}: ${(m.now() - start).toFixed(1)} s recorded${needed ? `, sentence ${needed.toFixed(1)} s` : ''}`);
      }
      await pause(recipe.end ?? 400);
      const last = await still(session, 'last.png');
      await cdp.send('Page.stopScreencast');
      await cdp.detach().catch(() => {});
      const foreign = await page.evaluate(() => window.__docClipPointer.foreign);
      if (foreign) console.warn(`WARNING ${foreign} pointer events did not come from the script – the real mouse crossed the browser window.`);
      if (session.errors.length) console.warn(`Page errors: ${[...new Set(session.errors)].join(' | ')}`);
      const recording = keepRecording();

      // One picture per step: the frame at its end.
      const items = steps.map(step => ({ file: frames.findLast(frame => frame.time - take.t0 <= step.end + 0.1)?.file,
        label: `${step.scene} ${step.index} ${step.label}` }));
      const sheets = await m.contactSheet(items, path.join(work, 'scenes.jpg'));
      if (sheets) console.log(`scenes: ${items.length} pictures in ${sheets.map(sheet => path.relative(process.cwd(), sheet)).join(', ')}`);

      if (session.headless) {
        const camera = m.cameraPath(take.camera, restCamera)(recording.end);
        await m.saveCheckpoint({ name: recipe.checkpoint ?? recipe.name, page, profile: session.profile, close: session.close, lastPng: last,
          state: await checkpointState(session, camera) });
      }
      return recording;
    } finally {
      await session.close();
    }
  }

  fs.mkdirSync(work, { recursive: true });
  const narration = recipe.audio ? await m.recordedNarration(recipe, work, path.dirname(path.resolve(recipeFile)))
    : voice === 'none' || args.includes('--setup-only') ? m.estimatedNarration(recipe.scenes) : await m.narrate(recipe, work, { voice });
  const recordingFile = path.join(work, 'recording.json');
  const recording = args.includes('--recut') ? JSON.parse(fs.readFileSync(recordingFile, 'utf8')) : await record(narration);
  if (recording.checkpoint) return recording;
  const output = path.join(out, `${recipe.name}.mp4`);
  const music = recipe.music && { ...recipe.music, file: path.resolve(path.dirname(path.resolve(recipeFile)), recipe.music.file) };
  const result = await m.cutTutorial({ recording, narration, output, workDir: work, lead, captions: recipe.captions, music,
    ...recipe.output });
  const speed = m.timeMap(recording.fast);
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
