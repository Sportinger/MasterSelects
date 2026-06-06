import { useTimelineStore } from '../../stores/timeline';
import type { TimelineClipDragPreview } from '../../stores/timeline/types';
import type { ClipAudioState } from '../../types/audio';
import {
  hasLegacyWaveformSamples,
  hasTimelineWaveformData,
} from '../../utils/audioWaveformPresence';
import {
  clearTimelineWarmupTimers,
  getTimelineWarmupTimerDeps,
} from './timelineWarmupTimers';

const DEFAULT_WAVEFORM_GENERATION_DELAY_MS = 300;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface TimelineSourceWaveformClipRef {
  id: string;
  name?: string;
  startTime?: number;
  duration?: number;
  mediaFileId?: string;
  file?: Pick<File, 'name' | 'size' | 'lastModified'>;
  waveform?: readonly number[];
  waveformChannels?: readonly (readonly number[])[];
  waveformGenerating?: boolean;
  audioState?: Pick<ClipAudioState, 'processedAnalysisRefs' | 'sourceAnalysisRefs'> | null;
  source?: {
    type?: string | null;
    mediaFileId?: string;
  } | null;
}

export interface TimelineSourceWaveformGenerationRequest {
  clipId: string;
  requestKey: string;
  mode?: string | null;
}

export interface TimelineSourceWaveformWarmupState {
  clips: readonly TimelineSourceWaveformClipRef[];
  isPlaying?: boolean;
  clipDragPreview?: TimelineClipDragPreview | null;
  generateWaveformForClip: (clipId: string) => Promise<void>;
}

