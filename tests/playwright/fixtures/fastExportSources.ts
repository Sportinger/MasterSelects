import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { frameCodeFilter } from './frameCodeMedia';
import { ensureTestMedia } from './testMediaStore';

// Synthetic sources for the Fast export journeys. Every recipe is rendered with ffmpeg into the
// shared test media store (fixtures/testMediaStore.ts, key `fast-export/<name>-<hash>`),
// addressed by a hash of the recipe, so each clip is generated once (or fetched from the remote)
// and no large file lands in the test evidence. Video frames are the frame-code chart of
// fixtures/frameCodeMedia.ts (v1: frame number in 16 blocks with a check nibble, colour bars,
// grey ramp, printed number), read back by assertions/frameCodeOracle.ts, plus a white flash
// square in the lower right corner on every whole second; audio carries a 10 ms 1 kHz click on
// every whole second. Flash and click together give the A/V offset (assertions/fastExportOracle.ts).

const GENERATOR_VERSION = 4;

/** Side of the flash square as a fraction of the shorter frame side (shared with the oracle). */
export const FLASH_SQUARE_FRACTION = 1 / 8;

export interface FastVideoRecipe {
  codec: 'h264' | 'h265' | 'vp9';
  width: number;
  height: number;
  fps: number;
  seconds: number;
  /** H.264 profile; High uses B-frames. */
  profile?: 'high' | 'baseline';
  /** Keyframe interval in frames (default: one second). */
  gop?: number;
  /**
   * Variable frame rate: drop every n-th frame (the one before each multiple of n) and delay
   * the frame after each gap by a quarter frame. Gaps and uneven spacing never put an output
   * time exactly halfway between two source frames, so the nearest frame is unambiguous.
   */
  dropEvery?: number;
  /** Store the picture rotated by 90° with display-rotation metadata (phone portrait). */
  portraitRotated?: boolean;
}

export interface FastAudioRecipe {
  codec: 'aac' | 'opus' | 'mp3' | 'pcm';
  sampleRate: number;
  seconds: number;
}

export interface FastSourceRecipe {
  name: string;
  container: 'mp4' | 'mov' | 'webm' | 'png' | 'mp3' | 'wav';
  video?: FastVideoRecipe;
  audio?: FastAudioRecipe;
  /** PNG only: transparent frame with an opaque square in the centre. */
  still?: { width: number; height: number; color: string };
}

export interface FastSource {
  path: string;
  recipe: FastSourceRecipe;
  /** Display size (after rotation metadata). */
  width: number;
  height: number;
  /** Timestamp (seconds) of every source frame that exists in the file. */
  frameTimestamps: number[];
  /** Frame code of each frame in `frameTimestamps` (equal to the frame's original index). */
  frameCodes: number[];
}

export const FAST_SOURCES = {
  h264High: { name: 'h264-high', container: 'mp4', video: { codec: 'h264', width: 640, height: 360, fps: 30, seconds: 3, profile: 'high' }, audio: { codec: 'aac', sampleRate: 48_000, seconds: 3 } },
  h264Eight: { name: 'h264-8s', container: 'mp4', video: { codec: 'h264', width: 640, height: 360, fps: 30, seconds: 8, profile: 'high' }, audio: { codec: 'aac', sampleRate: 48_000, seconds: 8 } },
  h264Baseline: { name: 'h264-baseline', container: 'mp4', video: { codec: 'h264', width: 640, height: 360, fps: 30, seconds: 3, profile: 'baseline' } },
  h265: { name: 'h265-8bit', container: 'mp4', video: { codec: 'h265', width: 640, height: 360, fps: 30, seconds: 3 } },
  longGop: { name: 'h264-long-gop', container: 'mp4', video: { codec: 'h264', width: 640, height: 360, fps: 30, seconds: 12, profile: 'high', gop: 300 } },
  vfr: { name: 'h264-vfr', container: 'mp4', video: { codec: 'h264', width: 640, height: 360, fps: 30, seconds: 3, profile: 'high', dropEvery: 4 } },
  movPortrait: { name: 'mov-portrait-rotated', container: 'mov', video: { codec: 'h264', width: 360, height: 640, fps: 30, seconds: 3, profile: 'high', portraitRotated: true } },
  webmVp9: { name: 'webm-vp9', container: 'webm', video: { codec: 'vp9', width: 640, height: 360, fps: 30, seconds: 3 }, audio: { codec: 'opus', sampleRate: 48_000, seconds: 3 } },
  h264Hd60: { name: 'h264-1080p60', container: 'mp4', video: { codec: 'h264', width: 1920, height: 1080, fps: 60, seconds: 2, profile: 'high' }, audio: { codec: 'aac', sampleRate: 48_000, seconds: 2 } },
  pngAlpha: { name: 'png-alpha', container: 'png', still: { width: 640, height: 360, color: '0xFF00FF' } },
  mp3Clicks: { name: 'mp3-clicks', container: 'mp3', audio: { codec: 'mp3', sampleRate: 44_100, seconds: 3 } },
  wavClicks: { name: 'wav-clicks', container: 'wav', audio: { codec: 'pcm', sampleRate: 48_000, seconds: 3 } },
} as const satisfies Record<string, FastSourceRecipe>;

