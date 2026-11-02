// Roman's rule for takes: while the timeline plays, the preview must keep up. A take whose preview shows fewer than
// MIN_PREVIEW_FPS new pictures per second for longer than a second is not good; the cause is fixed before the part
// goes on. The editor's own stats average over seconds and missed gaps of 150–230 ms (2026-10-26), so the watch
// counts what the recording itself shows: the screencast frames in which the preview area changed.
import { spawnSync } from 'node:child_process';

export const MIN_PREVIEW_FPS = 16;
export const SLOW_HOLD_SECONDS = 1;
const SMALL = { width: 64, height: 36 };

/** Page side, every 250 ms during a take: is the timeline playing, and where is the preview canvas. */
export function previewView() {
  const pane = document.querySelector('.dock-tab-pane[data-group-id="preview-group"]');
  const box = pane?.querySelector('canvas')?.getBoundingClientRect();
  const playing = Boolean(document.querySelector('.dock-tab-pane[data-group-id="timeline-group"] button[aria-label="Pause"]'));
  const playhead = window.__timelineStoreModule?.useTimelineStore?.getState?.().playheadPosition ?? null;
  return { playing, playhead, box: box && box.width > 0 ? { x: box.x, y: box.y, width: box.width, height: box.height } : null };
}

/**
 * The stretches in which the timeline really played through, from the previewView samples of a take: [{ from, to,
 * playhead, box }], with `from`/`to` in take seconds and `playhead` the timeline time at `from`. A jump (a loop, a seek)
 * starts a new stretch; a hold while the editor prepares stays in it, and the playhead counts back from where it ran.
 * scripts/tutorial-ms-preview.mjs lays the export over them.
 */
export function previewRuns(samples, { tolerance = 0.3, minSeconds = 0.4 } = {}) {
  const runs = [];
  let run = null;
  for (const sample of samples) {
    const offset = sample.playing && typeof sample.playhead === 'number' ? sample.playhead - sample.t : null;
    if (offset === null) { run = null; continue; }
    if (run && Math.abs(offset - run.offset) <= tolerance) {
      run.to = sample.t;
      run.offset = offset;
      continue;
    }
    run = { from: sample.t, to: sample.t, offset, box: sample.box ?? null };
    runs.push(run);
  }
  return runs.filter(item => item.to - item.from >= minSeconds)
    .map(({ from, to, offset, box }) => ({ from, to, playhead: from + offset, box }));
}

/**
 * Lets a stretch begin earlier where the preview is black in the recording: after a seek on the ruler, and in the first
 * moments of a part (the reopened editor has not drawn yet). Those moments are covered with the pictures before the playhead.
 */
export function withLeadIn(runs, steps = [], { maxSeconds = 3, startSeconds = 1.5 } = {}) {
  return runs.map((run, index) => {
    const previousEnd = index ? runs[index - 1].to : 0;
    const seek = steps.filter(step => /^click ruler:/.test(step.label ?? '')
      && step.end <= run.from && run.from - step.end <= maxSeconds && step.end >= previousEnd).at(-1);
    // A step ends a moment after its click took effect.
    const begin = seek ? Math.max(seek.start ?? 0, seek.end - 0.3) : (!index && run.from <= startSeconds ? 0 : run.from);
    return { ...run, from: begin, playhead: run.playhead - (run.from - begin) };
  });
}

/** The times (take seconds) of the frames in which the preview area changed, from a small grey copy of each frame. */
export function previewChanges(frames, box, { threshold = 0.35 } = {}) {
  if (!frames.length || !box) return [];
  const crop = [box.width, box.height, box.x, box.y].map(value => Math.max(0, Math.round(value))).join(':');
  const list = frames.map(frame => `file 'file:${frame.file.replace(/'/g, "'\\''")}'\nduration 0.04`).join('\n');
  const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'concat', '-safe', '0', '-i', 'pipe:0',
    '-vf', `crop=${crop},scale=${SMALL.width}:${SMALL.height},format=gray`, '-f', 'rawvideo', '-'], { input: list, maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`preview watch: ffmpeg could not read the frames: ${result.stderr}`);
  const size = SMALL.width * SMALL.height, pictures = Math.min(frames.length, Math.floor(result.stdout.length / size));
  const changes = [];
  for (let index = 1; index < pictures; index++) {
    let sum = 0;
    for (let pixel = 0; pixel < size; pixel++) sum += Math.abs(result.stdout[index * size + pixel] - result.stdout[(index - 1) * size + pixel]);
    if (sum / size > threshold) changes.push(frames[index].time);
  }
  return changes;
}

/** The playing stretches of a take, [{ from, to }] in take seconds, from the 250 ms view samples. */
export function playingStretches(samples) {
  const stretches = [];
  for (const sample of samples) {
    const last = stretches.at(-1);
    if (sample.playing && last && last.open) last.to = sample.t;
    else if (sample.playing) stretches.push({ from: sample.t, to: sample.t, open: true });
    else if (last) last.open = false;
  }
  return stretches.map(({ from, to }) => ({ from, to })).filter(stretch => stretch.to - stretch.from >= SLOW_HOLD_SECONDS);
}

/**
 * Where the preview showed fewer than `minFps` new pictures within one second while playing: [{ from, to, fps }] in
 * take seconds, from a one-second window sliding in 0.1 s steps, overlapping windows merged.
 */
export function slowPreview(changes, playing, { minFps = MIN_PREVIEW_FPS, window = SLOW_HOLD_SECONDS } = {}) {
  const slow = [];
  for (const stretch of playing) {
    // The first half second after Play is the decoder's warm-up, not a stutter of the part.
    for (let start = stretch.from + 0.5; start + window <= stretch.to + 1e-9; start += 0.1) {
      const fps = changes.filter(time => time >= start && time < start + window).length / window;
      if (fps >= minFps) continue;
      const last = slow.at(-1);
      if (last && start <= last.to + 1e-9) Object.assign(last, { to: start + window, fps: Math.min(last.fps, fps) });
      else slow.push({ from: start, to: start + window, fps });
    }
  }
  return slow;
}

/**
 * The watch of one take: `samples` from previewView every 250 ms ({ t, playing, box }), `frames` the screencast frames
 * ({ file, time } in take seconds). Each playing stretch is read with the preview box it started with.
 */
export function watchTake(samples, frames) {
  const changes = [], judged = [];
  for (const stretch of playingStretches(samples)) {
    const box = samples.find(sample => sample.t >= stretch.from && sample.box)?.box;
    const seen = previewChanges(frames.filter(frame => frame.time >= stretch.from - 0.05 && frame.time <= stretch.to + 0.05), box);
    // A preview that never changes plays still content (a still, a paused clip): nothing can stutter there.
    if (seen.length <= 1) continue;
    changes.push(...seen);
    judged.push(stretch);
  }
  return slowPreview(changes, judged);
}
