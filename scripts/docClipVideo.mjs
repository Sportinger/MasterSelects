// Shared by the docs clip script (doc-clip.mjs): ffmpeg encoding for docs clips, next to
// docShotWebp.mjs for still pictures. Every clip is a muted H.264 MP4 (yuv420p, BT.709 limited
// range, faststart) that fits its byte budget, plus a WebP poster of one of its frames.
//   encodeEffectClip  editor exports (effect, optionally the original) → layout → seamless loop
//   encodeRecording   screencast frames with timestamps → constant frame rate, cropped
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function run(tool, args) {
  const result = spawnSync(tool, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${tool} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${tool} failed:\n${result.stderr.trim().split('\n').slice(-8).join('\n')}`);
  return result.stdout;
}
const ffmpeg = args => run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);

/** Size, frame rate and duration of a video file's first video stream. */
export function probeVideo(file) {
  const info = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_read_packets:format=duration', '-of', 'json', file]));
  const stream = info.streams[0], [num, den] = stream.r_frame_rate.split('/').map(Number);
  return { width: stream.width, height: stream.height, fps: num / den, frames: Number(stream.nb_read_packets), duration: Number(info.format.duration) };
}

const even = value => Math.max(2, Math.round(value / 2) * 2);
// Browser exports are full-range BT.709; docs clips are limited range, tagged BT.709.
const toLimited = 'scale=in_range=full:out_range=limited:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p';

/**
 * The layout filter for an effect clip: input 0 is the effect export, input 1 the original.
 *   single  the crop of the effect
 *   pair    original | effect, the same crop side by side with `gap` px between them
 *   compare the pair of a docs compare slider: original | effect at exactly the same size, no gap
 *   split   one picture: the original up to `split` of the width, the effect after a thin line
 *   detail  the crop of the effect (whole frame) | a `zoom`× pixel-for-pixel detail at `detail` [x, y]
 * Returns { graph (ending in [c]), width, height }.
 */
function layoutGraph(clip, frame) {
  const [x, y, w, h] = clip.crop ?? [0, 0, frame.width, frame.height];
  const layout = clip.layout ?? 'single', gap = layout === 'compare' ? 0 : clip.gap ?? 6;
  const halves = layout === 'pair' || layout === 'compare' || layout === 'detail';
  const outWidth = clip.width ?? 960;
  const cellWidth = even(halves ? (outWidth - gap) / 2 : outWidth), cellHeight = even(cellWidth * h / w);
  const fit = (input, flags = 'lanczos') => `[${input}:v]${toLimited},crop=${w}:${h}:${x}:${y},scale=${cellWidth}:${cellHeight}:flags=${flags}`;
  const width = halves ? cellWidth * 2 + gap : cellWidth;
  if (layout === 'single') return { graph: `${fit(0)}[c]`, width, height: cellHeight };
  if (layout === 'compare') return { width, height: cellHeight, graph: `${fit(1)}[l];${fit(0)}[r];[l][r]hstack[c]` };
  if (layout === 'pair') return { width, height: cellHeight,
    graph: `${fit(1)},pad=${cellWidth + gap}:${cellHeight}:0:0:color=0x111111[l];${fit(0)}[r];[l][r]hstack[c]` };
  if (layout === 'split') {
    const cut = even(cellWidth * (clip.split ?? 0.5));
    return { width, height: cellHeight, graph: `${fit(1)}[o];${fit(0)},crop=${cellWidth - cut}:${cellHeight}:${cut}:0[e];`
      + `[o][e]overlay=x=${cut}:y=0,drawbox=x=${cut - 1}:y=0:w=2:h=${cellHeight}:color=white@0.75:t=fill[c]` };
  }
  if (layout === 'detail') {
    const zoom = clip.zoom ?? 3, [dx, dy] = clip.detail ?? [frame.width / 2, frame.height / 2];
    const dw = Math.round(cellWidth / zoom), dh = Math.round(cellHeight / zoom);
    return { width, height: cellHeight, graph: `[0:v]${toLimited},split[a][b];`
      + `[a]crop=${w}:${h}:${x}:${y},scale=${cellWidth}:${cellHeight}:flags=area,pad=${cellWidth + gap}:${cellHeight}:0:0:color=0x111111[l];`
      + `[b]crop=${dw}:${dh}:${Math.round(dx)}:${Math.round(dy)},scale=${cellWidth}:${cellHeight}:flags=neighbor[r];[l][r]hstack[c]` };
  }
  throw new Error(`${clip.name}: unknown layout "${layout}" (single, pair, compare, split or detail)`);
}

/**
 * A loop that has no seam: the last `crossfade` seconds fade into the first ones, so the clip
 * ends on the frame it starts with (it gets that much shorter). 0 keeps a plain cut.
 */
function loopGraph(input, { duration, fps, crossfade }) {
  // Square pixels: the page's width/height are the clip's own pixel size.
  if (!crossfade) return `[${input}]setsar=1,fps=${fps}[v]`;
  if (duration < crossfade * 3) throw new Error(`A ${crossfade} s crossfade needs at least ${crossfade * 3} s of video, not ${duration.toFixed(2)} s.`);
  return `[${input}]setsar=1,fps=${fps},split[a][b];[a]trim=start=${crossfade},setpts=PTS-STARTPTS[m];[b]trim=end=${crossfade},setpts=PTS-STARTPTS[h];`
    + `[m][h]xfade=transition=fade:duration=${crossfade}:offset=${(duration - 2 * crossfade).toFixed(4)}[v]`;
}

/** Encodes `[v]` of `graph` from `inputs` to `output`, raising the CRF until it fits `maxBytes`. */
function encodeWithinBudget({ inputArgs, graph, output, maxBytes, crf = 20 }) {
  for (let quality = crf; ; quality += 2) {
    ffmpeg([...inputArgs, '-filter_complex', graph, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(quality),
      '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709',
      '-color_trc', 'bt709', '-movflags', '+faststart', output]);
    const size = fs.statSync(output).size;
    if (size <= maxBytes) return { size, crf: quality };
    if (quality >= 38) throw new Error(`${path.basename(output)}: ${size} bytes at CRF ${quality}; shorten, crop or shrink the clip.`);
  }
}

/** The poster: frame at `time` seconds of the finished clip, as WebP (RGB first, so colours match the video). */
export function writePoster(video, poster, time = 0) {
  ffmpeg(['-ss', String(time), '-i', video, '-frames:v', '1', '-vf', 'scale=in_range=limited:in_color_matrix=bt709,format=rgb24',
    '-c:v', 'libwebp', '-quality', '82', poster]);
  return fs.statSync(poster).size;
}

/** Layouts that show the original beside the effect, so they need an export without the effect. */
export const ORIGINAL_LAYOUTS = ['pair', 'compare', 'split'];

/** Effect clip from editor exports: `effect` (and `original` for pair, compare and split) → MP4 + poster. */
export function encodeEffectClip(clip, { effect, original, output, poster }) {
  const frame = probeVideo(effect);
  if (ORIGINAL_LAYOUTS.includes(clip.layout) && !original) throw new Error(`${clip.name}: layout ${clip.layout} needs the original export`);
  const layout = layoutGraph(clip, frame);
  const fps = clip.fps ?? Math.round(frame.fps * 1000) / 1000;
  const graph = `${layout.graph};${loopGraph('c', { duration: frame.frames / frame.fps, fps, crossfade: clip.loop ?? 0.5 })}`;
  const inputArgs = ['-i', effect, ...(original ? ['-i', original] : [])];
  const encoded = encodeWithinBudget({ inputArgs, graph, output, maxBytes: clip.maxBytes ?? 1_500_000, crf: clip.crf });
  return { ...encoded, ...probeVideo(output), posterBytes: writePoster(output, poster, clip.poster ?? 0) };
}

/**
 * Screen recording → MP4 + poster. `frames` are { file, time } (seconds, ascending), `end` the
 * time the recording stops; `crop` is { x, y, width, height } in the frames' own pixels.
 */
export function encodeRecording(clip, { frames, end, crop, output, poster, workDir }) {
  const list = path.join(workDir, 'frames.txt');
  const lines = frames.map((frame, index) => `file '${frame.file}'\nduration ${((frames[index + 1]?.time ?? end) - frame.time).toFixed(4)}`);
  // The concat demuxer drops the last entry's duration unless the file is listed again.
  fs.writeFileSync(list, `${lines.join('\n')}\nfile '${frames.at(-1).file}'\n`);
  const width = even(clip.width ?? 1280), height = even(width * crop.height / crop.width);
  const graph = `[0:v]crop=${even(crop.width)}:${even(crop.height)}:${crop.x}:${crop.y},scale=${width}:${height}:flags=lanczos,`
    // Screencast frames are JPEG: full-range BT.601.
    + `scale=in_range=full:in_color_matrix=bt601:out_color_matrix=bt709:out_range=limited,format=yuv420p,setsar=1,fps=${clip.fps ?? 30}[v]`;
  const encoded = encodeWithinBudget({ inputArgs: ['-f', 'concat', '-safe', '0', '-i', list], graph, output, maxBytes: clip.maxBytes ?? 1_500_000, crf: clip.crf ?? 22 });
  return { ...encoded, ...probeVideo(output), posterBytes: writePoster(output, poster, clip.poster ?? 0) };
}
