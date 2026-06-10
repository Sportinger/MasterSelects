import { AudioExtractor, audioExtractor } from '../../engine/audio/AudioExtractor';
import type { ClipAudioEditOperation, SpectralImageLayer, TimelineClip } from '../../types';
import { Logger } from '../logger';
import type { MediaRuntimeLease, RuntimeSourceId } from '../mediaRuntime/contracts';
import {
  mediaRuntimeScrubAudioLeaseOwner,
  toScrubAudioRuntimeSourceId,
  type ScrubAudioContextRuntimeHandles,
} from '../mediaRuntime/scrubAudioLeases';
import { ClipAudioRenderService, type ClipAudioRenderProgress } from './ClipAudioRenderService';
import { getClipAudioSourceRange } from './audioRepairSuggestionOperations';

const log = Logger.create('AudioEditPreview');
const DEFAULT_PREVIEW_SECONDS = 8;
const OPERATION_PREROLL_SECONDS = 1;

type AudioContextConstructor = new () => AudioContext;

export type AudioEditPreviewPhase = 'rendering' | 'playing' | 'stopped' | 'error';
export type AudioEditPreviewMode = 'source' | 'stack' | 'operation';

export interface AudioEditPreviewStatus {
  phase: AudioEditPreviewPhase;
  previewId: string;
  message?: string;
  progress?: ClipAudioRenderProgress;
}

export interface AudioEditPreviewRequest {
  clip: TimelineClip;
  operations: readonly ClipAudioEditOperation[];
  mode: AudioEditPreviewMode;
  previewId?: string;
  timelineTime?: number;
  maxDurationSeconds?: number;
  includeSpectralLayers?: boolean;
  onStatus?: (status: AudioEditPreviewStatus) => void;
}

export interface AudioEditPreviewServiceOptions {
  extractor?: Pick<AudioExtractor, 'extractAudio'>;
  clipAudioRenderer?: Pick<ClipAudioRenderService, 'render'>;
  createAudioContext?: () => AudioContext;
}

interface ActivePreview {
  token: number;
  contextLease?: MediaRuntimeLease<ScrubAudioContextRuntimeHandles>;
  source?: AudioBufferSourceNode;
  stopped: boolean;
}

function getAudioContextConstructor(): AudioContextConstructor {
  const maybeWindow = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const ctor = globalThis.AudioContext ?? maybeWindow.webkitAudioContext;
  if (!ctor) {
    throw new Error('AudioContext is required for audio edit preview.');
  }
  return ctor;
}

function getClipMediaFileId(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function timelineTimeToSourceTime(clip: TimelineClip, timelineTime: number): number {
  const clipDuration = Math.max(0.001, clip.duration);
  const timelineRatio = clamp((timelineTime - clip.startTime) / clipDuration, 0, 1);
  const sourceRange = getClipAudioSourceRange(clip);
  const sourceSpan = Math.max(0.001, sourceRange.end - sourceRange.start);
  return clip.reversed
    ? sourceRange.end - timelineRatio * sourceSpan
    : sourceRange.start + timelineRatio * sourceSpan;
}

function getCombinedOperationRange(
  operations: readonly ClipAudioEditOperation[],
  sourceRange: { start: number; end: number },
): { start: number; end: number } | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;

  for (const operation of operations) {
    if (operation.enabled === false || !operation.timeRange) continue;
    const operationStart = clamp(Math.min(operation.timeRange.start, operation.timeRange.end), sourceRange.start, sourceRange.end);
    const operationEnd = clamp(Math.max(operation.timeRange.start, operation.timeRange.end), sourceRange.start, sourceRange.end);
    if (operationEnd <= operationStart) continue;
    start = Math.min(start, operationStart);
    end = Math.max(end, operationEnd);
  }

  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { start, end }
    : null;
}