export function ffmpegExecutable(): string {
  return process.env.MASTERSELECTS_E2E_FFMPEG?.trim() || 'ffmpeg';
}

function runFfmpeg(args: string[]): void {
  const result = spawnSync(ffmpegExecutable(), ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (result.error) {
    throw new Error(`ffmpeg is required for the Fast export sources (${ffmpegExecutable()}): ${result.error.message}. `
      + 'Install ffmpeg or set MASTERSELECTS_E2E_FFMPEG.');
  }
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr.trim().slice(-1200)}`);
}

function ffmpegMajorVersion(): number {
  const result = spawnSync(ffmpegExecutable(), ['-hide_banner', '-version'], { encoding: 'utf8' });
  const match = /ffmpeg version n?(\d+)/.exec(result.stdout ?? '');
  return match ? Number(match[1]) : 0;
}

/** Timestamps and codes of the frames that remain in the file. */
function vfrDelay(frame: number, dropEvery: number): number {
  return frame > 0 && frame % dropEvery === 0 ? 0.25 : 0;
}

function frameLayout(video: FastVideoRecipe): { timestamps: number[]; codes: number[] } {
  const total = Math.round(video.seconds * video.fps);
  const timestamps: number[] = [];
  const codes: number[] = [];
  for (let frame = 0; frame < total; frame += 1) {
    if (video.dropEvery && frame % video.dropEvery === video.dropEvery - 1) continue;
    timestamps.push((frame + (video.dropEvery ? vfrDelay(frame, video.dropEvery) : 0)) / video.fps);
    codes.push(frame);
  }
  return { timestamps, codes };
}

function videoFilter(video: FastVideoRecipe): string {
  // The chart and flash are drawn in display orientation; a rotated source stores the picture
  // turned 90° clockwise and asks the player to turn it back. The chart's geq reads the frame
  // number N before frames are dropped, so a VFR source keeps each frame's original number.
  const { width, height, fps, seconds } = video;
  const flash = Math.round(Math.min(width, height) * FLASH_SQUARE_FRACTION / 2) * 2;
  return `color=c=black:size=${width}x${height}:rate=${fps}:duration=${seconds},${frameCodeFilter(width, height)},`
      + `drawbox=x=${width - flash}:y=${height - flash}:w=${flash}:h=${flash}:color=black:t=fill,`
      + `drawbox=x=${width - flash}:y=${height - flash}:w=${flash}:h=${flash}:color=white:t=fill:enable='not(mod(n\\,${fps}))'`
      + (video.dropEvery
        ? `,settb=1/${video.fps * 1000},setpts='(N+0.25*gt(N\\,0)*eq(mod(N\\,${video.dropEvery})\\,0))/(${video.fps}*TB)'`
          + `,select='not(eq(mod(n\\,${video.dropEvery})\\,${video.dropEvery - 1}))'`
        : '')
      + (video.portraitRotated ? ',transpose=clock' : '')
      + ',format=yuv420p[v]';
}

function audioInput(audio: FastAudioRecipe): string[] {
  const click = `if(lt(mod(t\\,1)\\,0.01)\\,0.8*sin(2*PI*1000*t)\\,0)`;
  return ['-f', 'lavfi', '-i', `aevalsrc=exprs=${click}|${click}:s=${audio.sampleRate}:d=${audio.seconds}`];
}

function videoCodecArgs(video: FastVideoRecipe): string[] {
  const gop = String(video.gop ?? video.fps);
  if (video.codec === 'h264') {
    const profile = video.profile ?? 'high';
    return ['-c:v', 'libx264', '-profile:v', profile, '-preset', 'veryfast', '-crf', '20', '-g', gop, '-keyint_min', gop,
      '-sc_threshold', '0', ...(profile === 'high' ? ['-bf', '3'] : ['-bf', '0']), '-pix_fmt', 'yuv420p'];
  }
  if (video.codec === 'h265') {
    return ['-c:v', 'libx265', '-preset', 'veryfast', '-crf', '24', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p',
      '-x265-params', `keyint=${gop}:min-keyint=${gop}:scenecut=0:log-level=error`];
  }
  return ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-deadline', 'realtime', '-cpu-used', '8', '-g', gop, '-pix_fmt', 'yuv420p'];
}

function audioCodecArgs(audio: FastAudioRecipe): string[] {
  switch (audio.codec) {
    case 'aac': return ['-c:a', 'aac', '-b:a', '128k'];
    case 'opus': return ['-c:a', 'libopus', '-b:a', '96k'];
    case 'mp3': return ['-c:a', 'libmp3lame', '-b:a', '160k'];
    case 'pcm': return ['-c:a', 'pcm_s16le'];
  }
}

function render(recipe: FastSourceRecipe, target: string): void {
  if (recipe.container === 'png') {
    const still = recipe.still!;
    const square = Math.round(Math.min(still.width, still.height) / 3);
    runFfmpeg(['-f', 'lavfi', '-i', `color=c=black@0.0:size=${still.width}x${still.height},format=rgba`,
      // replace=1 writes the box's alpha too; without it the square stays transparent.
      '-vf', `drawbox=x=${(still.width - square) / 2}:y=${(still.height - square) / 2}:w=${square}:h=${square}:color=${still.color}@1.0:t=fill:replace=1`,
      '-frames:v', '1', target]);
    return;
  }
  if (!recipe.video) {
    runFfmpeg([...audioInput(recipe.audio!), ...audioCodecArgs(recipe.audio!), target]);
    return;
  }
  const video = recipe.video;
  const encoded = video.portraitRotated ? `${target}.coded.mp4` : target;
  const args = [...(recipe.audio ? audioInput(recipe.audio) : []),
    '-filter_complex', videoFilter(video), '-map', '[v]', ...(recipe.audio ? ['-map', '0:a'] : []),
    ...videoCodecArgs(video), ...(recipe.audio ? audioCodecArgs(recipe.audio) : []),
    // The encoder would round timestamps to 1/fps; keep the filter's finer time base.
    ...(video.dropEvery ? ['-fps_mode', 'passthrough', '-enc_time_base:v', `1:${video.fps * 1000}`, '-video_track_timescale', String(video.fps * 1000)] : []),
    '-t', String(video.seconds), encoded];
  runFfmpeg(args);
  if (video.portraitRotated) {
    // Stored clockwise, displayed rotated back (counter-clockwise) like a phone recording.
    const rotation = ffmpegMajorVersion() >= 6 ? ['-display_rotation', '90', '-i', encoded] : ['-i', encoded, '-metadata:s:v:0', 'rotate=270'];
    runFfmpeg([...rotation, '-c', 'copy', target]);
    rmSync(encoded, { force: true });
  }
}

/** Renders (once, or fetches from the test media remote) and returns the source for a recipe. */
export async function ensureFastSource(recipe: FastSourceRecipe): Promise<FastSource> {
  const hash = createHash('sha256').update(JSON.stringify({ GENERATOR_VERSION, recipe })).digest('hex').slice(0, 16);
  const { path: target } = await ensureTestMedia(`fast-export/${recipe.name}-${hash}.${recipe.container}`, async (partial) => render(recipe, partial));
  const layout = recipe.video ? frameLayout(recipe.video) : { timestamps: [], codes: [] };
  const width = recipe.video?.width ?? recipe.still?.width ?? 0;
  const height = recipe.video?.height ?? recipe.still?.height ?? 0;
  return { path: target, recipe, width, height, frameTimestamps: layout.timestamps, frameCodes: layout.codes };
}
