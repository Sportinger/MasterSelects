import { DotLottie } from '@lottiefiles/dotlottie-web';

import type {
  VectorAnimationMetadata,
  VectorAnimationStateMachineInput,
  VectorAnimationStateMachineInputType,
  VectorAnimationStateMachineInputValue,
} from '../../types/vectorAnimation';
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

function collectStringValues(value: unknown, keys: readonly string[], output: Set<string>): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStringValues(item, keys, output));
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      output.add(candidate.trim());
    }
  }
}

function normalizeStateMachineInputType(value: unknown): VectorAnimationStateMachineInputType | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'bool' || normalized === 'boolean') {
    return 'boolean';
  }
  if (
    normalized === 'number' ||
    normalized === 'numeric' ||
    normalized === 'float' ||
    normalized === 'integer'
  ) {
    return 'number';
  }
  if (normalized === 'string' || normalized === 'text') {
    return 'string';
  }
  if (normalized === 'trigger' || normalized === 'event') {
    return 'trigger';
  }
  return null;
}

function normalizeStateMachineInputValue(
  type: VectorAnimationStateMachineInputType,
  value: unknown,
): VectorAnimationStateMachineInputValue | undefined {
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value >= 0.5;
    if (typeof value === 'string') return value === 'true' || value === '1';
    return undefined;
  }

  if (type === 'number') {
    const numericValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numericValue) ? numericValue : undefined;
  }

  if (type === 'string') {
    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}

function extractInputFromRecord(record: Record<string, unknown>): VectorAnimationStateMachineInput | null {
  const name = record.name ?? record.id ?? record.key;
  if (typeof name !== 'string' || !name.trim()) {
    return null;
  }

  const type = normalizeStateMachineInputType(record.type ?? record.inputType ?? record.kind);
  if (!type) {
    return null;
  }

  const defaultValue = normalizeStateMachineInputValue(
    type,
    record.value ?? record.defaultValue ?? record.initialValue,
  );

  return {
    name: name.trim(),
    type,
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  };
}

function extractInputsFromStateMachineRoot(root: Record<string, unknown>): VectorAnimationStateMachineInput[] {
  const inputs = root.inputs;
  const byName = new Map<string, VectorAnimationStateMachineInput>();

  if (Array.isArray(inputs)) {
    inputs.forEach((input) => {
      if (!input || typeof input !== 'object') {
        return;
      }
      const extracted = extractInputFromRecord(input as Record<string, unknown>);
      if (extracted) {
        byName.set(extracted.name, extracted);
      }
    });
  } else if (inputs && typeof inputs === 'object') {
    Object.entries(inputs as Record<string, unknown>).forEach(([inputName, inputValue]) => {
      if (!inputValue || typeof inputValue !== 'object') {
        return;
      }

      const extracted = extractInputFromRecord({
        ...(inputValue as Record<string, unknown>),
        name: inputName,
      });
      if (extracted) {
        byName.set(extracted.name, extracted);
      }
    });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function extractStateMachineDetailsFromData(
  data: string,
): { stateNames: string[]; inputs: VectorAnimationStateMachineInput[] } {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return { stateNames: [], inputs: [] };
    }

    const stateNames = new Set<string>();
    const root = parsed as Record<string, unknown>;
    const states = root.states;

    if (Array.isArray(states)) {
      states.forEach((state) => collectStringValues(state, ['id', 'name'], stateNames));
    } else if (states && typeof states === 'object') {
      Object.keys(states).forEach((stateName) => {
        if (stateName.trim()) {
          stateNames.add(stateName.trim());
        }
      });
      Object.values(states).forEach((state) => collectStringValues(state, ['id', 'name'], stateNames));
    }

    return {
      stateNames: [...stateNames].sort((a, b) => a.localeCompare(b)),
      inputs: extractInputsFromStateMachineRoot(root),
    };
  } catch {
    return { stateNames: [], inputs: [] };
  }
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
    const stateMachineNames = manifest?.stateMachines?.map((stateMachine) => stateMachine.id) ?? undefined;
    const stateMachineStates: Record<string, string[]> = {};
    const stateMachineInputs: Record<string, VectorAnimationStateMachineInput[]> = {};

    stateMachineNames?.forEach((stateMachineName) => {
      try {
        const stateMachineData = player.stateMachineGet(stateMachineName);
        const { stateNames, inputs } = extractStateMachineDetailsFromData(stateMachineData);
        if (stateNames.length > 0) {
          stateMachineStates[stateMachineName] = stateNames;
        }
        if (inputs.length > 0) {
          stateMachineInputs[stateMachineName] = inputs;
        }
      } catch (error) {
        log.debug('Failed to read Lottie state machine metadata', { stateMachineName, error });
      }
    });

    return {
      provider: 'lottie',
      width: animationSize.width || undefined,
      height: animationSize.height || undefined,
      fps,
      duration,
      totalFrames,
      animationNames: manifest?.animations?.map((animation) => animation.id) ?? undefined,
      defaultAnimationName: player.activeAnimationId ?? manifest?.animations?.[0]?.id,
      stateMachineNames,
      stateMachineStates: stateMachineStates && Object.keys(stateMachineStates).length > 0
        ? stateMachineStates
        : undefined,
      stateMachineInputs: Object.keys(stateMachineInputs).length > 0 ? stateMachineInputs : undefined,
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
