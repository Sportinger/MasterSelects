export type TimelineGridMode = 'frame' | 'time';

export interface TimelineGridPlan {
  mode: TimelineGridMode;
  frameRate: number;
  minorIntervalSeconds: number;
  majorIntervalSeconds: number;
  minorIntervalPixels: number;
  majorEveryMinor: number;
  labelMode: 'time' | 'timecode';
  timeIntervalSeconds: number;
  timeIntervalPixels: number;
  timeMajorIntervalSeconds: number;
  timeMajorEveryMinor: number;
  frameIntervalSeconds: number;
  frameIntervalPixels: number;
  frameMajorEveryMinor: number;
  frameGridOpacity: number;
  timeGridOpacity: number;
}

interface CreateTimelineGridPlanInput {
  zoom: number;
  frameRate?: number | null;
}

const DEFAULT_FRAME_RATE = 30;
const MIN_FRAME_LINE_PX = 6;
const FRAME_GRID_FADE_START_PX = 3;
const FRAME_GRID_FADE_END_PX = 9;
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

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function createTimelineGridPlan({
  zoom,
  frameRate,
}: CreateTimelineGridPlanInput): TimelineGridPlan {
  const safeZoom = sanitizePositiveNumber(zoom, 1);
  const safeFrameRate = sanitizePositiveNumber(frameRate, DEFAULT_FRAME_RATE);
  const frameDurationSeconds = 1 / safeFrameRate;
  const frameWidthPixels = safeZoom * frameDurationSeconds;
  const timeIntervalSeconds = getNiceSecondsAtLeast(TARGET_TIME_LINE_PX / safeZoom);
  const timeMajorIntervalSeconds = getNiceSecondsAtLeast(TARGET_LABEL_PX / safeZoom);
  const timeIntervalPixels = timeIntervalSeconds * safeZoom;
  const timeMajorEveryMinor = getMajorEveryMinor(timeMajorIntervalSeconds, timeIntervalSeconds);
  const labelFrameStep = getNiceFrameStepAtLeast(TARGET_LABEL_PX / frameWidthPixels);
  const frameGridOpacity = smoothstep(FRAME_GRID_FADE_START_PX, FRAME_GRID_FADE_END_PX, frameWidthPixels);
  const timeGridOpacity = 1 - frameGridOpacity;

  if (frameWidthPixels >= MIN_FRAME_LINE_PX) {
    const majorIntervalSeconds = labelFrameStep * frameDurationSeconds;

    return {
      mode: 'frame',
      frameRate: safeFrameRate,
      minorIntervalSeconds: frameDurationSeconds,
      majorIntervalSeconds,
      minorIntervalPixels: frameWidthPixels,
      majorEveryMinor: labelFrameStep,
      labelMode: 'timecode',
      timeIntervalSeconds,
      timeIntervalPixels,
      timeMajorIntervalSeconds,
      timeMajorEveryMinor,
      frameIntervalSeconds: frameDurationSeconds,
      frameIntervalPixels: frameWidthPixels,
      frameMajorEveryMinor: labelFrameStep,
      frameGridOpacity,
      timeGridOpacity,
    };
  }

  return {
    mode: 'time',
    frameRate: safeFrameRate,
    minorIntervalSeconds: timeIntervalSeconds,
    majorIntervalSeconds: timeMajorIntervalSeconds,
    minorIntervalPixels: timeIntervalPixels,
    majorEveryMinor: timeMajorEveryMinor,
    labelMode: 'time',
    timeIntervalSeconds,
    timeIntervalPixels,
    timeMajorIntervalSeconds,
    timeMajorEveryMinor,
    frameIntervalSeconds: frameDurationSeconds,
    frameIntervalPixels: frameWidthPixels,
    frameMajorEveryMinor: labelFrameStep,
    frameGridOpacity,
    timeGridOpacity,
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

export function formatTimelineFrameNumber(seconds: number, frameRate: number): string {
  const safeFrameRate = sanitizePositiveNumber(frameRate, DEFAULT_FRAME_RATE);
  return Math.max(0, Math.round(seconds * safeFrameRate)).toString();
}
