// The last step of an episode, in the MasterSelects project its parts were cut into (scripts/tutorial-ms-cut.mjs):
// music under the whole episode, the export from MasterSelects, and a check of the exported file.
//
//   node scripts/tutorial-ms-finish.mjs <episode name>
//       [--music <file>]          default scripts/tutorials/audio/tutorial-music.wav; --no-music leaves the music out
//       [--music-db -22]          the music's level under the voice (dB); it fades in over 0.6 s and out over 2.5 s
//       [--editor <origin>] [--tab <tabId>]   the cut editor, as for tutorial-ms-cut.mjs
//       [--out <folder>]          where the export goes (default tutorial-videos/)
//
// A project started from the template (scripts/tutorial-ms-template.mjs) already holds its music on the audio track
// "Music": it is cut at the episode's end and faded out there. Otherwise, or with --music, the music goes onto that
// track (taken out and put in again on every run), as copies of the file one after another until the episode ends,
// the last one trimmed; its level and fades are keyframes of each clip's
// Volume effect, so they can be changed in MasterSelects. The export is MasterSelects' own (debugExport), saved by
// the browser to ~/Downloads and moved to `<out>/<episode>.<mp4|webm>`. The check prints duration, size, frame rate
// and the audio level, and writes `<out>/<episode>.check.jpg`: eight pictures across the episode.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { TRACKS, cutEditor, ensureTrack } from './tutorial-ms-cut.mjs';

