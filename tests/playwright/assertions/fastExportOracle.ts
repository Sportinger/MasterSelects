import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { FLASH_SQUARE_FRACTION } from '../fixtures/fastExportSources';
import { meanRgbRect, readFrameCode, streamVideoFrames, type FrameCodeReading } from './frameCodeOracle';

// Oracle of the Fast export journeys (tests/playwright/export/fast). The exported file is decoded
// outside the browser under test with ffmpeg (as every export oracle here): each frame's code is
// read with the shared frame-code reader (assertions/frameCodeOracle.ts) and compared with the
// expected source frame; flash frames and audio clicks (fixtures/fastExportSources.ts) give the
// A/V offset.

const run = promisify(execFile);
const CLICK_SAMPLE_RATE = 48_000;

export interface ExportedFrame {
  /** Seconds from the first video frame (the exports are constant-rate). */
  time: number;
  reading: FrameCodeReading;
  flashLuma: number;
  centre: [number, number, number];
}

export interface FastExportReading {
  frames: ExportedFrame[];
  /** Decoded frame number per output frame, null when unreadable. */
  codes: Array<number | null>;
  flashTimes: number[];
  /** Click times in seconds from the first video frame, or null without an audio track. */
  clickTimes: number[] | null;
}

const luma = ([r, g, b]: [number, number, number]) => 0.299 * r + 0.587 * g + 0.114 * b;

async function streamStartTimes(file: string): Promise<{ video: number; audio: number | null }> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,start_time', '-of', 'json', file]);
  const streams = (JSON.parse(stdout) as { streams: Array<{ codec_type: string; start_time?: string }> }).streams;
  const start = (type: string) => {
    const stream = streams.find(item => item.codec_type === type);
    return stream ? Number(stream.start_time ?? 0) || 0 : null;
  };
  return { video: start('video') ?? 0, audio: start('audio') };
}

/** Mono float samples of the file's audio, decoded by ffmpeg. */
async function decodeAudio(file: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(CLICK_SAMPLE_RATE), '-f', 'f32le', 'pipe:1']);
    const chunks: Buffer[] = [];
    let errors = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
    child.on('error', error => reject((error as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('ffmpeg is not installed on this test host') : error));
    child.on('close', code => {
      if (code !== 0) { reject(new Error(`ffmpeg could not decode the audio of ${file}: ${errors.trim().slice(0, 400)}`)); return; }
      const bytes = Buffer.concat(chunks);
      resolve(new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4)));
    });
  });
}

/** A click is the first loud sample after at least 0.3 s of quiet. */
export function findClicks(samples: Float32Array, sampleRate: number, offsetSeconds = 0): number[] {
  const clicks: number[] = [];
  let lastLoud = -Infinity;
  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index]) <= 0.2) continue;
    const time = offsetSeconds + index / sampleRate;
    if (time - lastLoud > 0.3) clicks.push(time);
    lastLoud = time;
  }
  return clicks;
}

/** Decodes an exported file completely and reads every frame and click. */
export async function readFastExport(file: string, { fps, hasAudio }: { fps: number; hasAudio: boolean }): Promise<FastExportReading> {
  const frames: ExportedFrame[] = [];
  await streamVideoFrames(file, (pixels, index) => {
    const { width, height } = pixels;
    const flash = Math.max(2, Math.round(Math.min(width, height) * FLASH_SQUARE_FRACTION));
    const flashLuma = luma(meanRgbRect(pixels, width - flash * 0.75, height - flash * 0.75, width - flash * 0.25, height - flash * 0.25));
    const cx = Math.floor(width / 2), cy = Math.floor(height / 2);
    frames.push({ time: index / fps, reading: readFrameCode(pixels), flashLuma, centre: meanRgbRect(pixels, cx - 2, cy - 2, cx + 2, cy + 2) });
  }, { scaleWidth: 320 });
  let clickTimes: number[] | null = null;
  if (hasAudio) {
    const starts = await streamStartTimes(file);
    clickTimes = findClicks(await decodeAudio(file), CLICK_SAMPLE_RATE, (starts.audio ?? starts.video) - starts.video);
  }
  return {
    frames,
    codes: frames.map(frame => frame.reading.frame),
    flashTimes: frames.filter(frame => frame.flashLuma > 160).map(frame => frame.time),
    clickTimes,
  };
}

