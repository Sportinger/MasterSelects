// Shared by tutorialCut.mjs: the music under a tutorial. A recipe's `music` places cuts of one music
// file on the video's time line, each with its own volume curve, and mixes them under the voice.
//
// music: { file, cues: [cue] }
// cue:   { at: <video s> | end: true, from: <music s>, to: <music s, default: the file's end>,
//          volume: [[<s after the cue starts>, <dB>], …] }
//   at      where the cue starts in the video; end: true places it so it ends with the video
//   volume  points of a curve in dB, joined by straight lines in amplitude (before the first point
//           its value, after the last one the last value); -60 dB or less is silence, and a cue whose
//           curve ends in silence stops there
import { spawnSync } from 'node:child_process';

const SILENT = -60;

/**
 * ffmpeg expression for the gain (linear) of a volume curve over t (seconds after the cue starts):
 * straight lines in amplitude between the points, as a fader moves, so a long fade stays audible
 * until near its end.
 */
export function gainExpression(points) {
  const sorted = points.toSorted((a, b) => a[0] - b[0]);
  const gain = sorted.map(([, db]) => (db <= SILENT ? 0 : 10 ** (db / 20)));
  const value = number => Number(number.toFixed(6));
  // Nested if(): the last point's gain from its time on, a straight line before each point.
  let expression = String(value(gain.at(-1)));
  for (let index = sorted.length - 1; index > 0; index -= 1) {
    const [t0] = sorted[index - 1], [t1] = sorted[index], g0 = value(gain[index - 1]), g1 = value(gain[index]);
    const line = t1 > t0 ? `${g0}+(${value(g1 - g0)})*(t-${t0})/${t1 - t0}` : String(g1);
    expression = `if(lt(t,${t1}),${line},${expression})`;
  }
  return `if(lt(t,${sorted[0][0]}),${value(gain[0])},${expression})`;
}

/** Where each cue plays: { start (video s), from, to (music s) }, cut to the video. */
export function placeCues(cues, { duration, musicLength }) {
  return cues.map(cue => {
    const sorted = (cue.volume ?? [[0, 0]]).toSorted((a, b) => a[0] - b[0]);
    const fadesOut = sorted.length > 1 && sorted.at(-1)[1] <= SILENT;
    let from = cue.from ?? 0;
    let length = Math.min(cue.to ?? musicLength, musicLength) - from;
    if (fadesOut) length = Math.min(length, sorted.at(-1)[0]);
    let start = cue.end ? duration - length : cue.at ?? 0;
    // A cue longer than the video before its end starts at the video's start, further into the music.
    if (start < 0) { from -= start; length += start; start = 0; }
    length = Math.min(length, duration - start);
    return { start, from, to: from + Math.max(0, length), volume: sorted };
  }).filter(cue => cue.to > cue.from);
}

function musicLength(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const length = Number(result.stdout.trim());
  if (!(length > 0)) throw new Error(`Music ${file}: no duration (${result.stderr.trim()})`);
  return length;
}

/**
 * Writes `output` (48 kHz WAV, `duration` s): the voice file (or silence) with the music cues under it,
 * limited so the sum does not clip.
 */
export function mixMusic({ voice, music, duration, output }) {
  const cues = placeCues(music.cues ?? [], { duration, musicLength: musicLength(music.file) });
  const inputs = voice ? ['-i', voice, '-i', music.file] : ['-i', music.file];
  const m = voice ? 1 : 0;
  // One decode split into the cues (several direct reads of one input can stall ffmpeg).
  const split = cues.length ? [`[${m}:a]aresample=48000,asplit=${cues.length}${cues.map((_, index) => `[x${index}]`).join('')}`] : [];
  const parts = [...split, ...cues.map((cue, index) => `[x${index}]atrim=${cue.from.toFixed(3)}:${cue.to.toFixed(3)},asetpts=PTS-STARTPTS,`
    + `volume='${gainExpression(cue.volume)}':eval=frame,adelay=${Math.round(cue.start * 1000)}:all=1[m${index}]`)];
  // A silent base of the video's length fixes the mix's length (see voiceTrack in tutorialCut.mjs).
  const base = `anullsrc=channel_layout=stereo:sample_rate=48000:duration=${duration.toFixed(3)}[base]`;
  const labels = ['[base]', ...(voice ? ['[0:a]'] : []), ...cues.map((_, index) => `[m${index}]`)];
  const mix = `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=first,`
    + 'alimiter=limit=0.89:level=false,aresample=48000[out]';
  const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...inputs, '-filter_complex', [base, ...parts, mix].join(';'),
    '-map', '[out]', '-c:a', 'pcm_s16le', output], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Music mix failed: ${result.stderr.trim().split('\n').slice(-6).join('\n')}`);
  return cues;
}
