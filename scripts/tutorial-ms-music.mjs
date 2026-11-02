// The tutorial music in an episode's cut, with Roman's fixed cues (scripts/tutorials/README.md, "The music"), as two clips
// on the track "Music" whose volume keyframes can be changed in MasterSelects:
//   intro:  the track from 0:19.6 at the start of the episode: in over 0.4 s, -5 dB until 1.6 s, -9 dB by 2 s, silent at 23 s;
//   ending: the track from 2:26 to its end, ending with the episode: in over 6 s to -10 dB.
// Lower than the recipe cues of the README, because in the cut the levelled voice lies on top and the mix must not clip.
//
//   node scripts/tutorial-ms-music.mjs [--end <episode end, s>] [--music <file>] [--editor <origin>] [--tab <tabId>]
//
// Run it after the last part is cut and tightened, then scripts/tutorial-ms-finish.mjs <episode> --no-music.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TRACKS, cutEditor, ensureTrack } from './tutorial-ms-cut.mjs';

const option = (args, name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const gain = decibels => 10 ** (decibels / 20);
const SILENT = gain(-60);

async function placeCue(call, trackId, music, { at, from, to, volume }) {
  const placed = await call('importLocalFiles', { paths: [music], addToTimeline: true, trackId, startTime: at }, { timeoutMs: 120000 });
  const clipId = placed.placedClips?.[0]?.clipId;
  if (!clipId) throw new Error(`music: not placed (${JSON.stringify(placed.errors ?? placed).slice(0, 200)})`);
  await call('trimClip', { clipId, inPoint: from, outPoint: to });
  const { effectId } = await call('addEffect', { clipId, effectType: 'audio-volume', params: { volume: volume[0][1] } });
  await call('addKeyframe', { clipId, effectId, keys: { volume: volume.map(([time, level]) => [time, level, 'linear']) } });
  console.log(`music: track ${from.toFixed(1)}–${to.toFixed(1)} s at ${at.toFixed(2)} s`);
}

export async function main(args) {
  const call = await cutEditor(option(args, '--editor'), option(args, '--tab'));
  const music = path.resolve(option(args, '--music', path.join(import.meta.dirname, 'tutorials', 'audio', 'tutorial-music.wav'))).replace(/\\/g, '/');
  const state = await call('getTimelineState');
  const end = Number(option(args, '--end', Math.max(0, ...state.videoTracks.flatMap(track => track.clips).map(clip => clip.endTime))));
  const trackLength = Number(option(args, '--length', 164.76));
  if (!end) throw new Error('the open project has no clips: cut the parts in first');
  const trackId = await ensureTrack(call, state, 'audio', TRACKS.music);
  const introLength = Math.min(23, end);
  await placeCue(call, trackId, music, {
    at: 0, from: 19.6, to: 19.6 + introLength,
    // -5 dB instead of the cue's full level: the voice starts here, and the mix peaked at 0 dB.
    volume: [[0, SILENT], [0.4, gain(-5)], [1.6, gain(-5)], [2, gain(-9)], [introLength, SILENT]],
  });
  const endingFrom = 146, endingLength = Math.min(trackLength - endingFrom, end - introLength);
  await placeCue(call, trackId, music, {
    at: end - endingLength, from: endingFrom, to: endingFrom + endingLength,
    volume: [[0, SILENT], [Math.min(6, endingLength), gain(-10)]],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2)).catch(error => {
    console.error(`tutorial-ms-music: ${error.message}`);
    process.exit(1);
  });
}