/**
 * Expected source frame for each output frame of a constant-rate export. Fast export resolves
 * an output time to the nearest source sample, a tie going to the later one
 * (src/engine/webcodecs/sampleTimeline.ts). Constant-rate sources at the output rate map 1:1.
 */
export function expectedSourceFrames(options: {
  outputFrames: number;
  outputFps: number;
  /** Source time (seconds) of output frame 0. */
  sourceStart: number;
  /** Source playback speed (1 = real time). */
  speed?: number;
  /** Timestamp (seconds) of every source frame, ascending. */
  sourceTimestamps: readonly number[];
}): number[] {
  const { outputFrames, outputFps, sourceStart, sourceTimestamps } = options;
  const speed = options.speed ?? 1;
  const epsilon = 1e-6;
  const frames: number[] = [];
  let cursor = 0;
  for (let frame = 0; frame < outputFrames; frame += 1) {
    const time = sourceStart + (frame / outputFps) * speed;
    // First sample at or after the time, then step back if the previous one is strictly nearer.
    while (cursor < sourceTimestamps.length - 1 && sourceTimestamps[cursor] < time - epsilon) cursor += 1;
    let pick = cursor;
    if (pick > 0 && Math.abs(sourceTimestamps[pick - 1] - time) < Math.abs(sourceTimestamps[pick] - time) - epsilon) pick -= 1;
    frames.push(pick);
  }
  return frames;
}

export interface SequenceProblem { outputFrame: number; expected: number | null; actual: number | null }

/** Every output frame whose code differs from the expectation (gaps, duplicates, wrong trim or mapping). */
export function compareFrameSequence(actual: readonly (number | null)[], expected: readonly (number | null)[]): SequenceProblem[] {
  const problems: SequenceProblem[] = [];
  for (let frame = 0; frame < Math.max(actual.length, expected.length); frame += 1) {
    const want = frame < expected.length ? expected[frame] : null;
    const got = frame < actual.length ? actual[frame] : null;
    if (want !== got) problems.push({ outputFrame: frame, expected: want, actual: got });
  }
  return problems;
}

export function describeSequenceProblems(problems: readonly SequenceProblem[], limit = 12): string {
  const shown = problems.slice(0, limit)
    .map(problem => `frame ${problem.outputFrame}: expected ${problem.expected ?? 'none'}, got ${problem.actual ?? 'unreadable'}`);
  return `${problems.length} frame(s) differ: ${shown.join('; ')}${problems.length > limit ? '; …' : ''}`;
}

/** Fails with the exact differing frames when the decoded codes differ from the expectation. */
export function assertFrameCodes(actual: readonly (number | null)[], expected: readonly (number | null)[], label: string): void {
  const problems = compareFrameSequence(actual, expected);
  if (problems.length) throw new Error(`${label}: ${describeSequenceProblems(problems)}`);
}

/**
 * Audio/video sync: every flash frame (whole source second) is paired with its nearest click;
 * at least `minimumPairs` pairs must exist and none may be further apart than `toleranceSeconds`.
 * Returns the offsets (click minus flash).
 */
export function assertAudioVideoSync(read: Pick<FastExportReading, 'flashTimes' | 'clickTimes'>, toleranceSeconds: number, minimumPairs: number): number[] {
  if (!read.clickTimes) throw new Error('Export has no audio track to check sync against.');
  const clicks = read.clickTimes;
  const offsets = read.flashTimes.flatMap(flash => {
    const nearest = clicks.reduce((best, click) => (Math.abs(click - flash) < Math.abs(best - flash) ? click : best), Infinity);
    return Number.isFinite(nearest) ? [nearest - flash] : [];
  });
  if (offsets.length < minimumPairs) {
    throw new Error(`Only ${offsets.length} flash/click pairs found (flashes ${read.flashTimes.length}, `
      + `clicks ${clicks.length}); expected at least ${minimumPairs}.`);
  }
  const worst = offsets.reduce((max, offset) => Math.max(max, Math.abs(offset)), 0);
  if (worst > toleranceSeconds) {
    throw new Error(`Audio/video offset up to ${(worst * 1000).toFixed(1)} ms exceeds ${(toleranceSeconds * 1000).toFixed(1)} ms `
      + `(offsets ms: ${offsets.map(offset => (offset * 1000).toFixed(1)).join(', ')}).`);
  }
  return offsets;
}