function getPreviewSourceRange(
  clip: TimelineClip,
  operations: readonly ClipAudioEditOperation[],
  timelineTime: number | undefined,
  maxDurationSeconds: number,
): { start: number; end: number } {
  const sourceRange = getClipAudioSourceRange(clip);
  const sourceSpan = Math.max(0.001, sourceRange.end - sourceRange.start);
  const duration = Math.min(maxDurationSeconds, sourceSpan);
  if (duration >= sourceSpan - 0.0005) {
    return sourceRange;
  }

  const operationRange = getCombinedOperationRange(operations, sourceRange);
  if (operationRange) {
    const preroll = Math.min(OPERATION_PREROLL_SECONDS, duration * 0.2);
    const start = clamp(operationRange.start - preroll, sourceRange.start, Math.max(sourceRange.start, sourceRange.end - duration));
    return {
      start,
      end: Math.min(sourceRange.end, start + duration),
    };
  }

  const anchor = typeof timelineTime === 'number' &&
    timelineTime >= clip.startTime &&
    timelineTime <= clip.startTime + clip.duration
    ? timelineTimeToSourceTime(clip, timelineTime)
    : sourceRange.start;
  const start = clamp(anchor, sourceRange.start, Math.max(sourceRange.start, sourceRange.end - duration));
  return {
    start,
    end: Math.min(sourceRange.end, start + duration),
  };
}

function cloneOperations(operations: readonly ClipAudioEditOperation[]): ClipAudioEditOperation[] {
  return operations.map(operation => ({
    ...operation,
    params: { ...operation.params },
    timeRange: operation.timeRange ? { ...operation.timeRange } : undefined,
    channelMask: operation.channelMask ? [...operation.channelMask] : undefined,
  }));
}

function cloneSpectralLayers(layers: readonly SpectralImageLayer[] | undefined): SpectralImageLayer[] {
  return (layers ?? []).map(layer => ({
    ...layer,
    keyframes: layer.keyframes?.map(keyframe => ({ ...keyframe })),
  }));
}

function createPreviewClip(
  clip: TimelineClip,
  operations: readonly ClipAudioEditOperation[],
  previewRange: { start: number; end: number },
  includeSpectralLayers: boolean,
): TimelineClip {
  const previewDuration = Math.max(0.001, previewRange.end - previewRange.start);
  return {
    ...clip,
    startTime: 0,
    duration: previewDuration,
    inPoint: previewRange.start,
    outPoint: previewRange.end,
    speed: 1,
    reversed: false,
    preservesPitch: true,
    effects: [],
    audioState: {
      ...(clip.audioState ?? {}),
      muted: false,
      effectStack: [],
      editStack: cloneOperations(operations),
      spectralLayers: includeSpectralLayers ? cloneSpectralLayers(clip.audioState?.spectralLayers) : [],
    },
  };
}

export class AudioEditPreviewService {
  private readonly extractor: Pick<AudioExtractor, 'extractAudio'>;
  private readonly clipAudioRenderer: Pick<ClipAudioRenderService, 'render'>;
  private readonly createAudioContext: () => AudioContext;
  private activePreview: ActivePreview | null = null;
  private sequence = 0;

  constructor(options: AudioEditPreviewServiceOptions = {}) {
    this.extractor = options.extractor ?? audioExtractor;
    this.clipAudioRenderer = options.clipAudioRenderer ?? new ClipAudioRenderService();
    this.createAudioContext = options.createAudioContext ?? (() => new (getAudioContextConstructor())());
  }

  async preview(request: AudioEditPreviewRequest): Promise<void> {
    this.stop();

    const activeOperations = request.operations.filter(operation => operation.enabled !== false);
    if (request.mode !== 'source' && activeOperations.length === 0) {
      throw new Error('Cannot preview an empty audio edit stack.');
    }

    const previewId = request.previewId ?? (request.mode === 'source'
      ? 'source'
      : `${request.mode}:${activeOperations.map(operation => operation.id).join(',')}`);
    const maxDurationSeconds = Math.max(0.25, request.maxDurationSeconds ?? DEFAULT_PREVIEW_SECONDS);
    const includeSpectralLayers = request.includeSpectralLayers ?? request.mode === 'stack';
    const active: ActivePreview = {
      token: this.sequence + 1,
      stopped: false,
    };
    this.sequence = active.token;
    this.activePreview = active;

    request.onStatus?.({
      phase: 'rendering',
      previewId,
      message: request.mode === 'source'
        ? 'Rendering source preview'
        : request.mode === 'stack'
          ? 'Rendering edit stack preview'
          : 'Rendering operation preview',
    });

    try {
      const sourceBuffer = await this.extractor.extractAudio(
        request.clip.file,
        getClipMediaFileId(request.clip) ?? request.clip.id,
      );
      if (this.activePreview !== active || active.stopped) return;

      const previewRange = getPreviewSourceRange(request.clip, activeOperations, request.timelineTime, maxDurationSeconds);
      const previewClip = createPreviewClip(request.clip, activeOperations, previewRange, includeSpectralLayers);
      const rendered = await this.clipAudioRenderer.render({
        clip: previewClip,
        sourceBuffer,
        onProgress: progress => request.onStatus?.({
          phase: 'rendering',
          previewId,
          progress,
          message: progress.message,
        }),
      });
      if (this.activePreview !== active || active.stopped) return;

      await this.playRenderedBuffer(active, rendered.buffer, request, previewId, maxDurationSeconds);
    } catch (error) {
      if (this.activePreview === active && !active.stopped) {
        request.onStatus?.({
          phase: 'error',
          previewId,
          message: error instanceof Error ? error.message : 'Audio edit preview failed',
        });
        log.warn('Audio edit preview failed', { clipId: request.clip.id, mode: request.mode, error });
        this.stop();
      }
      throw error;
    }
  }

