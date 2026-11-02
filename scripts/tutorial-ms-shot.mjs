// A full-screen shot in a tutorial's cut: a clip exported from MasterSelects (the finished effect at full quality) laid
// over the screen recording. For the hook and the payoff only: most of a tutorial shows the whole editor.
//
//   node scripts/tutorial-ms-shot.mjs <video file> --at <timeline s> [--from <s in the file>] [--to <s in the file>]
//   node scripts/tutorial-ms-shot.mjs --clear       takes all shots out again (before a retake moves the parts)
//
//   [--editor <origin>] [--tab <tabId>]   the cut editor, see scripts/tutorial-ms-cut.mjs
//
// The stack of video tracks, bottom first: Picture, Preview (scripts/tutorial-ms-preview.mjs), Result (these shots),
// Captions. A new video track always goes on top, so the order of creation is the order of the stack: run this, or
// tutorial-ms-preview.mjs, once before the first part goes in; a project that already holds captions refuses it.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TRACKS, cutEditor } from './tutorial-ms-cut.mjs';

export const PREVIEW_TRACK = 'Preview';
export const RESULT_TRACK = 'Result';
const VALUED = ['--at', '--from', '--to', '--editor', '--tab'];
const option = (args, name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };

/** The tracks above the picture, created in the order of the stack: { preview, result } track ids. */
export async function ensureOverlayTracks(call) {
  let state = await call('getTimelineState');
  const find = name => state.videoTracks.find(track => track.name === name);
  if (find(PREVIEW_TRACK) && find(RESULT_TRACK)) return { preview: find(PREVIEW_TRACK).id, result: find(RESULT_TRACK).id };
  if (find(TRACKS.captions)?.clips.length) {
    throw new Error(`the track "${TRACKS.captions}" holds clips, and new tracks would cover them: make the overlay tracks before the first part goes in`);
  }
  if (find(TRACKS.captions)) await call('deleteTrack', { trackId: find(TRACKS.captions).id });
  for (const name of [TRACKS.picture, PREVIEW_TRACK, RESULT_TRACK]) {
    if (!find(name)) await call('createTrack', { type: 'video', name });
  }
  await call('createTrack', { type: 'video', name: TRACKS.captions });
  state = await call('getTimelineState');
  console.log(`video tracks, top first: ${state.videoTracks.map(track => track.name).join(', ')}`);
  return { preview: find(PREVIEW_TRACK).id, result: find(RESULT_TRACK).id };
}

export async function main(args) {
  const call = await cutEditor(option(args, '--editor'), option(args, '--tab'));
  if (args.includes('--clear')) {
    const state = await call('getTimelineState');
    const clips = state.videoTracks.find(track => track.name === RESULT_TRACK)?.clips ?? [];
    for (const clip of clips) await call('deleteClip', { clipId: clip.id });
    console.log(`${clips.length} shots taken out`);
    return;
  }
  const { result: trackId } = await ensureOverlayTracks(call);
  if (args.includes('--tracks')) return;
  const file = args.find((arg, index) => !arg.startsWith('--') && !VALUED.includes(args[index - 1]));
  const at = Number(option(args, '--at'));
  if (!file || !Number.isFinite(at)) throw new Error('Usage: tutorial-ms-shot.mjs <video file> --at <timeline s> [--from <s>] [--to <s>] | --tracks | --clear');
  const placed = await call('importLocalFiles', { paths: [path.resolve(file).replace(/\\/g, '/')], addToTimeline: true, trackId, startTime: at }, { timeoutMs: 120000 });
  const clipId = placed.placedClips?.[0]?.clipId;
  if (!clipId) throw new Error(`the shot was not placed: ${JSON.stringify(placed.errors ?? placed).slice(0, 300)}`);
  const from = option(args, '--from'), to = option(args, '--to');
  if (from !== undefined || to !== undefined) {
    const length = (await call('getTimelineState')).videoTracks.flatMap(track => track.clips).find(clip => clip.id === clipId).duration;
    const inPoint = Number(from ?? 0), outPoint = Math.min(Number(to ?? length), length);
    // trimClip needs both ends and refuses a range that changes nothing.
    if (inPoint > 0 || outPoint < length - 0.001) await call('trimClip', { clipId, inPoint, outPoint });
  }
  console.log(`shot ${path.basename(file)} at ${at.toFixed(2)} s on "${RESULT_TRACK}"`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2)).catch(error => {
    console.error(`tutorial-ms-shot: ${error.message}`);
    process.exit(1);
  });
}
