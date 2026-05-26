export type TimelineGridMode = 'frame' | 'time';

export interface TimelineGridPlan {
  mode: TimelineGridMode;
  frameRate: number;
  minorIntervalSeconds: number;
  majorIntervalSeconds: number;
  minorIntervalPixels: number;
  majorEveryMinor: number;
  labelMode: 'time' | 'timecode';
}

interface CreateTimelineGridPlanInput {
  zoom: number;
  frameRate?: number | null;
}

const DEFAULT_FRAME_RATE = 30;
const MIN_FRAME_LINE_PX = 6;
const TARGET_TIME_LINE_PX = 40;
const TARGET_LABEL_PX = 120;
const NICE_SECONDS = [1, 2, 5];
const NICE_FRAME_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 25, 30, 40, 50, 60, 75, 100, 120, 150, 200, 300, 600];

function sanitizePositiveNumber(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function getNiceSecondsAtLeast(minSeconds: number): number {
  const safeMin = Math.max(0.001, minSeconds);
  const exponent = Math.floor(Math.log10(safeMin));

  for (let power = exponent - 1; power <= exponent + 4; power += 1) {
    const scale = 10 ** power;
    for (const step of NICE_SECONDS) {
      const candidate = step * scale;
      if (candidate >= safeMin - Number.EPSILON) {
        return candidate;
      }
    }
  }

  return safeMin;
}

function getNiceFrameStepAtLeast(minFrames: number): number {
  const safeMin = Math.max(1, Math.ceil(minFrames));
  const predefined = NICE_FRAME_STEPS.find((step) => step >= safeMin);
  if (predefined) return predefined;
  return Math.ceil(safeMin / 300) * 300;
}

function getMajorEveryMinor(majorIntervalSeconds: number, minorIntervalSeconds: number): number {
  return Math.max(1, Math.round(majorIntervalSeconds / Math.max(minorIntervalSeconds, 0.001)));
}

export function createTimelineGridPlan({
  zoom,
  frameRate,
}: CreateTimelineGridPlanInput): TimelineGridPlan {
  const safeZoom = sanitizePositiveNumber(zoom, 1);
  const safeFrameRate = sanitizePositiveNumber(frameRate, DEFAULT_FRAME_RATE);
  const frameDurationSeconds = 1 / safeFrameRate;
  const frameWidthPixels = safeZoom * frameDurationSeconds;

  if (frameWidthPixels >= MIN_FRAME_LINE_PX) {
    const labelFrameStep = getNiceFrameStepAtLeast(TARGET_LABEL_PX / frameWidthPixels);
    const majorIntervalSeconds = labelFrameStep * frameDurationSeconds;

    return {
      mode: 'frame',
      frameRate: safeFrameRate,
      minorIntervalSeconds: frameDurationSeconds,
      majorIntervalSeconds,
      minorIntervalPixels: frameWidthPixels,
      majorEveryMinor: labelFrameStep,
      labelMode: 'timecode',
    };
  }

  const minorIntervalSeconds = getNiceSecondsAtLeast(TARGET_TIME_LINE_PX / safeZoom);
  const majorIntervalSeconds = getNiceSecondsAtLeast(TARGET_LABEL_PX / safeZoom);

  return {
    mode: 'time',
    frameRate: safeFrameRate,
    minorIntervalSeconds,
    majorIntervalSeconds,
    minorIntervalPixels: minorIntervalSeconds * safeZoom,
    majorEveryMinor: getMajorEveryMinor(majorIntervalSeconds, minorIntervalSeconds),
    labelMode: 'time',
  };
}

export function formatTimelineTimecode(seconds: number, frameRate: number): string {
  const safeFrameRate = sanitizePositiveNumber(frameRate, DEFAULT_FRAME_RATE);
  const displayFrameRate = Math.max(1, Math.round(safeFrameRate));
  const totalFrames = Math.max(0, Math.round(seconds * safeFrameRate));
  const frames = totalFrames % displayFrameRate;
  const totalWholeSeconds = Math.floor(totalFrames / displayFrameRate);
  const secs = totalWholeSeconds % 60;
  const mins = Math.floor(totalWholeSeconds / 60) % 60;
  const hours = Math.floor(totalWholeSeconds / 3600);

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  }

  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}
