import { AudioExtractor, audioExtractor } from '../../engine/audio/AudioExtractor';
import type { ClipAudioEditOperation, TimelineClip } from '../../types';
import { Logger } from '../logger';
import { ClipAudioRenderService, type ClipAudioRenderProgress } from './ClipAudioRenderService';
import {
  createAudioRepairSuggestionOperation,
  getClipAudioSourceRange,
  type AudioRepairSuggestionOperationInput,
} from './audioRepairSuggestionOperations';

const log = Logger.create('AudioRepairPreview');
const DEFAULT_PREVIEW_SECONDS = 8;

type AudioContextConstructor = new () => AudioContext;

export type AudioRepairPreviewPhase = 'rendering' | 'playing' | 'stopped' | 'error';

export interface AudioRepairPreviewStatus {
  phase: AudioRepairPreviewPhase;
  suggestionId: string;
  message?: string;
  progress?: ClipAudioRenderProgress;
}

export interface AudioRepairPreviewRequest {
  clip: TimelineClip;
  suggestion: AudioRepairSuggestionOperationInput;
  timelineTime?: number;
  maxDurationSeconds?: number;
  onStatus?: (status: AudioRepairPreviewStatus) => void;
}

export interface AudioRepairPreviewServiceOptions {
  extractor?: Pick<AudioExtractor, 'extractAudio'>;
  clipAudioRenderer?: Pick<ClipAudioRenderService, 'render'>;
  createAudioContext?: () => AudioContext;
}

interface ActivePreview {
  token: number;
  context?: AudioContext;
  source?: AudioBufferSourceNode;
  stopped: boolean;
}

function getAudioContextConstructor(): AudioContextConstructor {
  const maybeWindow = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const ctor = globalThis.AudioContext ?? maybeWindow.webkitAudioContext;
  if (!ctor) {
    throw new Error('AudioContext is required for audio repair preview.');
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

function getPreviewSourceRange(
  clip: TimelineClip,
  timelineTime: number | undefined,
  maxDurationSeconds: number,
): { start: number; end: number } {
  const sourceRange = getClipAudioSourceRange(clip);
  const duration = Math.min(maxDurationSeconds, Math.max(0.001, sourceRange.end - sourceRange.start));
  if (duration >= sourceRange.end - sourceRange.start - 0.0005) {
    return sourceRange;
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

function createPreviewClip(
  clip: TimelineClip,
  operation: ClipAudioEditOperation,
  previewRange: { start: number; end: number },
): TimelineClip {
  const previewDuration = Math.max(0.001, previewRange.end - previewRange.start);
  return {
    ...clip,
    startTime: 0,
    duration: previewDuration,
    inPoint: previewRange.start,
    outPoint: previewRange.end,
    audioState: {
      ...(clip.audioState ?? {}),
      muted: false,
      editStack: [
        ...(clip.audioState?.editStack ?? []),
        operation,
      ],
    },
  };
}

export class AudioRepairPreviewService {
  private readonly extractor: Pick<AudioExtractor, 'extractAudio'>;
  private readonly clipAudioRenderer: Pick<ClipAudioRenderService, 'render'>;
  private readonly createAudioContext: () => AudioContext;
  private activePreview: ActivePreview | null = null;
  private sequence = 0;

  constructor(options: AudioRepairPreviewServiceOptions = {}) {
    this.extractor = options.extractor ?? audioExtractor;
    this.clipAudioRenderer = options.clipAudioRenderer ?? new ClipAudioRenderService();
    this.createAudioContext = options.createAudioContext ?? (() => new (getAudioContextConstructor())());
  }

  async preview(request: AudioRepairPreviewRequest): Promise<void> {
    this.stop();

    const maxDurationSeconds = Math.max(0.25, request.maxDurationSeconds ?? DEFAULT_PREVIEW_SECONDS);
    const operation = createAudioRepairSuggestionOperation(request.clip, request.suggestion, {
      id: `repair-preview:${request.suggestion.id}`,
      createdAt: Date.now(),
    });
    if (!operation) {
      throw new Error('Cannot preview an empty audio repair range.');
    }

    const active: ActivePreview = {
      token: this.sequence + 1,
      stopped: false,
    };
    this.sequence = active.token;
    this.activePreview = active;

    request.onStatus?.({
      phase: 'rendering',
      suggestionId: request.suggestion.id,
      message: 'Rendering repair preview',
    });

    try {
      const sourceBuffer = await this.extractor.extractAudio(
        request.clip.file,
        getClipMediaFileId(request.clip) ?? request.clip.id,
      );
      if (this.activePreview !== active || active.stopped) return;

      const previewRange = getPreviewSourceRange(request.clip, request.timelineTime, maxDurationSeconds);
      const previewClip = createPreviewClip(request.clip, operation, previewRange);
      const rendered = await this.clipAudioRenderer.render({
        clip: previewClip,
        sourceBuffer,
        onProgress: progress => request.onStatus?.({
          phase: 'rendering',
          suggestionId: request.suggestion.id,
          progress,
          message: progress.message,
        }),
      });
      if (this.activePreview !== active || active.stopped) return;

      await this.playRenderedBuffer(active, rendered.buffer, request);
    } catch (error) {
      if (this.activePreview === active && !active.stopped) {
        request.onStatus?.({
          phase: 'error',
          suggestionId: request.suggestion.id,
          message: error instanceof Error ? error.message : 'Audio repair preview failed',
        });
        log.warn('Audio repair preview failed', { clipId: request.clip.id, error });
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
    void active.context?.close();
    this.activePreview = null;
  }

  private async playRenderedBuffer(
    active: ActivePreview,
    buffer: AudioBuffer,
    request: AudioRepairPreviewRequest,
  ): Promise<void> {
    const context = this.createAudioContext();
    active.context = context;
    if (context.state === 'suspended') {
      await context.resume();
    }
    if (this.activePreview !== active || active.stopped) {
      void context.close();
      return;
    }

    const source = context.createBufferSource();
    active.source = source;
    source.buffer = buffer;
    source.connect(context.destination);

    const playbackDuration = Math.min(buffer.duration, request.maxDurationSeconds ?? DEFAULT_PREVIEW_SECONDS);

    request.onStatus?.({
      phase: 'playing',
      suggestionId: request.suggestion.id,
      message: `Playing ${playbackDuration.toFixed(1)}s preview`,
    });

    await new Promise<void>((resolve) => {
      source.onended = () => {
        if (this.activePreview === active) {
          this.activePreview = null;
        }
        active.stopped = true;
        try {
          source.disconnect();
        } catch {
          // Source may already be disconnected by the browser.
        }
        void context.close();
        request.onStatus?.({
          phase: 'stopped',
          suggestionId: request.suggestion.id,
          message: 'Preview stopped',
        });
        resolve();
      };
      source.start(0, 0, playbackDuration);
    });
  }
}

export const audioRepairPreviewService = new AudioRepairPreviewService();
