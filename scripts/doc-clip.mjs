// Docs clips: short muted MP4 loops (with a WebP poster) for the feature docs, made in the real
// editor of this checkout, in a throwaway project per clip (hardware-GPU Chrome, own profile).
//
//   node scripts/doc-clip.mjs scripts/doc-clips/analog.json [--only <name>[,<name>...]] [--url http://localhost:5192]
//       [--media <folder>] [--out <folder>] [--keep <folder> [--reencode]]
//
// --keep keeps the editor exports and screencast frames there; with --reencode a clip whose exports
// or recording are already kept is only encoded again (layout, crop, loop, poster or size changes
// need no browser).
// Prints the docs <figure> of every clip. The shot file is { "out", "source", "clips": [clip, ...] };
// "out" (default docs/Features/assets/clips) holds <name>.mp4 and <name>.webp (the poster). Media
// ("source", per clip or for all) is a file name looked up in --media, $DOC_CLIP_MEDIA, the footage folder of
// scripts/docShotSettings.mjs (tests/browser/effect-lab/footage: dancer_stage_motion.mp4) and the test images,
// or a path. Effect clips render in the docs frame of the settings (1920 × 1080) whatever the footage size,
// so `crop` is in its pixels. Each clip is recorded in scripts/docs-media-manifest.json (scripts/docs-media.mjs).
//
// Effect clip – the clip on the timeline with an effect, exported by the editor (debugExport →
// FrameExporter, the export panel's own path) and made into a loop:
//   effect, params   effect id and parameters on top of its defaults
//   range            [start, end] timeline seconds exported (default: the whole source)
//   loop             seconds of crossfade from the end into the start (default 0.5; 0: plain cut)
//   layout           single (default) | pair (original | effect) | compare (original | effect without a
//                    gap, for a docs compare slider) | split (original left, effect right of `split`,
//                    default 0.5) | detail (crop | `zoom`× detail at `detail` [x, y])
//   crop             [x, y, w, h] px of the exported frame; width (output px, default 960), gap (6)
//   fps, exportFps (both default to the source's), maxBytes (default 1.5 MB), crf (start value,
//   default 20), poster (seconds into the clip)
//   sweep            a control clip: { param, label, from, to, unit, decimals } keys the parameter
//                    from → to → from over the range (a cosine, so it eases at both ends) and burns
//                    the current value in, small ("Band Size 22 px"); { param, label, steps: [values] }
//                    holds each value for an equal share instead (for Speed: keyframing a speed makes
//                    the timeline-clock wave jump, so steps show each speed as it is); a control clip
//                    stays within 8 s and, by default, 700 KB
// Presets clip ("kind": "presets") – every preset the effect declares (read from the registry, in
//   card order) exported over the same `range` and laid out as a labelled grid, in sync:
//   effect, range, crop, width (whole grid, default 960), columns (default 2 for four), gap, loop,
//   maxBytes, crf, poster
// Operation clip ("kind": "operation") – a screen recording of the editor with a visible pointer:
//   playhead, effects [{ effect, params }] already on the clip, viewport { width, height }, scale
//   (device pixels per CSS px, default 2), dock { "<split id>": ratio } (DockLayout split ratios),
//   panels  dock groups shown ("preview-group", "right-group"), pad (CSS px around them)
//   frame   instead of panels: the union of these boxes, e.g. ["row:Band Size", "preview:0,0.2,1,0.8"]
//           (a card row by its label; the preview canvas, or the part x0,y0,x1,y1 of it, 0–1)
//   start   where the pointer rests first ("preview:0.8,0.8" or another step target)
//   steps   { "move": target } | { "click": target } | { "type": "glitch" } | { "pause": ms }
//           | { "drag": "<row label>", "to": value or [values] }; "ms" sets a move's duration.
//           Targets: the exact visible text ("+ Add Effect", "Glitch"), "slider:<row label>",
//           "preview:<x>,<y>" (0–1) or "@<x>,<y>" (CSS px)
//   width (default 1280), fps (30), maxBytes (default 1.5 MB), poster, jpegQuality (screencast, 88)
//   Keep the real mouse away from the browser window while it records: the script warns when
//   pointer events arrived that it did not send.
// Both: alt, caption, float ("left" | "right") go into the printed figure.
// Needs a Vite of this checkout (`npx vite --port 5192 --strictPort`) and ffmpeg.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { humanMouse } from './docClipPointer.mjs';
import { applyEditorTheme, docLogicalPath, docOutput, docShotSettings, findMedia, mediaDirs } from './docShotSettings.mjs';
import { recordShotList } from './docsMediaRecipes.mjs';
import { ORIGINAL_LAYOUTS, encodeEffectClip, encodePresetGrid, encodeRecording, probeVideo, sweepValue } from './docClipVideo.mjs';