const option = (args, name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const FADE_IN = 0.6, FADE_OUT = 2.5;

/** Where the copies of a `length` s music file go to fill `end` s: [{ at, length }] (the last one trimmed). */
export function musicCopies(length, end) {
  const copies = [];
  for (let at = 0; at < end - 0.05; at += length) copies.push({ at, length: Math.min(length, end - at) });
  return copies;
}

/** The Volume keyframes of one music copy: a level, faded in at the episode's start and out at its end. */
export function musicVolumeKeys(copy, { level, first, last }) {
  const keys = [];
  if (first) keys.push([0, 0, 'linear'], [FADE_IN, level, 'hold']);
  else keys.push([0, level, 'hold']);
  if (last) {
    const fadeFrom = Math.max(keys.at(-1)[0] + 0.1, copy.length - FADE_OUT);
    keys.at(-1)[2] = 'hold';
    keys.push([Number(fadeFrom.toFixed(3)), level, 'linear'], [Number(copy.length.toFixed(3)), 0, 'hold']);
  }
  return keys;
}

/**
 * The music of a template project (already on "Music"): what plays after the episode's end goes, the last clip ends
 * with the episode and fades out from its own level. Returns false when the track holds no music.
 */
async function fitTemplateMusic(call, end) {
  const state = await call('getTimelineState');
  const clips = (state.audioTracks.find(track => track.name === TRACKS.music)?.clips ?? []).toSorted((a, b) => a.startTime - b.startTime);
  if (!clips.length) return false;
  const after = clips.filter(clip => clip.startTime >= end - 0.05);
  if (after.length) await call('deleteClips', { clipIds: after.map(clip => clip.id) });
  const last = clips.filter(clip => clip.startTime < end - 0.05).at(-1);
  if (!last) return false;
  if (last.endTime < end - 0.05) console.warn(`music: the template's music ends at ${last.endTime.toFixed(2)} s, before the episode (${end.toFixed(2)} s)`);
  const length = Math.min(last.endTime, end) - last.startTime;
  if (last.endTime > end + 0.01) await call('trimClip', { clipId: last.id, inPoint: last.inPoint ?? 0, outPoint: (last.inPoint ?? 0) + length });
  const details = await call('getClipDetails', { clipId: last.id });
  const volume = ((details.clip ?? details).effects ?? details.effects ?? []).find(effect => effect.type === 'audio-volume');
  const effectId = volume?.id ?? (await call('addEffect', { clipId: last.id, effectType: 'audio-volume' })).effectId;
  const level = Number(volume?.params?.volume ?? 10 ** (-22 / 20));
  await call('addKeyframe', { clipId: last.id, effectId, keys: { volume: [
    [Number(Math.max(0, length - FADE_OUT).toFixed(3)), level, 'linear'], [Number(length.toFixed(3)), 0, 'hold']] } });
  console.log(`music: the template's music ends with the episode at ${end.toFixed(2)} s, fading out over ${FADE_OUT} s`);
  return true;
}

async function placeMusic(call, file, end, level) {
  let state = await call('getTimelineState');
  const track = await ensureTrack(call, state, 'audio', TRACKS.music);
  state = await call('getTimelineState');
  const old = state.audioTracks.find(item => item.id === track).clips;
  if (old.length) await call('deleteClips', { clipIds: old.map(clip => clip.id) });
  let copies = null;
  for (let index = 0; !copies || index < copies.length; index += 1) {
    const at = copies ? copies[index].at : 0;
    const placed = await call('importLocalFiles', { paths: [file.replace(/\\/g, '/')], addToTimeline: true, trackId: track, startTime: at });
    const clipId = placed.placedClips?.[0]?.clipId;
    if (!clipId) throw new Error(`music: not placed (${JSON.stringify(placed.errors ?? placed).slice(0, 200)})`);
    const details = await call('getClipDetails', { clipId });
    const clip = details.clip ?? details;
    copies ??= musicCopies(clip.duration, end);
    const copy = copies[index];
    if (copy.length < clip.duration - 0.01) await call('trimClip', { clipId, inPoint: clip.inPoint ?? 0, outPoint: (clip.inPoint ?? 0) + copy.length });
    let effectId = (clip.effects ?? details.effects ?? []).find(effect => effect.type === 'audio-volume')?.id;
    effectId ??= (await call('addEffect', { clipId, effectType: 'audio-volume' })).effectId;
    if (!effectId) throw new Error('music: the clip has no Volume effect for its level and fades');
    await call('addKeyframe', { clipId, effectId, keys: { volume: musicVolumeKeys(copy, { level, first: index === 0, last: index === copies.length - 1 }) } });
  }
  console.log(`music: ${copies.length} cop${copies.length === 1 ? 'y' : 'ies'} of ${path.basename(file)} to ${end.toFixed(2)} s at ${(20 * Math.log10(level)).toFixed(0)} dB`);
}

/** The browser's download of `name`, once it is complete (no .crdownload, size settled). */
async function downloaded(name, timeoutMs = 180000) {
  const file = path.join(os.homedir(), 'Downloads', name);
  const until = Date.now() + timeoutMs;
  let size = -1;
  while (Date.now() < until) {
    if (fs.existsSync(file) && !fs.existsSync(`${file}.crdownload`)) {
      const now = fs.statSync(file).size;
      if (now > 0 && now === size) return file;
      size = now;
    }
    await pause(1000);
  }
  throw new Error(`the export was not saved as ${file} within ${timeoutMs / 1000} s (does the browser ask where to save?)`);
}

/** Duration, size, frame rate and audio level of the export, and a sheet of eight pictures across it. */
export function checkExport(file, sheet) {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate',
    '-of', 'json', file], { encoding: 'utf8' }));
  const video = probe.streams.find(stream => stream.codec_type === 'video'), audio = probe.streams.find(stream => stream.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  let meanDb = null;
  if (audio) {
    // volumedetect reports on stderr.
    const out = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    meanDb = Number(/mean_volume: (-?[\d.]+) dB/.exec(out)?.[1] ?? NaN);
  }
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', file, '-vf', `fps=8/${duration.toFixed(3)},scale=480:-2,tile=4x2`, '-frames:v', '1', sheet]);
  const [num, den] = (video?.avg_frame_rate ?? '0/1').split('/').map(Number);
  return { duration, width: video?.width, height: video?.height, fps: den ? num / den : 0, video: video?.codec_name, audio: audio?.codec_name ?? null, meanDb };
}

