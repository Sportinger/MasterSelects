// Shared by tutorial-video.mjs and tutorial-tab.mjs: checkpoints, so a tutorial is recorded piece by piece
// and each part continues exactly where the previous one ended.
//
// A checkpoint is a folder tutorial-videos/checkpoints/<name>/ with
//   profile/          a copy of the headless Chrome profile: the project (OPFS, IndexedDB), the dock layout
//                     and the editor settings (localStorage)
//   checkpoint.json   what a reload loses: playhead, selection, the drawn pointer, the camera, and the
//                     `resume` steps that rebuild views the editor keeps only in memory (the node graph's
//                     source, an expanded group, its zoom)
//   last.png          the last frame, compared with the first frame of the part that continues from it
//
// A take copies the profile of its `from` checkpoint into its work folder and records on that copy, so a
// retake always starts from the clean checkpoint, never from what a failed take left behind. A finished
// take saves its end as a new checkpoint (named after the recipe, or its `checkpoint`).
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', 'tutorial-videos', 'checkpoints');
// Caches are rebuilt by Chrome; locks and the DevTools port belong to a running Chrome.
const skipped = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache', 'GraphiteDawnCache',
  'ShaderCache', 'Crashpad', 'component_crx_cache', 'SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort', 'lockfile']);

export const checkpointDir = name => path.join(root, name);

/** The checkpoint `name`, or an error that lists the ones there are. */
export function readCheckpoint(name) {
  const dir = checkpointDir(name), file = path.join(dir, 'checkpoint.json');
  if (!fs.existsSync(file)) {
    const known = fs.existsSync(root) ? fs.readdirSync(root).filter(entry => fs.existsSync(path.join(root, entry, 'checkpoint.json'))) : [];
    throw new Error(`No checkpoint "${name}" (${file}). Checkpoints: ${known.join(', ') || 'none yet'}`);
  }
  return { ...JSON.parse(fs.readFileSync(file, 'utf8')), dir, profile: path.join(dir, 'profile'), last: path.join(dir, 'last.png') };
}

/** Copies a Chrome profile without its caches and locks; `to` is replaced. Chrome must not be running on `from`. */
export function copyProfile(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  if (!from) { fs.mkdirSync(to, { recursive: true }); return; }
  fs.cpSync(from, to, { recursive: true, filter: source => !skipped.has(path.basename(source)) });
}

/** Page side: the editor state a reload loses, plus a short description of what is on screen. */
export async function readRuntime() {
  const state = (await window.aiTools.execute('getTimelineState', {}))?.data ?? {};
  const tracks = [...(state.videoTracks ?? []), ...(state.audioTracks ?? [])];
  const pane = group => document.querySelector(`.dock-tab-pane[data-group-id="${group}"]`);
  return {
    playhead: state.playheadPosition ?? 0,
    selected: state.selectedClipIds ?? [],
    composition: state.activeCompositionName ?? null,
    playing: Boolean(pane('timeline-group')?.querySelector('button[aria-label="Pause"]')),
    clips: tracks.map(track => `${track.name}: ${track.clips.map(clip => `${clip.name}@${clip.startTime.toFixed(2)}–${(clip.startTime + clip.duration).toFixed(2)}`).join(', ')}`),
    layout: [...document.querySelectorAll('.dock-tab-pane[data-group-id]')].map(element => {
      const rect = element.getBoundingClientRect();
      const tab = element.querySelector('.dock-tab-bar [role="tab"][aria-selected="true"] .dock-tab-title')?.textContent?.trim();
      return `${element.dataset.groupId} ${Math.round(rect.width)}×${Math.round(rect.height)}${tab ? ` (${tab})` : ''}`;
    }),
  };
}

/**
 * Node side: the runtime state for a checkpoint. A playing timeline is paused at the playhead it reached, so the
 * last frame taken after this and the saved playhead agree; `playing` stays true, and the part that continues
 * from the checkpoint plays on when it starts recording.
 */
export async function settleRuntime(page) {
  const runtime = await page.evaluate(readRuntime);
  if (runtime.playing) {
    await page.evaluate(async time => {
      await window.aiTools.execute('pause', {});
      await window.aiTools.execute('setPlayhead', { time });
    }, runtime.playhead);
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  return runtime;
}

/** Page side: brings back playhead and selection (pauses first: a playing project re-renders under every step). */
export async function restoreRuntime({ playhead, selected }) {
  const tools = window.aiTools;
  const pause = document.querySelector('.dock-tab-pane[data-group-id="timeline-group"] button[aria-label="Pause"]');
  if (pause) await tools.execute('pause', {});
  const state = (await tools.execute('getTimelineState', {}))?.data ?? {};
  const known = new Set([...(state.videoTracks ?? []), ...(state.audioTracks ?? [])].flatMap(track => track.clips.map(clip => clip.id)));
  const keep = (selected ?? []).filter(id => known.has(id));
  if (keep.length) await tools.execute('selectClips', { clipIds: keep });
  else await tools.execute('clearSelection', {});
  await tools.execute('setPlayhead', { time: playhead ?? 0 });
  return { missing: (selected ?? []).filter(id => !known.has(id)) };
}

/**
 * Saves a checkpoint from a running headless Chrome: saves the project, writes checkpoint.json and
 * last.png, closes Chrome (which flushes the profile) and copies the profile.
 * state: { runtime (readRuntime), pointer, camera, resume, recipe, origin, viewport }; lastPng: a PNG of
 * the last frame; close: closes the Chrome whose profile is `profile`.
 */
export async function saveCheckpoint({ name, page, profile, close, lastPng, state }) {
  const saved = await page.evaluate(() => window.aiTools.execute('saveProject', {})).catch(error => ({ success: false, error: error.message }));
  if (!saved?.success) console.warn(`checkpoint ${name}: the project did not save (${saved?.error ?? 'no answer'}); its last autosave is kept`);
  await new Promise(resolve => setTimeout(resolve, 800));
  await close();
  const dir = checkpointDir(name);
  fs.mkdirSync(dir, { recursive: true });
  copyProfile(profile, path.join(dir, 'profile'));
  fs.copyFileSync(lastPng, path.join(dir, 'last.png'));
  fs.writeFileSync(path.join(dir, 'checkpoint.json'), `${JSON.stringify({ name, savedAt: new Date().toISOString(), ...state }, null, 1)}\n`);
  console.log(`checkpoint ${name}: ${path.relative(process.cwd(), dir)}`);
  return dir;
}