const args = process.argv.slice(2);
const valued = ['--only', '--url', '--media', '--out', '--keep'];
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const shotFile = args.find((arg, index) => !arg.startsWith('--') && !valued.includes(args[index - 1]));
if (!shotFile) throw new Error('Name a shot file, e.g. scripts/doc-clips/analog.json');
const shotList = JSON.parse(fs.readFileSync(shotFile, 'utf8'));
const only = option('--only')?.split(',').map(name => name.trim()).filter(Boolean);
const clips = shotList.clips.filter(clip => !only || only.includes(clip.name));
const unknown = (only ?? []).filter(name => !clips.some(clip => clip.name === name));
if (unknown.length || !clips.length) throw new Error(`No clip named ${unknown.join(', ') || only} in ${shotFile}`);
const url = option('--url', 'http://localhost:5192').replace(/\/$/, '');
const out = docOutput(option('--out', shotList.out ?? 'docs/Features/assets/clips'));
const settings = docShotSettings();
const keep = option('--keep');
const reencode = args.includes('--reencode');
if (reencode && !keep) throw new Error('--reencode needs --keep <folder> with earlier exports');
const launchArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,VulkanFromANGLE', '--use-angle=vulkan',
  '--ignore-gpu-blocklist', '--window-position=0,0', '--autoplay-policy=no-user-gesture-required'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function mediaPath(name) {
  if (!name) throw new Error('No "source" media named for the clip or the shot file');
  const found = findMedia(name, { media: option('--media') });
  if (!found) throw new Error(`Media ${name} not found; pass --media <folder> (searched ${mediaDirs({ media: option('--media') }).join(', ')})`);
  return found;
}

/** A fresh project with the media on the timeline; returns the editor tool caller and the clip. */
async function openProject(page, media) {
  const tool = async (name, input) => {
    const result = await page.evaluate(([toolName, toolInput]) => window.aiTools.execute(toolName, toolInput), [name, input]);
    if (!result?.success) throw new Error(`${name}: ${result?.error ?? 'failed'}`);
    return result.data;
  };
  await page.goto(`${url}/editor`);
  await page.getByRole('button', { name: /New project/ }).click({ timeout: 60000 });
  await page.locator('form input').first().fill('Docs clip');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'End walkthrough' }).click({ timeout: 10000 }).catch(() => {});
  await applyEditorTheme(page, settings.theme);
  await page.setInputFiles('#media-panel-import-input', media);
  let item;
  for (let attempt = 0; attempt < 240 && !item; attempt += 1) {
    item = (await tool('getMediaItems', {})).files?.find(file => !file.isImporting);
    if (!item) await pause(250);
  }
  if (!item) throw new Error(`${path.basename(media)} was not imported`);
  const duration = item.duration ?? 5;
  // The footage fills the docs frame whatever its size (the 720p footage in the repository scales up 1.5×),
  // so a recipe's crop and an effect's pixel sizes read the same on any footage.
  const added = await tool('addClipSegment', { mediaFileId: item.id, trackId: null, startTime: 0, inPoint: 0, outPoint: duration, visualScaleMode: 'fill' });
  return { tool, item, clipId: added.clips[0].id, duration };
}

/** Exports [start, end] through the editor's FrameExporter in the docs frame and saves the download. */
async function exportRange(page, { start, end, fps }, file) {
  const download = page.waitForEvent('download', { timeout: 300000 });
  const result = await page.evaluate(input => window.aiTools.execute('debugExport', input), {
    startTime: start, endTime: end, width: settings.frame.width, height: settings.frame.height, fps, includeAudio: false,
    codec: 'h264', container: 'mp4', bitrate: 40_000_000, download: true, maxRuntimeMs: 280000 });
  if (!result?.success) throw new Error(`Export failed: ${result?.error} ${JSON.stringify(result?.data?.errors ?? []).slice(0, 400)}`);
  await (await download).saveAs(file);
  const probe = probeVideo(file);
  const expected = Math.round((end - start) * fps);
  if (Math.abs(probe.frames - expected) > 1) throw new Error(`${path.basename(file)}: ${probe.frames} frames, expected ${expected}`);
  return file;
}