async function exportEpisode(call, { episode, end, out }) {
  const { activeCompositionId } = await call('getTimelineState');
  const composition = ((await call('getMediaItems', { recursive: true })).compositions ?? []).find(item => item.id === activeCompositionId);
  if (!composition?.width) throw new Error(`the open composition (${activeCompositionId}) reports no size`);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const maxRuntimeMs = Math.min(600000, Math.round(60000 + end * 8000));
  const attempt = async container => call('debugExport', {
    startTime: 0, endTime: end, width: composition.width, height: composition.height, fps: composition.frameRate ?? 30,
    includeAudio: true, container, codec: container === 'mp4' ? 'h264' : 'vp9', download: true, filename: `${episode}-${stamp}`, maxRuntimeMs,
  }, { timeoutMs: maxRuntimeMs + 30000 });
  console.log(`export: ${end.toFixed(2)} s at ${composition.width}×${composition.height}, ${composition.frameRate ?? 30} fps …`);
  let result;
  try {
    result = await attempt('mp4');
  } catch (error) {
    // Linux Chrome cannot encode AAC (and some builds H.264): WebM with VP9 and Opus instead.
    console.warn(`export as MP4 failed (${error.message}); trying WebM`);
    result = await attempt('webm');
  }
  if (result.timedOut) throw new Error(`the export ran out of time after ${result.elapsedMs} ms`);
  const saved = await downloaded(result.filename);
  fs.mkdirSync(out, { recursive: true });
  const target = path.join(out, `${episode}${path.extname(saved)}`);
  // Downloads may be on another disk than the output folder: copy, then remove.
  fs.copyFileSync(saved, target);
  fs.rmSync(saved);
  console.log(`export: ${path.relative(process.cwd(), target)} (${(fs.statSync(target).size / 1e6).toFixed(1)} MB, ${(result.elapsedMs / 1000).toFixed(0)} s)`);
  return target;
}

export async function main(args) {
  const valued = ['--music', '--music-db', '--editor', '--tab', '--out'];
  const episode = args.find((arg, index) => !arg.startsWith('--') && !valued.includes(args[index - 1]));
  if (!episode) throw new Error('Name the episode, e.g. node scripts/tutorial-ms-finish.mjs old-tv');
  const out = path.resolve(option(args, '--out', path.join(import.meta.dirname, '..', 'tutorial-videos')));
  const call = await cutEditor(option(args, '--editor'), option(args, '--tab'));
  const state = await call('getTimelineState');
  const picture = state.videoTracks.find(track => track.name === TRACKS.picture);
  const end = Math.max(0, ...(picture?.clips ?? []).map(clip => clip.endTime));
  if (!end) throw new Error(`the open project has no parts on the track "${TRACKS.picture}"; cut them in with scripts/tutorial-ms-cut.mjs first`);
  // A project started from the template already holds its music: it is fitted to the episode. Otherwise (or with
  // --music) the music file is laid under the whole episode.
  if (!args.includes('--no-music') && (option(args, '--music') || !await fitTemplateMusic(call, end))) {
    const music = path.resolve(option(args, '--music', path.join(import.meta.dirname, 'tutorials', 'audio', 'tutorial-music.wav')));
    if (!fs.existsSync(music)) throw new Error(`no music file at ${music}; pass --music <file> or --no-music`);
    await placeMusic(call, music, end, 10 ** (Number(option(args, '--music-db', -22)) / 20));
  }
  await call('saveProject').then(() => console.log('project saved'), error => console.warn(`project not saved: ${error.message}`));
  const file = await exportEpisode(call, { episode, end, out });
  const sheet = path.join(out, `${episode}.check.jpg`);
  const check = checkExport(file, sheet);
  console.log(`check: ${check.duration.toFixed(2)} s (episode ${end.toFixed(2)} s), ${check.width}×${check.height}, ${check.fps.toFixed(2)} fps, `
    + `${check.video}/${check.audio ?? 'NO AUDIO'}${check.meanDb === null ? '' : `, audio ${check.meanDb.toFixed(1)} dB mean`}; pictures: ${path.relative(process.cwd(), sheet)}`);
  const problems = [
    Math.abs(check.duration - end) > 0.25 && `the export lasts ${check.duration.toFixed(2)} s, the episode ${end.toFixed(2)} s`,
    !check.audio && 'the export has no sound',
    check.meanDb !== null && check.meanDb < -45 && `the sound is nearly silent (${check.meanDb.toFixed(1)} dB)`,
  ].filter(Boolean);
  if (problems.length) throw new Error(`the export needs a look: ${problems.join('; ')}`);
  return { file, check };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2)).catch(error => {
    console.error(`tutorial-ms-finish: ${error.message}`);
    process.exit(1);
  });
}
