// Shared by tutorial-video.mjs: the edit of a tutorial recording. Screencast frames (sent whenever
// the page changed, with their times) become a constant frame rate video through a virtual camera
// that eases between the boxes the recipe framed (cropped from the 2× screencast, so a zoomed
// shot stays sharp); waits marked `fast` play sped up; the narration lands at each scene's start;
// the spoken words are burned in as captions; music cues go under the voice (tutorialMusic.mjs).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { mixMusic } from './tutorialMusic.mjs';

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Recording time ↔ output time, with every `fast` range played `factor` times faster. */
export function timeMap(speedRanges = []) {
  const ranges = speedRanges.toSorted((a, b) => a.from - b.from);
  const toOutput = time => time - ranges.reduce((saved, { from, to, factor }) =>
    saved + Math.max(0, Math.min(time, to) - from) * (1 - 1 / factor), 0);
  const toRecording = output => {
    let time = output;
    for (const { from, to, factor } of ranges) {
      const start = toOutput(from);
      if (output <= start) break;
      const inside = Math.min(output - start, (to - from) / factor);
      time = from + inside * factor + Math.max(0, output - start - (to - from) / factor);
    }
    return time;
  };
  return { toOutput, toRecording };
}

/**
 * The camera over recording time: each key eases from where the camera was when the key began
 * (also mid-move) to its own framing over `ms`. Returns t → { cx, cy, zoom }.
 */
export function cameraPath(keys, rest) {
  const blend = (from, key, t) => {
    const k = ease(key.ms ? Math.min(1, Math.max(0, (t - key.t) / (key.ms / 1000))) : 1);
    // Zoom eases in log space, so zooming in and out feel equally fast.
    return { cx: from.cx + (key.cx - from.cx) * k, cy: from.cy + (key.cy - from.cy) * k,
      zoom: Math.exp(Math.log(from.zoom) + (Math.log(key.zoom) - Math.log(from.zoom)) * k) };
  };
  const sorted = keys.toSorted((a, b) => a.t - b.t), starts = [];
  sorted.forEach((key, index) => { starts.push(index ? blend(starts[index - 1], sorted[index - 1], key.t) : rest); });
  return t => {
    const index = sorted.findLastIndex(key => key.t <= t);
    return index < 0 ? rest : blend(starts[index], sorted[index], t);
  };
}