export interface TimelineSourceWaveformWarmupDeps {
  getState: () => TimelineSourceWaveformWarmupState;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

export interface CollectVisibleTimelineSourceWaveformGenerationOptions {
  clips: readonly TimelineSourceWaveformClipRef[];
  scrollX: number;
  viewportWidth: number;
  overscanPx: number;
  timeToPixel: (time: number) => number;
  mode?: string | null;
}

export interface TimelineSourceWaveformWarmupOptions {
  deps?: TimelineSourceWaveformWarmupDeps;
  delayMs?: number;
}

export type TimelineSourceWaveformWarmupStatus =
  | 'generated'
  | 'ready'
  | 'blocked'
  | 'skipped';

export interface TimelineSourceWaveformWarmupResult {
  clipId: string;
  status: TimelineSourceWaveformWarmupStatus;
}

const scheduledSourceWaveformTimers = new Map<string, TimerHandle>();
const inFlightSourceWaveformGenerations = new Map<string, Promise<TimelineSourceWaveformWarmupResult>>();

function getDefaultDeps(): TimelineSourceWaveformWarmupDeps {
  return {
    getState: () => {
      const state = useTimelineStore.getState();
      return {
        clips: state.clips,
        isPlaying: state.isPlaying,
        clipDragPreview: state.clipDragPreview,
        generateWaveformForClip: state.generateWaveformForClip,
      };
    },
    ...getTimelineWarmupTimerDeps(),
  };
}

function isSourceWaveformClip(clip: TimelineSourceWaveformClipRef): boolean {
  return clip.source?.type === 'audio' || hasLegacyWaveformSamples(clip);
}

function canGenerateTimelineSourceWaveform(clip: TimelineSourceWaveformClipRef): boolean {
  return isSourceWaveformClip(clip) &&
    !clip.waveformGenerating &&
    !hasTimelineWaveformData(clip);
}

export function createTimelineSourceWaveformGenerationRequest(
  clip: TimelineSourceWaveformClipRef,
  mode?: string | null,
): TimelineSourceWaveformGenerationRequest | null {
  if (!canGenerateTimelineSourceWaveform(clip)) return null;

  const sourceKey = clip.file
    ? [
        clip.id,
        clip.file.name,
        clip.file.size,
        clip.file.lastModified,
      ].join(':')
    : [
        clip.id,
        clip.mediaFileId ?? clip.source?.mediaFileId ?? 'no-media-file',
        clip.name ?? '',
      ].join(':');

  return {
    clipId: clip.id,
    mode,
    requestKey: [
      clip.id,
      sourceKey,
      mode ?? 'detailed',
    ].join(':'),
  };
}

export function collectVisibleTimelineSourceWaveformGenerationRequests(
  options: CollectVisibleTimelineSourceWaveformGenerationOptions,
): TimelineSourceWaveformGenerationRequest[] {
  const visibleLeft = options.scrollX - options.overscanPx;
  const visibleRight = options.scrollX + options.viewportWidth + options.overscanPx;
  const requests: TimelineSourceWaveformGenerationRequest[] = [];
  const seen = new Set<string>();

  for (const clip of options.clips) {
    const startTime = clip.startTime ?? 0;
    const duration = clip.duration ?? 0;
    if (duration <= 0) continue;

    const left = options.timeToPixel(startTime);
    const width = options.timeToPixel(duration);
    if (left + width < visibleLeft || left > visibleRight) continue;

    const request = createTimelineSourceWaveformGenerationRequest(clip, options.mode);
    if (!request || seen.has(request.requestKey)) continue;
    seen.add(request.requestKey);
    requests.push(request);
  }

  return requests;
}

export async function warmTimelineSourceWaveformGeneration(
  request: TimelineSourceWaveformGenerationRequest,
  options: TimelineSourceWaveformWarmupOptions = {},
): Promise<TimelineSourceWaveformWarmupResult> {
  const deps = options.deps ?? getDefaultDeps();
  const state = deps.getState();
  if (state.isPlaying || state.clipDragPreview) {
    return { clipId: request.clipId, status: 'blocked' };
  }

  const clip = state.clips.find((candidate) => candidate.id === request.clipId);
  if (!clip) return { clipId: request.clipId, status: 'skipped' };
  if (hasTimelineWaveformData(clip)) return { clipId: request.clipId, status: 'ready' };

  const currentRequest = createTimelineSourceWaveformGenerationRequest(clip, request.mode);
  if (!currentRequest) return { clipId: request.clipId, status: 'skipped' };

  const inFlight = inFlightSourceWaveformGenerations.get(currentRequest.requestKey);
  if (inFlight) return inFlight;

  const generation = state.generateWaveformForClip(currentRequest.clipId)
    .then(() => ({ clipId: currentRequest.clipId, status: 'generated' as const }))
    .finally(() => {
      inFlightSourceWaveformGenerations.delete(currentRequest.requestKey);
    });

  inFlightSourceWaveformGenerations.set(currentRequest.requestKey, generation);
  return generation;
}

export function scheduleVisibleTimelineSourceWaveformGeneration(
  requests: readonly TimelineSourceWaveformGenerationRequest[],
  options: TimelineSourceWaveformWarmupOptions = {},
): () => void {
  const deps = options.deps ?? getDefaultDeps();
  const delayMs = options.delayMs ?? DEFAULT_WAVEFORM_GENERATION_DELAY_MS;
  const scheduled: Array<{ key: string; timer: TimerHandle }> = [];

  for (const request of requests) {
    if (
      scheduledSourceWaveformTimers.has(request.requestKey) ||
      inFlightSourceWaveformGenerations.has(request.requestKey)
    ) {
      continue;
    }

    const timer = deps.setTimeout(() => {
      if (scheduledSourceWaveformTimers.get(request.requestKey) !== timer) return;
      scheduledSourceWaveformTimers.delete(request.requestKey);
      void warmTimelineSourceWaveformGeneration(request, { deps });
    }, delayMs);

    scheduledSourceWaveformTimers.set(request.requestKey, timer);
    scheduled.push({ key: request.requestKey, timer });
  }

  return () => {
    for (const { key, timer } of scheduled) {
      if (scheduledSourceWaveformTimers.get(key) !== timer) continue;
      deps.clearTimeout(timer);
      scheduledSourceWaveformTimers.delete(key);
    }
  };
}

export function resetTimelineSourceWaveformWarmupForTest(): void {
  clearTimelineWarmupTimers(scheduledSourceWaveformTimers.values());
  scheduledSourceWaveformTimers.clear();
  inFlightSourceWaveformGenerations.clear();
}
