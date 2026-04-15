import { DotLottie } from '@lottiefiles/dotlottie-web';

import type { TimelineClip } from '../../types';
import {
  mergeVectorAnimationSettings,
  shouldLoopVectorAnimation,
  type VectorAnimationClipSettings,
} from '../../types/vectorAnimation';
import { Logger } from '../logger';
import { prepareLottieAsset } from './lottieMetadata';
import type {
  LottieRuntimePrepareResult,
  PreparedLottieAsset,
} from './types';

const log = Logger.create('LottieRuntime');
const DEFAULT_CANVAS_SIZE = 512;
const FRAME_EPSILON = 1 / 120;

interface LottieRuntimeEntry {
  asset: PreparedLottieAsset;
  canvas: HTMLCanvasElement;
  clipId: string;
  isReady: boolean;
  player: DotLottie;
  settingsKey: string;
}

function createCanvas(width?: number, height?: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width && width > 0 ? width : DEFAULT_CANVAS_SIZE;
  canvas.height = height && height > 0 ? height : DEFAULT_CANVAS_SIZE;
  canvas.dataset.masterselectsDynamic = 'lottie';
  return canvas;
}

function waitForDotLottieLoad(player: DotLottie): Promise<void> {
  if (player.isLoaded) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      player.removeEventListener('load', onLoad);
      player.removeEventListener('loadError', onError);
    };

    const onLoad = () => {
      cleanup();
      resolve();
    };

    const onError = (event: { error?: Error }) => {
      cleanup();
      reject(event.error ?? new Error('Failed to load Lottie runtime'));
    };

    player.addEventListener('load', onLoad);
    player.addEventListener('loadError', onError);
  });
}

function getSettingsKey(settings: VectorAnimationClipSettings): string {
  return JSON.stringify({
    animationName: settings.animationName ?? null,
    backgroundColor: settings.backgroundColor ?? null,
    fit: settings.fit,
    loop: settings.loop,
    endBehavior: settings.endBehavior,
  });
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d');
  context?.clearRect(0, 0, canvas.width, canvas.height);
}

function getSourceDuration(clip: TimelineClip, duration: number): number {
  if (Number.isFinite(duration) && duration > 0) {
    return duration;
  }
  if (Number.isFinite(clip.source?.naturalDuration) && (clip.source?.naturalDuration ?? 0) > 0) {
    return clip.source!.naturalDuration!;
  }
  return Math.max(clip.duration, FRAME_EPSILON);
}

function normalizeModulo(value: number, divisor: number): number {
  if (!Number.isFinite(divisor) || divisor <= 0) {
    return 0;
  }
  const result = value % divisor;
  return result < 0 ? result + divisor : result;
}

function resolveAnimationTime(
  clip: TimelineClip,
  animationDuration: number,
  settings: VectorAnimationClipSettings,
  timelineTime: number,
): number | null {
  const clipLocalTime = Math.max(0, timelineTime - clip.startTime);
  const sourceDuration = getSourceDuration(clip, animationDuration);
  const sourceMaxTime = Math.max(0, sourceDuration - FRAME_EPSILON);
  const sourceInPoint = Math.max(0, Math.min(clip.inPoint, sourceMaxTime));
  const rawSourceOutPoint =
    Number.isFinite(clip.outPoint) && clip.outPoint > sourceInPoint
      ? clip.outPoint
      : sourceDuration;
  const sourceOutPoint = Math.max(
    sourceInPoint + FRAME_EPSILON,
    Math.min(rawSourceOutPoint, sourceDuration),
  );
  const sourceWindowDuration = Math.max(sourceOutPoint - sourceInPoint, FRAME_EPSILON);
  const shouldLoop = shouldLoopVectorAnimation(settings);

  if (!shouldLoop && settings.endBehavior === 'clear' && clipLocalTime >= sourceWindowDuration) {
    return null;
  }

  const wrappedLocalTime = shouldLoop
    ? normalizeModulo(clipLocalTime, sourceWindowDuration)
    : Math.max(0, Math.min(clipLocalTime, Math.max(0, sourceWindowDuration - FRAME_EPSILON)));

  const sourceTime = clip.reversed
    ? sourceOutPoint - wrappedLocalTime
    : sourceInPoint + wrappedLocalTime;

  const maxTime = Math.max(0, animationDuration - FRAME_EPSILON);
  return Math.max(0, Math.min(sourceTime, maxTime));
}

function getFrameForTime(duration: number, totalFrames: number, time: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(totalFrames) || totalFrames <= 1) {
    return 0;
  }

  const frame = (time / duration) * totalFrames;
  return Math.max(0, Math.min(frame, totalFrames - FRAME_EPSILON));
}

export class LottieRuntimeManager {
  private entries = new Map<string, LottieRuntimeEntry>();
  private preparePromises = new Map<string, Promise<LottieRuntimePrepareResult>>();