async function effectClip(page, clip, work) {
  const { tool, item, clipId, duration } = await openProject(page, mediaPath(clip.source ?? shotList.source));
  const [start, end] = clip.range ?? [0, duration];
  const range = { start, end, item, fps: clip.exportFps ?? item.fps ?? 30 };
  const original = ORIGINAL_LAYOUTS.includes(clip.layout)
    ? await exportRange(page, range, path.join(work, `${clip.name}.original.mp4`)) : undefined;
  const added = await tool('addEffect', { clipId, effectType: clip.effect, params: clip.params ?? {} });
  for (const note of [added?.warnings, added?.notes, added?.paramWarnings].flat().filter(Boolean)) console.log(`${clip.name}: ${JSON.stringify(note)}`);
  if (clip.sweep) await tool('addKeyframe', { clipId, effectId: added.effectId, keys: { [clip.sweep.param]: sweepKeys(clip.sweep, start, end) } });
  await pause(1000);
  const effect = await exportRange(page, range, path.join(work, `${clip.name}.effect.mp4`));
  return encodeEffectClip(clip, { effect, original, output: path.join(out, `${clip.name}.mp4`), poster: path.join(out, `${clip.name}.webp`) });
}

/**
 * Keyframes of a control clip over [start, end] (clip time = timeline time, the clip starts at 0):
 * the cosine sweep every 0.1 s, linear in between, or one held value per step.
 */
function sweepKeys(sweep, start, end) {
  const duration = end - start;
  if (sweep.steps) return sweep.steps.map((value, index) => [start + index * duration / sweep.steps.length, value, 'hold']);
  const { at } = sweepValue(sweep, duration), count = Math.ceil(duration / 0.1);
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = Math.min(duration, index * 0.1);
    return [start + t, Math.round(at(t) * 1e4) / 1e4, 'linear'];
  });
}

/** Every preset of the effect over the same range, one export each, then the labelled grid. */
async function presetsClip(page, clip, work) {
  const { tool, item, clipId, duration } = await openProject(page, mediaPath(clip.source ?? shotList.source));
  const [start, end] = clip.range ?? [0, duration];
  const range = { start, end, item, fps: clip.exportFps ?? item.fps ?? 30 };
  const presets = await page.evaluate(async id => (await import('/src/effects/index.ts')).getEffect(id)?.presets
    ?.map(preset => ({ name: preset.name, params: preset.params })), clip.effect);
  if (!presets?.length) throw new Error(`${clip.name}: ${clip.effect} declares no presets`);
  const exports = [];
  for (const [index, preset] of presets.entries()) {
    // A fresh effect per preset: the preset's values on top of the defaults, as the Preset row sets them.
    const added = await tool('addEffect', { clipId, effectType: clip.effect, params: preset.params });
    await pause(1000);
    exports.push({ file: await exportRange(page, range, path.join(work, `${clip.name}.preset-${index}.mp4`)), label: preset.name });
    await tool('removeEffect', { clipId, effectId: added.effectId });
  }
  fs.writeFileSync(path.join(work, `${clip.name}.presets.json`), JSON.stringify(exports));
  console.log(`${clip.name}: presets ${presets.map(preset => preset.name).join(', ')}`);
  return encodePresetGrid(clip, { exports, output: path.join(out, `${clip.name}.mp4`), poster: path.join(out, `${clip.name}.webp`) });
}

