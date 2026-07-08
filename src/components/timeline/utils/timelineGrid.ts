import type { RulerLaneFormat, TempoMap } from '../../../types';
import { iterateBarBeatLines } from '../../../timeline/tempo/TempoMap';

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
const MIN_FRAME_LINE_PX = 16;
const FRAME_GRID_FADE_START_PX = 10;
const FRAME_GRID_FADE_END_PX = MIN_FRAME_LINE_PX;
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

export function getTimelineDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  return sanitizePositiveNumber(window.devicePixelRatio, 1);
}

export function alignTimelineGridPixel(value: number, devicePixelRatio = 1): number {
  const safeDevicePixelRatio = sanitizePositiveNumber(devicePixelRatio, 1);
  return Math.round(value * safeDevicePixelRatio) / safeDevicePixelRatio;
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
  const frameLinesResolvable = frameWidthPixels >= MIN_FRAME_LINE_PX;
  const timeGridOpacity = frameLinesResolvable ? 0 : 1 - frameGridOpacity;

  if (frameLinesResolvable) {
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
      frameGridOpacity: 1,
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

// MM:SS.cc clock label (cc = centiseconds). The single source of truth for the
// timeline's plain time labels: both the timeline helpers hook and the piano-roll
// Time lane import this so their labels are byte-identical by construction
// (issue #249, §6 of the rulers plan).
export function formatTimelineClock(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

// ─── Per-lane ruler ticks (issue #257, Packet 4) ─────────────────────────────
//
// Unlike createTimelineGridPlan (which couples format selection with tick density
// and crossfades frame<->time by zoom — the old single-row behavior), these
// generators take a FIXED lane format and compute only density at the current
// zoom. A `frames` lane always shows frames, a `time` lane always shows time:
// the format never changes, only how many ticks are drawn. Pure (time-domain
// only); the component multiplies `time * zoom` for pixels.

export type RulerTickKind = 'major' | 'minor';

export interface RulerTick {
  time: number;
  kind: RulerTickKind;
  label: string | null;
}

export interface LinearLaneTicksInput {
  format: Exclude<RulerLaneFormat, 'bars'>;
  zoom: number;
  frameRate?: number | null;
  startTime: number;
  endTime: number;
  duration: number;
  formatTime: (seconds: number) => string;
}

function createTimeLaneTicks(
  input: LinearLaneTicksInput,
  from: number,
  to: number,
  safeZoom: number,
): RulerTick[] {
  const minorIntervalSeconds = getNiceSecondsAtLeast(TARGET_TIME_LINE_PX / safeZoom);
  const majorIntervalSeconds = getNiceSecondsAtLeast(TARGET_LABEL_PX / safeZoom);
  const majorEveryMinor = getMajorEveryMinor(majorIntervalSeconds, minorIntervalSeconds);
  const firstIndex = Math.max(0, Math.floor(from / minorIntervalSeconds));
  const lastIndex = Math.max(firstIndex, Math.ceil(to / minorIntervalSeconds));

  const ticks: RulerTick[] = [];
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const time = index * minorIntervalSeconds;
    if (time < 0 || time > input.duration) continue;
    const isMajor = index % majorEveryMinor === 0;
    ticks.push({ time, kind: isMajor ? 'major' : 'minor', label: isMajor ? input.formatTime(time) : null });
  }
  return ticks;
}

function createFrameLaneTicks(
  input: LinearLaneTicksInput,
  from: number,
  to: number,
  safeZoom: number,
  safeFrameRate: number,
): RulerTick[] {
  const frameDurationSeconds = 1 / safeFrameRate;
  const frameWidthPixels = safeZoom * frameDurationSeconds;
  // When single frames resolve we tick every frame; otherwise step up to a "nice"
  // frame count. Density adapts — the format (frame number / timecode) does not.
  const minorStepFrames = frameWidthPixels >= MIN_FRAME_LINE_PX
    ? 1
    : getNiceFrameStepAtLeast(MIN_FRAME_LINE_PX / frameWidthPixels);
  const majorStepFrames = Math.max(
    minorStepFrames,
    getNiceFrameStepAtLeast(TARGET_LABEL_PX / frameWidthPixels),
  );
  const majorEveryMinor = Math.max(1, Math.round(majorStepFrames / minorStepFrames));

  const firstIndex = Math.max(0, Math.floor(from / frameDurationSeconds / minorStepFrames));
  const lastIndex = Math.max(firstIndex, Math.ceil(to / frameDurationSeconds / minorStepFrames));

  const ticks: RulerTick[] = [];
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const frame = index * minorStepFrames;
    const time = frame * frameDurationSeconds;
    if (time < 0 || time > input.duration) continue;
    const isMajor = index % majorEveryMinor === 0;
    const label = isMajor
      ? (input.format === 'frames'
        ? formatTimelineFrameNumber(time, safeFrameRate)
        : formatTimelineTimecode(time, safeFrameRate))
      : null;
    ticks.push({ time, kind: isMajor ? 'major' : 'minor', label });
  }
  return ticks;
}

// Linear lanes: `time` (seconds), `timecode` (HH:MM:SS:FF), `frames` (frame #).
// timecode shares the frame-driven density of frames but labels as a timecode
// string — it is a standalone lane here (today it only exists as a label style
// inside frame mode).
export function createLinearLaneTicks(input: LinearLaneTicksInput): RulerTick[] {
  const safeZoom = sanitizePositiveNumber(input.zoom, 1);
  const safeFrameRate = sanitizePositiveNumber(input.frameRate, DEFAULT_FRAME_RATE);
  const from = Math.max(0, input.startTime);
  const to = Math.min(input.duration, input.endTime);
  if (to < from) return [];

  if (input.format === 'time') {
    return createTimeLaneTicks(input, from, to, safeZoom);
  }
  return createFrameLaneTicks(input, from, to, safeZoom, safeFrameRate);
}

export interface BarsLaneTicksInput {
  tempoMap: TempoMap;
  zoom: number;
  startTime: number;
  endTime: number;
  duration: number;
}

const MIN_BEAT_TICK_PX = 14;
const MIN_BAR_TICK_PX = 4;
const MIN_BAR_LABEL_PX = 36;

// Bars lane: time projected through the TempoMap (variable spacing ready; constant
// for the single 4/4@60 map). Thins by pixel spacing so beats/bars never merge.
export function createBarsLaneTicks(input: BarsLaneTicksInput): RulerTick[] {
  const safeZoom = sanitizePositiveNumber(input.zoom, 1);
  const from = Math.max(0, input.startTime);
  const to = Math.min(input.duration, input.endTime);
  if (to < from) return [];

  const lines = iterateBarBeatLines(input.tempoMap, from, to);
  if (lines.length === 0) return [];

  const beatPixels = lines.length >= 2
    ? Math.abs(lines[1].time - lines[0].time) * safeZoom
    : Number.POSITIVE_INFINITY;
  const barStarts = lines.filter(line => line.isBarStart);
  const barPixels = barStarts.length >= 2
    ? Math.abs(barStarts[1].time - barStarts[0].time) * safeZoom
    : beatPixels * 4;

  const showBeats = beatPixels >= MIN_BEAT_TICK_PX;
  const barStride = barPixels > 0 ? Math.max(1, Math.ceil(MIN_BAR_TICK_PX / barPixels)) : 1;
  const showLabels = barPixels * barStride >= MIN_BAR_LABEL_PX;

  const ticks: RulerTick[] = [];
  for (const line of lines) {
    if (line.time < 0 || line.time > input.duration) continue;
    if (line.isBarStart) {
      if ((line.bar - 1) % barStride !== 0) continue;
      ticks.push({ time: line.time, kind: 'major', label: showLabels ? String(line.bar) : null });
    } else if (showBeats && barStride === 1) {
      ticks.push({ time: line.time, kind: 'minor', label: null });
    }
  }
  return ticks;
}
