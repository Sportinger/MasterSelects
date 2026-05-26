import type { TimelineClip, TimelineTrack } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import { playheadState } from '../layerBuilder/PlayheadState';
import { audioManager, audioStatusTracker } from '../audioManager';
import { audioRoutingManager } from '../audioRoutingManager';
import { vfPipelineMonitor, type VFPipelineEvent } from '../vfPipelineMonitor';

const DEFAULT_AUDIO_DIAGNOSTICS_WINDOW_MS = 5000;
const MAX_AUDIO_DIAGNOSTICS_WINDOW_MS = 120000;
const DEFAULT_AUDIO_EVENT_LIMIT = 50;
const MAX_AUDIO_EVENT_LIMIT = 500;

const READY_STATE_LABELS = [
  'HAVE_NOTHING',
  'HAVE_METADATA',
  'HAVE_CURRENT_DATA',
  'HAVE_FUTURE_DATA',
  'HAVE_ENOUGH_DATA',
];

const NETWORK_STATE_LABELS = [
  'NETWORK_EMPTY',
  'NETWORK_IDLE',
  'NETWORK_LOADING',
  'NETWORK_NO_SOURCE',
];

export interface AudioDiagnosticsOptions {
  windowMs?: number;
  eventLimit?: number;
}

function round(value: number, decimals = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function numericDetail(event: VFPipelineEvent, key: string): number | undefined {
  const value = event.detail?.[key];
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function summarizeNumbers(values: number[]): Record<string, number> {
  if (values.length === 0) {
    return { count: 0, avg: 0, max: 0 };
  }
  const absValues = values.map(value => Math.abs(value));
  return {
    count: values.length,
    avg: round(absValues.reduce((sum, value) => sum + value, 0) / absValues.length, 2),
    max: round(Math.max(...absValues), 2),
  };
}

function serializeTimeRanges(ranges: TimeRanges, currentTime: number): Record<string, unknown> {
  const serialized: Array<{ start: number; end: number }> = [];
  let currentRangeIndex = -1;
  let bufferedAheadSeconds = 0;
  let bufferedBehindSeconds = 0;
  let nextRangeStartDeltaSeconds: number | null = null;

  for (let index = 0; index < ranges.length; index += 1) {
    const start = ranges.start(index);
    const end = ranges.end(index);
    if (serialized.length < 5) {
      serialized.push({ start: round(start), end: round(end) });
    }
    if (currentTime >= start && currentTime <= end) {
      currentRangeIndex = index;
      bufferedAheadSeconds = Math.max(0, end - currentTime);
      bufferedBehindSeconds = Math.max(0, currentTime - start);
    } else if (currentTime < start && nextRangeStartDeltaSeconds === null) {
      nextRangeStartDeltaSeconds = start - currentTime;
    }
  }

  return {
    count: ranges.length,
    ranges: serialized,
    currentRangeIndex,
    bufferedAheadSeconds: round(bufferedAheadSeconds),
    bufferedBehindSeconds: round(bufferedBehindSeconds),
    nextRangeStartDeltaSeconds: nextRangeStartDeltaSeconds === null
      ? null
      : round(nextRangeStartDeltaSeconds),
  };
}

function sourceSummary(element: HTMLMediaElement): Record<string, unknown> {
  const currentSrc = element.currentSrc || element.src || '';
  const srcKind = currentSrc.startsWith('blob:')
    ? 'blob'
    : currentSrc.startsWith('data:')
      ? 'data'
      : currentSrc
        ? 'url'
        : 'none';

  return {
    hasSrc: Boolean(currentSrc),
    srcKind,
    srcTail: currentSrc ? currentSrc.slice(-32) : '',
  };
}

function getApproxExpectedSourceTime(clip: TimelineClip, playheadPosition: number): number | null {
  const localTime = playheadPosition - clip.startTime;
  if (localTime < 0 || localTime > clip.duration) return null;
  return clamp(clip.inPoint + localTime, clip.inPoint, clip.outPoint);
}

function serializeMediaElement(
  element: HTMLMediaElement,
  role: string,
  clip: TimelineClip | null,
  track: TimelineTrack | undefined,
  playheadPosition: number,
): Record<string, unknown> {
  const expectedSourceTime = clip ? getApproxExpectedSourceTime(clip, playheadPosition) : null;
  const driftMsApprox = expectedSourceTime === null
    ? null
    : round((element.currentTime - expectedSourceTime) * 1000, 1);
  const playing = !element.paused && !element.ended;
  const audible = playing && !element.muted && element.volume > 0;

  return {
    role,
    clipId: clip?.id,
    clipName: clip?.name,
    trackId: track?.id ?? clip?.trackId,
    trackName: track?.name,
    trackType: track?.type,
    activeAtPlayhead: expectedSourceTime !== null,
    expectedSourceTimeApprox: expectedSourceTime === null ? null : round(expectedSourceTime),
    driftMsApprox,
    playing,
    audible,
    tagName: element.tagName.toLowerCase(),
    paused: element.paused,
    ended: element.ended,
    muted: element.muted,
    volume: round(element.volume),
    playbackRate: round(element.playbackRate),
    defaultPlaybackRate: round(element.defaultPlaybackRate),
    currentTime: round(element.currentTime),
    duration: Number.isFinite(element.duration) ? round(element.duration) : null,
    readyState: element.readyState,
    readyStateLabel: READY_STATE_LABELS[element.readyState] ?? String(element.readyState),
    networkState: element.networkState,
    networkStateLabel: NETWORK_STATE_LABELS[element.networkState] ?? String(element.networkState),
    seeking: element.seeking,
    buffered: serializeTimeRanges(element.buffered, element.currentTime),
    seekable: serializeTimeRanges(element.seekable, element.currentTime),
    error: element.error
      ? {
          code: element.error.code,
          message: element.error.message,
        }
      : null,
    ...sourceSummary(element),
  };
}

function summarizeAudioEvents(events: VFPipelineEvent[], limit: number): Record<string, unknown> {
  const now = performance.now();
  const counts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  const drifts: number[] = [];
  const corrections: number[] = [];
  const statusTimes: number[] = [];

  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;

    if (event.type === 'audio_status') {
      const status = typeof event.detail?.status === 'string' ? event.detail.status : 'unknown';
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      statusTimes.push(event.t);
    }

    if (event.type === 'audio_drift') {
      const driftMs = numericDetail(event, 'driftMs');
      if (driftMs !== undefined) drifts.push(driftMs);
    }

    if (event.type === 'audio_drift_correct') {
      const driftMs = numericDetail(event, 'driftMs');
      if (driftMs !== undefined) corrections.push(driftMs);
    }
  }

  const statusGaps = statusTimes.slice(1).map((timestamp, index) => timestamp - statusTimes[index]);

  return {
    eventCount: events.length,
    counts,
    statusCounts,
    driftMs: summarizeNumbers(drifts),
    correctionMs: summarizeNumbers(corrections),
    statusGapMs: summarizeNumbers(statusGaps),
    recentEvents: events.slice(-limit).map(event => ({
      type: event.type,
      ageMs: round(now - event.t, 1),
      detail: event.detail ?? {},
    })),
  };
}

export function collectAudioDiagnostics(
  options: AudioDiagnosticsOptions = {},
): Record<string, unknown> {
  const windowMs = clamp(
    Number(options.windowMs) || DEFAULT_AUDIO_DIAGNOSTICS_WINDOW_MS,
    100,
    MAX_AUDIO_DIAGNOSTICS_WINDOW_MS,
  );
  const eventLimit = Math.round(clamp(
    Number(options.eventLimit) || DEFAULT_AUDIO_EVENT_LIMIT,
    1,
    MAX_AUDIO_EVENT_LIMIT,
  ));
  const timelineState = useTimelineStore.getState();
  const playheadPosition = playheadState.isUsingInternalPosition
    ? playheadState.position
    : timelineState.playheadPosition;
  const tracksById = new Map(timelineState.tracks.map(track => [track.id, track]));
  const mediaElements: Record<string, unknown>[] = [];

  for (const clip of timelineState.clips) {
    const track = tracksById.get(clip.trackId);
    if (clip.source?.audioElement) {
      mediaElements.push(serializeMediaElement(clip.source.audioElement, 'clip-audio', clip, track, playheadPosition));
    }
    if (clip.source?.videoElement) {
      mediaElements.push(serializeMediaElement(clip.source.videoElement, 'clip-video', clip, track, playheadPosition));
    }
    if (clip.mixdownAudio) {
      mediaElements.push(serializeMediaElement(clip.mixdownAudio, 'mixdown', clip, track, playheadPosition));
    }
  }

  const audioEvents = vfPipelineMonitor.audioTimeline(windowMs);

  return {
    timestamp: Date.now(),
    windowMs,
    eventLimit,
    timeline: {
      isPlaying: timelineState.isPlaying,
      isDraggingPlayhead: timelineState.isDraggingPlayhead,
      playbackSpeed: timelineState.playbackSpeed,
      storePlayheadPosition: round(timelineState.playheadPosition),
      internalPlayheadPosition: round(playheadState.position),
      effectivePlayheadPosition: round(playheadPosition),
      audioTrackCount: timelineState.tracks.filter(track => track.type === 'audio').length,
      audioClipCount: timelineState.clips.filter(clip => clip.source?.audioElement || clip.mixdownAudio).length,
    },
    masterClock: {
      hasMasterAudio: playheadState.hasMasterAudio,
      isUsingInternalPosition: playheadState.isUsingInternalPosition,
      playbackJustStarted: playheadState.playbackJustStarted,
      masterClipStartTime: round(playheadState.masterClipStartTime),
      masterClipInPoint: round(playheadState.masterClipInPoint),
      masterClipSpeed: round(playheadState.masterClipSpeed),
      heldPlaybackPosition: playheadState.heldPlaybackPosition === null
        ? null
        : round(playheadState.heldPlaybackPosition),
      heldPlaybackClipId: playheadState.heldPlaybackClipId,
      element: playheadState.masterAudioElement
        ? serializeMediaElement(playheadState.masterAudioElement, 'master-clock', null, undefined, playheadPosition)
        : null,
    },
    status: audioStatusTracker.getStatus(),
    audioManager: audioManager.getDebugSnapshot(),
    routing: audioRoutingManager.getDebugSnapshot(),
    mediaSummary: {
      elementCount: mediaElements.length,
      playingElementCount: mediaElements.filter(element => element.playing === true).length,
      audibleElementCount: mediaElements.filter(element => element.audible === true).length,
      lowReadyStatePlayingCount: mediaElements.filter(element => (
        element.playing === true && typeof element.readyState === 'number' && element.readyState < 3
      )).length,
      seekingElementCount: mediaElements.filter(element => element.seeking === true).length,
    },
    mediaElements,
    events: summarizeAudioEvents(audioEvents, eventLimit),
  };
}
