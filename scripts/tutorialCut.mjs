// Shared by tutorial-video.mjs: the edit of a tutorial recording. Screencast frames (sent whenever
// the page changed, with their times) become a constant frame rate picture through a virtual camera
// that eases between the boxes the recipe framed (cropped from the 2560×1440 take, so a zoomed shot
// stays sharp); waits marked `fast` play sped up. The picture and the voice lines (one file per scene,
// placed at each scene's start) are the material for the cut in MasterSelects (tutorial-ms-cut.mjs);
// a quick look joins them, with music cues under the voice (tutorialMusic.mjs) and, on request, the
// spoken words burned in as captions.
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
 * Where each scene's line lands in the output: { delay, words } per scene. A scene's first word starts
 * `lead` seconds after the scene starts; `delay` is where the line's cut (cutFrom) starts.
 */
export function placeNarration(recording, narration, map, lead) {
  return recording.scenes.map(scene => {
    const part = narration.scenes.find(item => item.id === scene.id);
    if (!part?.words.length) return { id: scene.id, words: [] };
    const at = map.toOutput(scene.start) + lead;
    return {
      id: scene.id, file: part.file ?? narration.file, cutFrom: part.cutFrom, cutTo: part.cutTo, delay: at - (part.start - part.cutFrom),
      top: scene.captions === 'top',
      words: part.words.map(word => ({ text: word.text, start: at + word.start - part.start, end: at + word.end - part.start, top: scene.captions === 'top' })),
    };
  });
}

/** Integrated loudness (LUFS) of an audio file. */
function loudness(file) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const json = result.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)?.[0];
  return json ? Number(JSON.parse(json).input_i) : NaN;
}

/** Places the line files (each `{ file, delay }`) on a silent base of `duration` s. */
function mixLines(lines, duration, file, { gainDb = 0 } = {}) {
  const base = `anullsrc=channel_layout=stereo:sample_rate=48000:duration=${duration.toFixed(3)}[base]`;
  const parts = lines.map((line, index) => `[${index}:a]aresample=48000,adelay=${Math.max(0, Math.round(line.delay * 1000))}:all=1[a${index}]`);
  const mix = `[base]${lines.map((_, index) => `[a${index}]`).join('')}amix=inputs=${lines.length + 1}:normalize=0:duration=first,`
    + `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.84:level=false,aresample=48000[out]`;
  run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...lines.flatMap(line => ['-i', line.file]), '-filter_complex', [base, ...parts, mix].join(';'),
    '-map', '[out]', '-c:a', 'pcm_s16le', file]);
}

/**
 * The voice of a part as one file per line (the clips of the MasterSelects cut) and as one track (for the quick
 * look). Every line is cut from its source at cutFrom–cutTo; all lines of a part get the same gain, so the part's
 * voice reaches -14 LUFS without changing the balance between lines. Returns the lines with their files.
 */
function voiceLines(placed, duration, dir, name) {
  const spoken = placed.filter(part => part.words.length);
  if (!spoken.length) return [];
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cut = (part, index, gainDb) => {
    const file = path.join(dir, `${name}.${String(index + 1).padStart(2, '0')}-${part.id}.wav`);
    run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', part.file, '-af', `atrim=${part.cutFrom.toFixed(3)}:${part.cutTo.toFixed(3)},asetpts=PTS-STARTPTS,`
      + `aresample=48000,volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.84:level=false`, '-ac', '1', '-c:a', 'pcm_s16le', file]);
    return file;
  };
  const raw = spoken.map((part, index) => ({ ...part, file: cut(part, index, 0) }));
  const probe = path.join(dir, 'probe.wav');
  mixLines(raw, duration, probe);
  const measured = loudness(probe);
  const gainDb = Number.isFinite(measured) ? Math.max(-12, Math.min(12, -14 - measured)) : 0;
  fs.rmSync(probe);
  return spoken.map((part, index) => ({ ...part, file: cut(part, index, gainDb), gainDb }));
}

/**
 * Encodes a take for the cut in MasterSelects and a quick look (the file names carry the part's `name`, so the
 * clips are recognisable in the MasterSelects media panel):
 * - `<cutDir>/<name>.mp4`: the picture, the frames through the camera, 1920×1080, no sound, no captions;
 * - `<cutDir>/voice/<name>.NN-<scene>.wav`: one file per line, cut and levelled (voiceLines);
 * - `output`: the quick look, the picture with the voice (and the recipe's music); `burnCaptions` burns the word
 *   captions in (for a video that is not cut in MasterSelects).
 * recording: { frames: [{ file, time }], end, scenes: [{ id, start, captions }], camera: [{ t, cx, cy, zoom, ms }],
 *   fast: [{ from, to, factor }], viewport: { width, height } }
 * Returns { duration, frames, words, picture, lines: [{ id, file, at, duration, words, top }] } (line words in
 * seconds of the line's file).
 */
export async function cutTutorial({ recording, narration, name, output, cutDir, workDir, width = 1920, height = 1080, fps = 30, lead = 0.25,
  captions = {}, music, burnCaptions = false }) {
  const map = timeMap(recording.fast);
  const duration = map.toOutput(recording.end);
  const placed = placeNarration(recording, narration, map, lead);
  const words = placed.flatMap(part => part.words);
  fs.mkdirSync(cutDir, { recursive: true });
  const lines = narration.file || narration.lines ? voiceLines(placed, duration, path.join(cutDir, 'voice'), name) : [];
  const voiceFile = lines.length ? path.join(workDir, 'voice.wav') : null;
  if (voiceFile) mixLines(lines.map(line => ({ file: line.file, delay: line.delay })), duration, voiceFile);
  let audioFile = voiceFile;
  if (music?.cues?.length) {
    audioFile = path.join(workDir, 'mix.wav');
    const cues = mixMusic({ voice: voiceFile, music, duration, output: audioFile });
    for (const cue of cues) console.log(`  music ${cue.from.toFixed(2)}–${cue.to.toFixed(2)} s of the track at ${cue.start.toFixed(2)} s of the video`);
  }

  const picture = path.join(cutDir, `${name}.mp4`);
  const frames = recording.frames;
  const source = await sharp(frames[0].file).metadata();
  const scale = source.width / recording.viewport.width;
  const count = Math.ceil(duration * fps);
  const args = ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-r', String(fps), '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=limited,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', '-t', duration.toFixed(3), picture];
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

  // The quick look: the picture as it is, with the sound; captions only when they are burned in.
  const look = ['-hide_banner', '-v', 'error', '-y', '-i', picture, ...(audioFile ? ['-i', audioFile] : [])];
  if (burnCaptions) {
    const assFile = path.join(workDir, 'captions.ass');
    fs.writeFileSync(assFile, captionFile(words, { width, height, ...captions }));
    look.push('-vf', `ass=${assFile.replace(/[:\\']/g, '\\$&')}`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709');
  } else look.push('-c:v', 'copy');
  if (audioFile) look.push('-c:a', 'aac', '-b:a', '160k', '-shortest');
  run('ffmpeg', [...look, '-movflags', '+faststart', output]);

  return {
    duration, frames: count, words: words.length, picture,
    lines: lines.map(line => ({ id: line.id, file: line.file, at: line.delay, duration: line.cutTo - line.cutFrom, top: line.top,
      words: line.words.map(word => ({ text: word.text, start: word.start - line.delay, end: word.end - line.delay })) })),
  };
}
