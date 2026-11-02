// A smooth preview in a tutorial's cut. While Chrome's screencast records a take, the editor renders at full speed but
// few of the preview's pictures reach the recording (measured 2026-11-02: 30+ fps in the editor, 1-20 new pictures per
// second in the frames). So the preview area of the recording is covered with an export of the same timeline from
// MasterSelects, laid exactly over it and in time with the playhead of the take: the whole editor stays in view.
//
//   node scripts/tutorial-ms-preview.mjs <part recipe | name> <export file> --export-start <timeline s of its first frame>
//       [--out <folder>] [--editor <origin>] [--tab <tabId>]
//
// The stretches come from the take's recording.json (previewRuns in scripts/tutorialPreviewWatch.mjs); the part must be
// in the cut already. The camera must rest on the whole editor while the timeline plays: a stretch under a zoom is left
// out, and it says so. The clips go on the track "Preview", between "Picture" and "Result".
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TRACKS, cutEditor } from './tutorial-ms-cut.mjs';
import { ensureOverlayTracks } from './tutorial-ms-shot.mjs';
import { previewRuns, withLeadIn } from './tutorialPreviewWatch.mjs';
import { cameraPath, timeMap } from './tutorialCut.mjs';

const VALUED = ['--export-start', '--out', '--editor', '--tab'];
const option = (args, name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };

function videoInfo(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-show_entries', 'format=duration', '-of', 'json', file]);
  if (result.status !== 0) throw new Error(`no video at ${file}`);
  const info = JSON.parse(result.stdout.toString());
  return { width: Number(info.streams[0].width), duration: Number(info.format.duration) };
}

/** Where an export goes in the timeline: [{ at, inPoint, outPoint, box }], `at` in seconds of the part's picture. */
export function previewPlacements(runs, { exportStart, exportDuration, toOutput, zoomAt = () => 1 }) {
  const placements = [], skipped = [];
  for (const run of runs) {
    const wanted = { inPoint: run.playhead - exportStart, outPoint: run.playhead - exportStart + (run.to - run.from) };
    const inPoint = Math.max(0, wanted.inPoint), outPoint = Math.min(exportDuration, wanted.outPoint);
    if (outPoint - inPoint < 0.2) { skipped.push({ ...run, reason: 'outside the export' }); continue; }
    if (zoomAt(run.from) > 1.01 || zoomAt(run.to) > 1.01) { skipped.push({ ...run, reason: 'under a zoom' }); continue; }
    if (outPoint !== wanted.outPoint) skipped.push({ ...run, reason: 'ends after the export' });
    // A lead-in reaching back before the export is filled with its first pictures: nobody reads them, a black preview they would.
    const missing = inPoint - wanted.inPoint;
    if (missing >= 0.05) placements.push({ at: toOutput(run.from), inPoint: 0, outPoint: Math.min(missing, exportDuration), box: run.box });
    placements.push({ at: toOutput(run.from + missing), inPoint, outPoint, box: run.box });
  }
  return { placements, skipped };
}

export async function main(args) {
  const [part, file] = args.filter((arg, index) => !arg.startsWith('--') && !VALUED.includes(args[index - 1]));
  const exportStart = Number(option(args, '--export-start'));
  if (!part || !file || !Number.isFinite(exportStart)) throw new Error('Usage: tutorial-ms-preview.mjs <part> <export file> --export-start <s>');
  const name = path.basename(part, '.json');
  const out = path.resolve(option(args, '--out', path.join(import.meta.dirname, '..', 'tutorial-videos')));
  const recording = JSON.parse(fs.readFileSync(path.join(out, `${name}.work`, 'recording.json'), 'utf8'));
  if (!recording.views) throw new Error(`${name}: this take has no playhead samples; take it again`);
  const call = await cutEditor(option(args, '--editor'), option(args, '--tab'));
  const state = await call('getTimelineState');
  const picture = state.videoTracks.find(track => track.name === TRACKS.picture)?.clips.find(clip => clip.name === `${name}.mp4`);
  if (!picture) throw new Error(`${name} is not in the cut: run tutorial-ms-cut.mjs first`);
  const { width: exportWidth, duration: exportDuration } = videoInfo(file);
  const { width: takeWidth, height: takeHeight } = recording.viewport;
  const rest = { cx: takeWidth / 2, cy: takeHeight / 2, zoom: 1 };
  const camera = cameraPath(recording.camera ?? [], rest);
  const { placements, skipped } = previewPlacements(withLeadIn(previewRuns(recording.views), recording.steps), {
    exportStart, exportDuration, toOutput: timeMap(recording.fast).toOutput, zoomAt: time => camera(time).zoom,
  });
  for (const item of skipped) console.warn(`  NOTE: stretch ${item.from.toFixed(1)}–${item.to.toFixed(1)} s (playhead ${item.playhead.toFixed(1)}): ${item.reason}`);
  const { preview: trackId } = await ensureOverlayTracks(call);
  const { activeCompositionId } = await call('getTimelineState');
  const composition = ((await call('getMediaItems', { recursive: true })).compositions ?? []).find(item => item.id === activeCompositionId);
  const base = composition.width / takeWidth;
  for (const placement of placements) {
    if (!placement.box) continue;
    const at = picture.startTime + placement.at;
    const placed = await call('importLocalFiles', { paths: [path.resolve(file).replace(/\\/g, '/')], addToTimeline: true, trackId, startTime: at }, { timeoutMs: 120000 });
    const clipId = placed.placedClips?.[0]?.clipId;
    if (!clipId) throw new Error(`the preview clip was not placed: ${JSON.stringify(placed.errors ?? placed).slice(0, 300)}`);
    await call('trimClip', { clipId, inPoint: placement.inPoint, outPoint: placement.outPoint });
    const { box } = placement;
    await call('setTransform', {
      clipId,
      x: (box.x + box.width / 2 - takeWidth / 2) * base,
      y: (box.y + box.height / 2 - takeHeight / 2) * base,
      scaleX: (box.width * base) / exportWidth,
      scaleY: (box.width * base) / exportWidth,
    });
    console.log(`  preview ${placement.inPoint.toFixed(2)}–${placement.outPoint.toFixed(2)} s of ${path.basename(file)} at ${at.toFixed(2)} s`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2)).catch(error => {
    console.error(`tutorial-ms-preview: ${error.message}`);
    process.exit(1);
  });
}