const assTime = seconds => {
  const cs = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const assText = text => text.replace(/[{}\\]/g, '');

/**
 * Caption lines: a phrase ends at punctuation, a pause or a change of place, and a phrase longer
 * than `maxWords` is spread evenly over as few lines as fit ("Open the editor / in your browser,"
 * rather than "Open the editor in / your browser,").
 */
export function captionGroups(words, maxWords = 4) {
  const phrases = [];
  for (const word of words) {
    const phrase = phrases.at(-1), last = phrase?.at(-1);
    if (!last || /[.,!?;:…]$/.test(last.text) || last.top !== word.top || word.start - last.end > 0.6) phrases.push([word]);
    else phrase.push(word);
  }
  return phrases.flatMap(phrase => {
    const lines = Math.ceil(phrase.length / maxWords);
    return Array.from({ length: lines }, (_, line) => ({
      words: phrase.slice(Math.round(line * phrase.length / lines), Math.round((line + 1) * phrase.length / lines)),
    }));
  });
}

/**
 * ASS captions: the words in short lines (captionGroups), the word being spoken in the accent
 * colour. words: [{ text, start, end, top }] in output seconds.
 */
export function captionFile(words, { width, height, font = 'Noto Sans', size = 64, maxWords = 4, accent = '&H0034D2FF' } = {}) {
  const groups = captionGroups(words, maxWords);
  const events = groups.flatMap((group, index) => {
    const next = groups[index + 1]?.words[0].start;
    const end = next !== undefined && next - group.words.at(-1).end < 0.5 ? next : group.words.at(-1).end + 0.35;
    return group.words.map((word, wordIndex) => {
      const from = wordIndex ? word.start : group.words[0].start, to = group.words[wordIndex + 1]?.start ?? end;
      const text = group.words.map((item, itemIndex) => (itemIndex === wordIndex ? `{\\c${accent}}${assText(item.text)}{\\c&H00FFFFFF&}` : assText(item.text))).join(' ');
      return `Dialogue: 0,${assTime(from)},${assTime(to)},${group.words[0].top ? 'Top' : 'Bottom'},,0,0,0,,${text}`;
    });
  });
  const style = (name, alignment) => `Style: ${name},${font},${size},&H00FFFFFF,&H00FFFFFF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,5,2,${alignment},80,80,${Math.round(height * 0.06)},1`;
  return ['[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style('Bottom', 2), style('Top', 8), '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...events, ''].join('\n');
}

function run(tool, args) {
  const result = spawnSync(tool, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${tool} failed:\n${(result.stderr || result.error?.message || '').trim().split('\n').slice(-8).join('\n')}`);
  return result.stdout;
}

/**
 * Where each scene's narration lands in the output: { delay, words } per scene. A scene's first
 * word starts `lead` seconds after the scene starts.
 */
export function placeNarration(recording, narration, map, lead) {
  return recording.scenes.map(scene => {
    const part = narration.scenes.find(item => item.id === scene.id);
    if (!part?.words.length) return { id: scene.id, words: [] };
    const at = map.toOutput(scene.start) + lead;
    return {
      id: scene.id, cutFrom: part.cutFrom, cutTo: part.cutTo, delay: at - (part.start - part.cutFrom),
      words: part.words.map(word => ({ text: word.text, start: at + word.start - part.start, end: at + word.end - part.start, top: scene.captions === 'top' })),
    };
  });
}

/** The narration track: every scene's cut of the voice file at its place, loudness-normalized. */
function voiceTrack(narration, placed, duration, file) {
  const parts = placed.filter(part => part.words.length);
  // One decode split into the parts: several direct reads of [0:a] can stall ffmpeg on some MP3s.
  const split = `[0:a]aresample=48000,asplit=${parts.length}${parts.map((_, index) => `[s${index}]`).join('')}`;
  const filters = [split, ...parts.map((part, index) => `[s${index}]atrim=${part.cutFrom.toFixed(3)}:${part.cutTo.toFixed(3)},asetpts=PTS-STARTPTS,`
    + `adelay=${Math.max(0, Math.round(part.delay * 1000))}:all=1[a${index}]`)];
  // A silent base of the video's length as the first input fixes the length (an open-ended apad
  // behind amix never ended on a mono MP3).
  const base = `anullsrc=channel_layout=stereo:sample_rate=48000:duration=${duration.toFixed(3)}[base]`;
  const mix = `[base]${parts.map((_, index) => `[a${index}]`).join('')}amix=inputs=${parts.length + 1}:normalize=0:duration=first,`
    + 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[out]';
  run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', narration.file, '-filter_complex', [base, ...filters, mix].join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', file]);
}

/**
 * Encodes the tutorial: frames → camera → captions (+ narration) → H.264/AAC MP4.
 * recording: { frames: [{ file, time }], end, scenes: [{ id, start, captions }], camera: [{ t, cx, cy, zoom, ms }],
 *   fast: [{ from, to, factor }], viewport: { width, height } }
 * music: { file, cues } (see tutorialMusic.mjs), mixed under the narration.
 */
export async function cutTutorial({ recording, narration, output, workDir, width = 1920, height = 1080, fps = 30, lead = 0.25, captions = {}, music }) {
  const map = timeMap(recording.fast);
  const duration = map.toOutput(recording.end);
  const placed = placeNarration(recording, narration, map, lead);
  const words = placed.flatMap(part => part.words);
  const assFile = path.join(workDir, 'captions.ass');
  fs.writeFileSync(assFile, captionFile(words, { width, height, ...captions }));
  const voiceFile = narration.file ? path.join(workDir, 'voice.wav') : null;
  if (voiceFile) voiceTrack(narration, placed, duration, voiceFile);
  let audioFile = voiceFile;
  if (music?.cues?.length) {
    audioFile = path.join(workDir, 'mix.wav');
    const cues = mixMusic({ voice: voiceFile, music, duration, output: audioFile });
    for (const cue of cues) console.log(`  music ${cue.from.toFixed(2)}–${cue.to.toFixed(2)} s of the track at ${cue.start.toFixed(2)} s of the video`);
  }

  const frames = recording.frames;
  const source = await sharp(frames[0].file).metadata();
  const scale = source.width / recording.viewport.width;
  const count = Math.ceil(duration * fps);
  const args = ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-r', String(fps), '-i', '-'];
  if (audioFile) args.push('-i', audioFile);
  args.push('-vf', `ass=${assFile.replace(/[:\\']/g, '\\$&')},scale=out_color_matrix=bt709:out_range=limited,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-movflags', '+faststart', '-t', duration.toFixed(3));
  if (audioFile) args.push('-c:a', 'aac', '-b:a', '160k', '-shortest');
  args.push(output);
  const encoder = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'pipe'] });
  let stderr = '';
  encoder.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => encoder.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${stderr.trim().split('\n').slice(-6).join('\n')}`)))));
  const write = buffer => new Promise(resolve => (encoder.stdin.write(buffer) ? resolve() : encoder.stdin.once('drain', resolve)));

  const cameraAt = cameraPath(recording.camera ?? [], { cx: recording.viewport.width / 2, cy: recording.viewport.height / 2, zoom: 1 });
  let index = 0, last;
  for (let k = 0; k < count; k += 1) {
    const time = map.toRecording(k / fps);
    while (index + 1 < frames.length && frames[index + 1].time <= time) index += 1;
    const camera = cameraAt(time);
    const w = Math.round(source.width / camera.zoom), h = Math.round(source.height / camera.zoom);
    const left = Math.round(Math.min(source.width - w, Math.max(0, camera.cx * scale - w / 2)));
    const top = Math.round(Math.min(source.height - h, Math.max(0, camera.cy * scale - h / 2)));
    const key = `${index}:${left}:${top}:${w}:${h}`;
    if (last?.key !== key) {
      const buffer = await sharp(frames[index].file).extract({ left, top, width: w, height: h })
        .resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
      last = { key, buffer };
    }
    await write(last.buffer);
  }
  encoder.stdin.end();
  await done;
  return { duration, frames: count, words: words.length };
}