  stop(): void {
    const active = this.activePreview;
    if (!active) return;

    active.stopped = true;
    try {
      active.source?.stop();
    } catch {
      // Source may already be stopped by onended.
    }
    try {
      active.source?.disconnect();
    } catch {
      // Source may already be disconnected by the browser.
    }
    this.releasePlaybackContext(active, 'audio-edit-preview:stop');
    this.activePreview = null;
  }

  private getPlaybackContextRuntimeSourceId(): RuntimeSourceId {
    return toScrubAudioRuntimeSourceId('audio-edit-preview', 'playback-context');
  }

  private acquirePlaybackContext(active: ActivePreview): AudioContext {
    const lease = mediaRuntimeScrubAudioLeaseOwner.acquireAudioContext({
      runtimeSourceId: this.getPlaybackContextRuntimeSourceId(),
      ownerId: 'audio-edit-preview:playback-context',
      policy: 'interactive',
      createContext: this.createAudioContext,
    });
    const context = lease.getRuntimeHandles()?.context;
    if (!context) {
      lease.release('audio-edit-preview:missing-context');
      throw new Error('Audio edit preview context lease did not acquire a context');
    }
    active.contextLease = lease;
    return context;
  }

  private releasePlaybackContext(active: ActivePreview, reason: string): void {
    active.contextLease?.release(reason);
    active.contextLease = undefined;
  }

  private disconnectSource(active: ActivePreview, source: AudioBufferSourceNode): void {
    if (active.source === source) {
      active.source = undefined;
    }
    try {
      source.disconnect();
    } catch {
      // Source may already be disconnected by the browser.
    }
  }

  private async playRenderedBuffer(
    active: ActivePreview,
    buffer: AudioBuffer,
    request: AudioEditPreviewRequest,
    previewId: string,
    maxDurationSeconds: number,
  ): Promise<void> {
    try {
      const context = this.acquirePlaybackContext(active);
      if (context.state === 'suspended') {
        await context.resume();
      }
      if (this.activePreview !== active || active.stopped) {
        this.releasePlaybackContext(active, 'audio-edit-preview:cancelled-before-start');
        return;
      }

      const source = context.createBufferSource();
      active.source = source;
      source.buffer = buffer;
      source.connect(context.destination);

      const playbackDuration = Math.min(buffer.duration, maxDurationSeconds);

      request.onStatus?.({
        phase: 'playing',
        previewId,
        message: `Playing ${playbackDuration.toFixed(1)}s preview`,
      });

      await new Promise<void>((resolve, reject) => {
        source.onended = () => {
          if (this.activePreview === active) {
            this.activePreview = null;
          }
          active.stopped = true;
          this.disconnectSource(active, source);
          this.releasePlaybackContext(active, 'audio-edit-preview:ended');
          request.onStatus?.({
            phase: 'stopped',
            previewId,
            message: 'Preview stopped',
          });
          resolve();
        };
        try {
          source.start(0, 0, playbackDuration);
        } catch (error) {
          source.onended = null;
          this.disconnectSource(active, source);
          reject(error);
        }
      });
    } catch (error) {
      if (active.source) {
        this.disconnectSource(active, active.source);
      }
      this.releasePlaybackContext(active, 'audio-edit-preview:error');
      throw error;
    }
  }
}

export const audioEditPreviewService = new AudioEditPreviewService();
