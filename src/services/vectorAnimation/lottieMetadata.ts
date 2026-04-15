import { DotLottie } from '@lottiefiles/dotlottie-web';

import type { VectorAnimationMetadata } from '../../types/vectorAnimation';
import { Logger } from '../logger';
import {
  readLottieJsonFile,
  type LottieJsonRoot,
} from './lottieJsonSniffer';
import type { PreparedLottieAsset } from './types';

const log = Logger.create('LottieMetadata');

const preparedAssetCache = new Map<string, Promise<PreparedLottieAsset>>();

function getAssetCacheKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function createMetadataCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
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
      reject(event.error ?? new Error('Failed to load Lottie asset'));
    };

    player.addEventListener('load', onLoad);
    player.addEventListener('loadError', onError);
  });
}

function getDurationFromFrames(
  fps: number | undefined,
  inPoint: number | undefined,
  outPoint: number | undefined,
): { duration?: number; totalFrames?: number } {
  if (
    typeof fps !== 'number' ||
    !Number.isFinite(fps) ||
    fps <= 0 ||
    typeof inPoint !== 'number' ||
    typeof outPoint !== 'number' ||
    !Number.isFinite(inPoint) ||
    !Number.isFinite(outPoint)
  ) {
    return {};
  }

  const totalFrames = Math.max(0, outPoint - inPoint);
  return {
    duration: totalFrames / fps,
    totalFrames,
  };
}

function buildJsonMetadata(data: LottieJsonRoot): VectorAnimationMetadata {
  const fps = typeof data.fr === 'number' && Number.isFinite(data.fr) ? data.fr : undefined;
  const width = typeof data.w === 'number' && Number.isFinite(data.w) ? data.w : undefined;
  const height = typeof data.h === 'number' && Number.isFinite(data.h) ? data.h : undefined;
  const timing = getDurationFromFrames(fps, data.ip, data.op);

  return {
    provider: 'lottie',
    width,
    height,
    fps,
    duration: timing.duration,
    totalFrames: timing.totalFrames,
    defaultAnimationName: typeof data.nm === 'string' && data.nm.trim() ? data.nm : undefined,
  };
}

async function readDotLottieMetadata(buffer: ArrayBuffer): Promise<VectorAnimationMetadata> {
  const canvas = createMetadataCanvas();
  const player = new DotLottie({
    canvas,
    data: buffer.slice(0),
    autoplay: false,
    loop: false,
    renderConfig: {
      autoResize: false,
      devicePixelRatio: 1,
      freezeOnOffscreen: false,
    },
  });

  try {
    await waitForDotLottieLoad(player);
    const animationSize = player.animationSize();
    const totalFrames = Number.isFinite(player.totalFrames) ? player.totalFrames : undefined;
    const duration = Number.isFinite(player.duration) ? player.duration : undefined;
    const fps = totalFrames && duration && duration > 0 ? totalFrames / duration : undefined;
    const manifest = player.manifest;

    return {
      provider: 'lottie',
      width: animationSize.width || undefined,
      height: animationSize.height || undefined,
      fps,
      duration,
      totalFrames,
      animationNames: manifest?.animations?.map((animation) => animation.id) ?? undefined,
      defaultAnimationName: player.activeAnimationId ?? manifest?.animations?.[0]?.id,
      stateMachineNames: manifest?.stateMachines?.map((stateMachine) => stateMachine.id) ?? undefined,
    };
  } finally {
    player.destroy();
  }
}

async function prepareLottieAssetInternal(file: File): Promise<PreparedLottieAsset> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.lottie')) {
    const buffer = await file.arrayBuffer();
    const metadata = await readDotLottieMetadata(buffer);
    return {
      metadata,
      payload: {
        kind: 'dotlottie',
        data: buffer,
        sourceKey: getAssetCacheKey(file),
      },
    };
  }

  const json = await readLottieJsonFile(file);
  if (!json) {
    throw new Error(`Unsupported Lottie JSON: ${file.name}`);
  }

  return {
    metadata: buildJsonMetadata(json.data),
    payload: {
      kind: 'json',
      data: json.text,
      sourceKey: getAssetCacheKey(file),
    },
  };
}

export async function prepareLottieAsset(file: File): Promise<PreparedLottieAsset> {
  const cacheKey = getAssetCacheKey(file);
  const existing = preparedAssetCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = prepareLottieAssetInternal(file).catch((error) => {
    preparedAssetCache.delete(cacheKey);
    log.warn('Failed to prepare Lottie asset', { file: file.name, error });
    throw error;
  });

  preparedAssetCache.set(cacheKey, promise);
  return promise;
}

export async function readLottieMetadata(file: File): Promise<VectorAnimationMetadata> {
  return (await prepareLottieAsset(file)).metadata;
}
