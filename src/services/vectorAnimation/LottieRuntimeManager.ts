import { DotLottie } from '@lottiefiles/dotlottie-web';

import type { TimelineClip } from '../../types';
import {
  coerceVectorAnimationInputValue,
  getVectorAnimationInputDefaultValue,
  isVectorAnimationBounceMode,
  isVectorAnimationReverseStartMode,
  mergeVectorAnimationSettings,
  normalizeVectorAnimationRenderDimension,
  normalizeVectorAnimationStateName,
  resolveVectorAnimationStateName,
  shouldLoopVectorAnimation,
  type VectorAnimationClipSettings,
  type VectorAnimationStateMachineInput,
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
  activeStateMachineName?: string;
  lastInputValuesKey?: string;
  lastStateOverride?: string;
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
    playbackMode: settings.playbackMode,
    renderWidth: settings.renderWidth ?? null,
    renderHeight: settings.renderHeight ?? null,
    stateMachineName: settings.stateMachineName ?? null,
  });
}

function getRenderSize(
  entry: LottieRuntimeEntry,
  settings: VectorAnimationClipSettings,
): { width: number; height: number } {
  const width = normalizeVectorAnimationRenderDimension(settings.renderWidth)
    ?? entry.asset.metadata.width
    ?? DEFAULT_CANVAS_SIZE;
  const height = normalizeVectorAnimationRenderDimension(settings.renderHeight)
    ?? entry.asset.metadata.height
    ?? DEFAULT_CANVAS_SIZE;
  return { width, height };
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
  const isBounceMode = isVectorAnimationBounceMode(settings.playbackMode);
  const cycleDuration = isBounceMode
    ? sourceWindowDuration * 2
    : sourceWindowDuration;

  if (!shouldLoop && settings.endBehavior === 'clear' && clipLocalTime >= cycleDuration) {
    return null;
  }

  const wrappedLocalTime = shouldLoop
    ? normalizeModulo(clipLocalTime, cycleDuration)
    : Math.max(0, Math.min(clipLocalTime, Math.max(0, cycleDuration - FRAME_EPSILON)));
  const sourceWindowLocalTime = isBounceMode && wrappedLocalTime > sourceWindowDuration
    ? cycleDuration - wrappedLocalTime
    : Math.min(wrappedLocalTime, sourceWindowDuration - FRAME_EPSILON);
  const startsReverse = isVectorAnimationReverseStartMode(settings.playbackMode);
  const reversePlayback = Boolean(clip.reversed) !== startsReverse;

  const sourceTime = reversePlayback
    ? sourceOutPoint - sourceWindowLocalTime
    : sourceInPoint + sourceWindowLocalTime;

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

function getClipLocalTime(clip: TimelineClip, timelineTime: number): number {
  return Math.max(0, timelineTime - clip.startTime);
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

  private applySettings(
    entry: LottieRuntimeEntry,
    clip: TimelineClip,
    settingsOverride?: VectorAnimationClipSettings,
  ): void {
    const settings = mergeVectorAnimationSettings(settingsOverride ?? clip.source?.vectorAnimationSettings);
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

    const renderSize = getRenderSize(entry, settings);
    if (entry.canvas.width !== renderSize.width || entry.canvas.height !== renderSize.height) {
      entry.canvas.width = renderSize.width;
      entry.canvas.height = renderSize.height;
    }

    entry.player.setLoop(shouldLoopVectorAnimation(settings));
    entry.player.setBackgroundColor(settings.backgroundColor ?? 'transparent');
    entry.player.setLayout({
      align: [0.5, 0.5],
      fit: settings.fit,
    });
    entry.player.resize();
    this.applyStateMachineSelection(entry, clip.id, settings);
    entry.settingsKey = settingsKey;
  }

  private applyStateMachineSelection(
    entry: LottieRuntimeEntry,
    clipId: string,
    settings: VectorAnimationClipSettings,
  ): void {
    const stateMachineName = normalizeVectorAnimationStateName(settings.stateMachineName);
    if (stateMachineName === entry.activeStateMachineName) {
      return;
    }

    if (entry.activeStateMachineName) {
      try {
        entry.player.stateMachineStop();
      } catch (error) {
        log.warn('Failed to stop Lottie state machine', {
          clipId,
          stateMachineName: entry.activeStateMachineName,
          error,
        });
      }
    }

    entry.activeStateMachineName = undefined;
    entry.lastInputValuesKey = undefined;
    entry.lastStateOverride = undefined;

    if (!stateMachineName) {
      return;
    }

    try {
      entry.player.stateMachineSetConfig({ openUrlPolicy: { whitelist: [] } });
      const loaded = entry.player.stateMachineLoad(stateMachineName);
      if (!loaded) {
        log.warn('Failed to load Lottie state machine', { clipId, stateMachineName });
        return;
      }

      const started = entry.player.stateMachineStart();
      if (!started) {
        log.warn('Failed to start Lottie state machine', { clipId, stateMachineName });
        return;
      }

      entry.activeStateMachineName = stateMachineName;
    } catch (error) {
      log.warn('Failed to configure Lottie state machine', { clipId, stateMachineName, error });
    }
  }

  private resetStateMachine(entry: LottieRuntimeEntry, clipId: string): void {
    const stateMachineName = entry.activeStateMachineName;
    if (!stateMachineName) {
      return;
    }

    try {
      entry.player.stateMachineStop();
      const loaded = entry.player.stateMachineLoad(stateMachineName);
      const started = loaded ? entry.player.stateMachineStart() : false;
      if (!loaded || !started) {
        log.warn('Failed to reset Lottie state machine', { clipId, stateMachineName });
        entry.activeStateMachineName = undefined;
      }
    } catch (error) {
      log.warn('Failed to reset Lottie state machine', { clipId, stateMachineName, error });
      entry.activeStateMachineName = undefined;
    } finally {
      entry.lastInputValuesKey = undefined;
      entry.lastStateOverride = undefined;
    }
  }

  private getActiveStateMachineInputs(
    entry: LottieRuntimeEntry,
  ): VectorAnimationStateMachineInput[] {
    const stateMachineName = entry.activeStateMachineName;
    if (!stateMachineName) {
      return [];
    }
    return entry.asset.metadata.stateMachineInputs?.[stateMachineName] ?? [];
  }

  private applyStateMachineInputs(
    entry: LottieRuntimeEntry,
    clipId: string,
    settings: VectorAnimationClipSettings,
  ): void {
    if (!entry.activeStateMachineName) {
      return;
    }

    const inputs = this.getActiveStateMachineInputs(entry);
    if (inputs.length === 0) {
      return;
    }

    const values = inputs.map((input) => ({
      input,
      value: coerceVectorAnimationInputValue(
        input,
        settings.stateMachineInputValues?.[input.name] ?? getVectorAnimationInputDefaultValue(input),
      ),
    }));
    const inputValuesKey = JSON.stringify(values.map(({ input, value }) => [
      entry.activeStateMachineName,
      input.name,
      input.type,
      value,
    ]));

    if (entry.lastInputValuesKey === inputValuesKey) {
      return;
    }

    for (const { input, value } of values) {
      try {
        let applied = true;
        if (input.type === 'boolean') {
          applied = entry.player.stateMachineSetBooleanInput(input.name, Boolean(value));
        } else if (input.type === 'number') {
          const numericValue = typeof value === 'number' ? value : Number(value);
          applied = Number.isFinite(numericValue)
            ? entry.player.stateMachineSetNumericInput(input.name, numericValue)
            : false;
        } else if (input.type === 'string') {
          applied = entry.player.stateMachineSetStringInput(input.name, String(value));
        }

        if (!applied) {
          log.debug('Lottie state machine input was not applied', {
            clipId,
            stateMachineName: entry.activeStateMachineName,
            inputName: input.name,
            inputType: input.type,
          });
        }
      } catch (error) {
        log.warn('Failed to apply Lottie state machine input', {
          clipId,
          stateMachineName: entry.activeStateMachineName,
          inputName: input.name,
          error,
        });
      }
    }

    entry.lastInputValuesKey = inputValuesKey;
  }

  private applyStateOverride(
    entry: LottieRuntimeEntry,
    clip: TimelineClip,
    settings: VectorAnimationClipSettings,
    timelineTime: number,
  ): void {
    if (!entry.activeStateMachineName) {
      return;
    }

    const stateName = resolveVectorAnimationStateName(settings, getClipLocalTime(clip, timelineTime));
    if (!stateName) {
      if (entry.lastStateOverride) {
        this.resetStateMachine(entry, clip.id);
      }
      return;
    }

    const overrideKey = `${entry.activeStateMachineName}:${stateName}`;
    if (entry.lastStateOverride === overrideKey) {
      return;
    }

    try {
      const applied = entry.player.stateMachineOverrideState(stateName, true);
      if (!applied) {
        log.warn('Failed to override Lottie state machine state', {
          clipId: clip.id,
          stateMachineName: entry.activeStateMachineName,
          stateName,
        });
      }
      entry.lastStateOverride = overrideKey;
    } catch (error) {
      log.warn('Failed to override Lottie state machine state', {
        clipId: clip.id,
        stateMachineName: entry.activeStateMachineName,
        stateName,
        error,
      });
      entry.lastStateOverride = overrideKey;
    }
  }

  renderClipAtTime(
    clip: TimelineClip,
    timelineTime: number,
    settingsOverride?: VectorAnimationClipSettings,
  ): HTMLCanvasElement | null {
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

    this.applySettings(entry, clip, settingsOverride);
    const settings = mergeVectorAnimationSettings(settingsOverride ?? clip.source?.vectorAnimationSettings);
    this.applyStateMachineInputs(entry, clip.id, settings);
    this.applyStateOverride(entry, clip, settings, timelineTime);
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