  async prepareClipSource(
    clip: TimelineClip,
    fileOverride?: File,
  ): Promise<LottieRuntimePrepareResult> {
    if (clip.source?.type !== 'lottie') {
      throw new Error(`prepareClipSource called for non-Lottie clip ${clip.id}`);
    }

    const existingPromise = this.preparePromises.get(clip.id);
    if (existingPromise) {
      return existingPromise;
    }

    const preparePromise = this.prepareClipSourceInternal(clip, fileOverride).finally(() => {
      this.preparePromises.delete(clip.id);
    });

    this.preparePromises.set(clip.id, preparePromise);
    return preparePromise;
  }

  private async prepareClipSourceInternal(
    clip: TimelineClip,
    fileOverride?: File,
  ): Promise<LottieRuntimePrepareResult> {
    const file = fileOverride ?? clip.file;
    if (!file) {
      throw new Error(`Missing file for Lottie clip ${clip.id}`);
    }

    const asset = await prepareLottieAsset(file);
    const existing = this.entries.get(clip.id);
    if (existing && existing.asset.payload.sourceKey === asset.payload.sourceKey) {
      this.applySettings(existing, clip);
      return {
        canvas: existing.canvas,
        metadata: existing.asset.metadata,
      };
    }

    if (existing) {
      this.destroyClipRuntime(clip.id);
    }

    const canvas = createCanvas(asset.metadata.width, asset.metadata.height);
    const player = new DotLottie({
      canvas,
      autoplay: false,
      data: asset.payload.kind === 'dotlottie'
        ? asset.payload.data.slice(0)
        : asset.payload.data,
      loop: false,
      renderConfig: {
        autoResize: false,
        devicePixelRatio: 1,
        freezeOnOffscreen: false,
      },
    });

    await waitForDotLottieLoad(player);
    player.setUseFrameInterpolation(false);
    player.pause();

    const entry: LottieRuntimeEntry = {
      asset,
      canvas,
      clipId: clip.id,
      isReady: true,
      player,
      settingsKey: '',
    };

    this.applySettings(entry, clip);
    this.entries.set(clip.id, entry);

    return {
      canvas,
      metadata: asset.metadata,
    };
  }

  private applySettings(entry: LottieRuntimeEntry, clip: TimelineClip): void {
    const settings = mergeVectorAnimationSettings(clip.source?.vectorAnimationSettings);
    const settingsKey = getSettingsKey(settings);
    if (settingsKey === entry.settingsKey) {
      return;
    }

    if (
      settings.animationName &&
      settings.animationName !== entry.player.activeAnimationId &&
      entry.asset.payload.kind === 'dotlottie'
    ) {
      try {
        entry.player.loadAnimation(settings.animationName);
      } catch (error) {
        log.warn('Failed to switch Lottie animation', {
          clipId: clip.id,
          animationName: settings.animationName,
          error,
        });
      }
    }

    entry.player.setLoop(shouldLoopVectorAnimation(settings));
    entry.player.setBackgroundColor(settings.backgroundColor ?? 'transparent');
    entry.player.setLayout({
      align: [0.5, 0.5],
      fit: settings.fit,
    });
    entry.player.resize();
    entry.settingsKey = settingsKey;
  }

  renderClipAtTime(clip: TimelineClip, timelineTime: number): HTMLCanvasElement | null {
    if (clip.source?.type !== 'lottie') {
      return clip.source?.textCanvas ?? null;
    }

    const entry = this.entries.get(clip.id);
    if (!entry?.isReady) {
      if (clip.file) {
        void this.prepareClipSource(clip).catch((error) => {
          log.warn('Failed to prepare Lottie runtime during render', { clipId: clip.id, error });
        });
      }
      return clip.source?.textCanvas ?? null;
    }

    this.applySettings(entry, clip);
    const settings = mergeVectorAnimationSettings(clip.source?.vectorAnimationSettings);
    const animationDuration =
      entry.asset.metadata.duration ??
      clip.source?.naturalDuration ??
      clip.outPoint ??
      clip.duration;
    const animationTime = resolveAnimationTime(clip, animationDuration, settings, timelineTime);

    if (animationTime == null) {
      clearCanvas(entry.canvas);
      return entry.canvas;
    }

    const totalFrames =
      entry.player.totalFrames ||
      entry.asset.metadata.totalFrames ||
      0;
    const targetFrame = getFrameForTime(animationDuration, totalFrames, animationTime);
    entry.player.setFrame(targetFrame);
    return entry.canvas;
  }

  pruneClipRuntimes(knownClipIds: Iterable<string>): void {
    const keep = new Set(knownClipIds);
    for (const clipId of this.entries.keys()) {
      if (!keep.has(clipId)) {
        this.destroyClipRuntime(clipId);
      }
    }
  }

  destroyClipRuntime(clipId: string): void {
    const entry = this.entries.get(clipId);
    if (!entry) {
      return;
    }

    try {
      entry.player.destroy();
    } catch (error) {
      log.warn('Failed to destroy Lottie runtime', { clipId, error });
    }
    this.entries.delete(clipId);
  }

  destroyAll(): void {
    for (const clipId of this.entries.keys()) {
      this.destroyClipRuntime(clipId);
    }
  }
}

export const lottieRuntimeManager = new LottieRuntimeManager();