async function operationClip(page, clip, work, viewport) {
  const { tool, clipId } = await openProject(page, mediaPath(clip.source ?? shotList.source));
  for (const extra of clip.effects ?? []) await tool('addEffect', { clipId, effectType: extra.effect, params: extra.params ?? {} });
  await tool('selectClips', { clipIds: [clipId] });
  await tool('setPlayhead', { time: clip.playhead ?? 1 });
  await page.evaluate(async ratios => {
    const { useDockStore } = await import('/src/stores/dockStore/index.ts');
    for (const [id, ratio] of Object.entries(ratios)) useDockStore.getState().setSplitRatio(id, ratio);
  }, clip.dock ?? {});
  await page.getByRole('tab', { name: 'Properties' }).first().click();
  await page.locator('button').filter({ hasText: /^Effects/ }).first().click();
  await page.mouse.move(viewport.width / 2, viewport.height - 4);
  await pause(2500);
  const crop = await page.evaluate(({ panels, frame, pad }) => {
    // A card row: the nearest ancestor of its label that holds the row's slider or select.
    const row = label => {
      const words = [...document.querySelectorAll('.properties-panel *, [data-group-id="right-group"] *')].filter(element => element.textContent.trim() === label
        && ![...element.children].some(child => child.textContent.trim() === label));
      for (let element of words) {
        while (element && !element.querySelector('.handle-only-range, select, [role="combobox"]')) element = element.parentElement;
        if (element) return element.getBoundingClientRect();
      }
      return undefined;
    };
    const preview = part => {
      const canvas = [...document.querySelectorAll('[data-group-id="preview-group"] canvas')]
        .toSorted((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (!canvas) return undefined;
      const rect = canvas.getBoundingClientRect(), [x0, y0, x1, y1] = part ? part.split(',').map(Number) : [0, 0, 1, 1];
      return { left: rect.left + x0 * rect.width, top: rect.top + y0 * rect.height, right: rect.left + x1 * rect.width, bottom: rect.top + y1 * rect.height };
    };
    const boxes = frame ? frame.map(target => target.startsWith('row:') ? row(target.slice(4)) : target.startsWith('preview') ? preview(target.split(':')[1]) : undefined)
      : panels.map(id => document.querySelector(`.dock-tab-pane[data-group-id="${id}"]`)?.getBoundingClientRect());
    if (boxes.some(box => !box)) return { missing: (frame ?? panels).filter((_, index) => !boxes[index]) };
    return { left: Math.max(0, Math.min(...boxes.map(box => box.left)) - pad), top: Math.max(0, Math.min(...boxes.map(box => box.top)) - pad),
      right: Math.min(innerWidth, Math.max(...boxes.map(box => box.right)) + pad), bottom: Math.min(innerHeight, Math.max(...boxes.map(box => box.bottom)) + pad) };
  }, { panels: clip.panels ?? ['preview-group', 'right-group'], frame: clip.frame, pad: clip.pad ?? 0 });
  if (crop.missing) throw new Error(`${clip.name}: nothing visible for ${crop.missing.join(', ')}`);

  const start = await page.evaluate(() => ({ x: innerWidth / 2, y: innerHeight / 2 }));
  const mouse = await humanMouse(page, start);
  if (clip.start) await mouse.glide(await mouse.locate(clip.start), { ms: 1 });
  await pause(800);

  // Screencast: a frame whenever the page changes, with its time; encodeRecording evens them out.
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const frameDir = path.join(work, `${clip.name}.frames`);
  fs.mkdirSync(frameDir, { recursive: true });
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = path.join(frameDir, `${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, time: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: clip.jpegQuality ?? 88, everyNthFrame: 1 });
  await pause(400);
  for (const step of clip.steps ?? []) {
    try {
      if (step.pause) await pause(step.pause);
      else if (step.move) await mouse.move(step.move, step);
      else if (step.click) await mouse.click(step.click, step);
      else if (step.type) await page.keyboard.type(step.type, { delay: step.delay ?? 120 });
      else if (step.drag) await mouse.drag(step.drag, step.to, step);
      else throw new Error(`unknown step ${JSON.stringify(step)}`);
    } catch (error) {
      // The page as the step found it, so a missing target can be seen instead of guessed.
      const shot = path.join(work, `${clip.name}.failed.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      throw new Error(`${clip.name}: ${error.message} (the page at that moment: ${shot})`);
    }
  }
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  const moves = await mouse.moveStats();
  if (frames.length < 10) throw new Error(`${clip.name}: only ${frames.length} screencast frames`);
  // Chrome sends a frame only when the page changes: long gaps while the pointer moves look choppy.
  const gaps = frames.slice(1).map((frame, index) => frame.time - frames[index].time).toSorted((a, b) => a - b);
  console.log(`${clip.name}: ${frames.length} screencast frames, median gap ${(gaps[gaps.length >> 1] * 1000).toFixed(0)} ms, `
    + `90th percentile ${(gaps[Math.floor(gaps.length * 0.9)] * 1000).toFixed(0)} ms (a still page sends none); pointer moves ${JSON.stringify(moves)}`);
  if (moves.foreign) console.warn(`${clip.name}: WARNING ${moves.foreign} pointer events did not come from the script – the real mouse `
    + 'crossed the browser window. The drawn pointer ignored them, but hover effects may show: check the clip or record it again.');
  const first = probeVideo(frames[0].file), ratio = first.width / viewport.width;
  const offset = frames[0].time;
  const recording = { frames: frames.map(frame => ({ ...frame, time: frame.time - offset })), end: end - offset,
    crop: { x: Math.round(crop.left * ratio), y: Math.round(crop.top * ratio), width: Math.round((crop.right - crop.left) * ratio), height: Math.round((crop.bottom - crop.top) * ratio) } };
  // Kept with the frames, so --reencode can encode the recording again.
  fs.writeFileSync(path.join(work, `${clip.name}.recording.json`), JSON.stringify(recording));
  return encodeRecording(clip, { ...recording, workDir: work, output: path.join(out, `${clip.name}.mp4`), poster: path.join(out, `${clip.name}.webp`) });
}

function figure(clip, size) {
  const src = path.relative(path.resolve('docs/Features'), docLogicalPath(path.join(out, `${clip.name}.mp4`)));
  const float = clip.float ? ` docs-shot--float-${clip.float}` : '';
  const compare = clip.layout === 'compare' ? ' docs-compare' : '';
  const label = (clip.alt ?? clip.name).replace(/"/g, '&quot;');
  return `<figure class="docs-shot docs-clip${compare}${float}">\n<video src="${src}" poster="${src.replace(/\.mp4$/, '.webp')}" width="${size.width}" height="${size.height}" `
    + `autoplay muted loop playsinline preload="none" aria-label="${label}"></video>\n<figcaption>${clip.caption ?? ''}</figcaption>\n</figure>`;
}

function report(clip, result, errors) {
  recordShotList('clip', shotFile, [clip.name], { media: option('--media') });
  const pageErrors = [...new Set(errors)];
  console.log(`\n${path.relative(process.cwd(), path.join(out, `${clip.name}.mp4`))}: ${result.width}x${result.height}, `
    + `${result.duration.toFixed(2)} s at ${Math.round(result.fps)} fps, ${result.size} bytes (CRF ${result.crf}); poster ${result.posterBytes} bytes`
    + `${pageErrors.length ? `; page errors: ${pageErrors.join(' | ')}` : ''}\n`);
  console.log(figure(clip, result));
}

const work = keep ? path.resolve(keep) : fs.mkdtempSync(path.join(os.tmpdir(), 'doc-clip-'));
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(out, { recursive: true });
try {
  // One browser per clip: a fresh project in its own private file system, one GPU device at a time.
  for (const clip of clips) {
    const kept = name => path.join(work, `${clip.name}.${name}.mp4`);
    const files = { output: path.join(out, `${clip.name}.mp4`), poster: path.join(out, `${clip.name}.webp`) };
    const recording = path.join(work, `${clip.name}.recording.json`);
    if (reencode && clip.kind === 'operation' && fs.existsSync(recording)) {
      report(clip, encodeRecording(clip, { ...JSON.parse(fs.readFileSync(recording, 'utf8')), workDir: work, ...files }), []);
      continue;
    }
    const presetList = path.join(work, `${clip.name}.presets.json`);
    if (reencode && clip.kind === 'presets' && fs.existsSync(presetList)) {
      report(clip, encodePresetGrid(clip, { exports: JSON.parse(fs.readFileSync(presetList, 'utf8')), ...files }), []);
      continue;
    }
    if (reencode && !['operation', 'presets'].includes(clip.kind) && fs.existsSync(kept('effect'))) {
      report(clip, encodeEffectClip(clip, { effect: kept('effect'), original: fs.existsSync(kept('original')) ? kept('original') : undefined, ...files }), []);
      continue;
    }
    const viewport = clip.viewport ?? { width: 1600, height: 900 };
    const browser = await chromium.launch({ channel: 'chrome', headless: false, args: [...launchArgs, `--window-size=${viewport.width},${viewport.height + 120}`] });
    try {
      const context = await browser.newContext({ viewport, deviceScaleFactor: clip.kind === 'operation' ? clip.scale ?? 2 : 1, acceptDownloads: true });
      // Project folders come from the browser's private file system instead of the native picker,
      // and the session does not count as product usage.
      await context.addInitScript(() => {
        window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('doc-clip', { create: true });
        Object.defineProperty(Navigator.prototype, 'doNotTrack', { configurable: true, get: () => '1' });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const result = clip.kind === 'operation' ? await operationClip(page, clip, work, viewport)
        : clip.kind === 'presets' ? await presetsClip(page, clip, work) : await effectClip(page, clip, work);
      report(clip, result, errors);
    } finally {
      await browser.close();
    }
  }
} finally {
  if (!keep) fs.rmSync(work, { recursive: true, force: true });
}
