import { loadGaussianSplatAsset } from '../gaussian/loaders';
import type { GaussianSplatAsset, GaussianSplatFormat } from '../gaussian/loaders';
import { Logger } from '../../services/logger';
import { projectFileService } from '../../services/projectFileService';
import type { GaussianSplatBounds, GaussianSplatSequenceData } from '../../types';
import {
  cloneGaussianSplatBounds,
  getGaussianSplatSequenceReferenceFrame,
  getGaussianSplatSequenceReferenceRuntimeKey,
} from '../../utils/gaussianSplatSequence';

const log = Logger.create('SplatRuntimeCache');

const RUNTIME_MAGIC = 0x53475254; // SGRT
const RUNTIME_VERSION = 2;
const HEADER_BYTE_LENGTH = 22 * 4;
export const DEFAULT_SPLAT_BASE_LOD_MAX_SPLATS = 65536;

export interface PreparedSplatRuntime {
  runtimeKey: string;
  variant: 'base' | 'target';
  requestedMaxSplats: number;
  totalSplats: number;
  splatCount: number;
  stride: number;
  textureWidth: number;
  textureHeight: number;
  rawBounds: { min: [number, number, number]; max: [number, number, number] };
  normalizedBounds: { min: [number, number, number]; max: [number, number, number] };
  normalizationScale: number;
  centers: Float32Array;
  centerOpacityTextureData: Float32Array;
  colorTextureData: Float32Array;
  axisXTextureData: Float32Array;
  axisYTextureData: Float32Array;
  axisZTextureData: Float32Array;
  orderTemplateData: Float32Array;
}

interface RuntimeSourceOptions {
  cacheKey: string;
  fileHash?: string;
  file?: File;
  url?: string;
  fileName?: string;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  requestedMaxSplats?: number;
}

interface RuntimeRequestOptions extends RuntimeSourceOptions {
  variant: 'base' | 'target';
}

const assetPromiseCache = new Map<string, Promise<GaussianSplatAsset>>();
const runtimePromiseCache = new Map<string, Promise<PreparedSplatRuntime>>();
const runtimeValueCache = new Map<string, PreparedSplatRuntime>();
const idlePrewarmKeys = new Set<string>();

function normalizeRequestedMaxSplats(requestedMaxSplats: number | undefined): number {
  const normalized = Math.floor(requestedMaxSplats ?? 0);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

function buildVariantName(variant: 'base' | 'target', requestedMaxSplats: number): string {
  if (variant === 'base') {
    return requestedMaxSplats > 0
      ? `base-${Math.min(requestedMaxSplats, DEFAULT_SPLAT_BASE_LOD_MAX_SPLATS)}`
      : `base-${DEFAULT_SPLAT_BASE_LOD_MAX_SPLATS}`;
  }
  return requestedMaxSplats > 0 ? `target-${requestedMaxSplats}` : 'target-all';
}

function serializeBoundsKey(bounds: GaussianSplatBounds): string {
  return `${bounds.min.join(',')}|${bounds.max.join(',')}`;
}

function buildSequenceNormalizationKey(sequence: GaussianSplatSequenceData | undefined): string | undefined {
  if (!sequence) {
    return undefined;
  }

  const referenceKey = getGaussianSplatSequenceReferenceRuntimeKey(sequence);
  if (referenceKey) {
    return referenceKey;
  }

  return sequence.sharedBounds ? `bounds:${serializeBoundsKey(sequence.sharedBounds)}` : undefined;
}

function buildRuntimeKey(
  cacheKey: string,
  variant: 'base' | 'target',
  requestedMaxSplats: number,
  sequence: GaussianSplatSequenceData | undefined,
): string {
  const normalizationKey = buildSequenceNormalizationKey(sequence);
  const baseKey = `${cacheKey}|${buildVariantName(variant, requestedMaxSplats)}`;
  return normalizationKey ? `${baseKey}|norm:${normalizationKey}` : baseKey;
}

function resolveGaussianSplatFormat(fileName?: string, url?: string): GaussianSplatFormat | undefined {
  const candidate = (fileName || url || '').toLowerCase();
  if (candidate.endsWith('.ply')) return 'ply';
  if (candidate.endsWith('.splat')) return 'splat';
  if (candidate.endsWith('.ksplat')) return 'ksplat';
  return undefined;
}

function getTextureDimensions(splatCount: number): { width: number; height: number } {
  const safeCount = Math.max(1, Math.ceil(splatCount));
  const width = Math.min(4096, Math.max(1, Math.ceil(Math.sqrt(safeCount))));
  const height = Math.max(1, Math.ceil(safeCount / width));
  return { width, height };
}

function cloneViewBytes(view: Float32Array): ArrayBuffer {
  const bytes = new Uint8Array(view.byteLength);
  bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return bytes.buffer as ArrayBuffer;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.floor(a));
  let y = Math.abs(Math.floor(b));
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return Math.max(1, x);
}

function getPermutationStep(totalSplats: number): number {
  if (totalSplats <= 1) return 1;

  let step = Math.max(1, Math.floor(totalSplats * 0.61803398875)) | 1;
  while (step > 1 && gcd(step, totalSplats) !== 1) {
    step -= 2;
  }
  if (gcd(step, totalSplats) === 1) {
    return step;
  }

  step = 1;
  while (gcd(step, totalSplats) !== 1) {
    step += 2;
  }
  return step;
}

function getPermutedSplatIndex(orderIndex: number, totalSplats: number): number {
  if (totalSplats <= 1) return 0;
  const step = getPermutationStep(totalSplats);
  const offset = Math.floor(totalSplats * 0.38196601125) % totalSplats;
  return (offset + orderIndex * step) % totalSplats;
}

function scheduleIdle(taskKey: string, fn: () => void): void {
  if (idlePrewarmKeys.has(taskKey)) return;
  idlePrewarmKeys.add(taskKey);

  const run = () => {
    idlePrewarmKeys.delete(taskKey);
    fn();
  };

  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => run(), { timeout: 250 });
    return;
  }

  window.setTimeout(run, 32);
}

async function loadAsset(options: RuntimeSourceOptions): Promise<GaussianSplatAsset> {
  const existing = assetPromiseCache.get(options.cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    if (options.file) {
      const format = resolveGaussianSplatFormat(options.file.name, options.url);
      return loadGaussianSplatAsset(options.file, format);
    }

    if (!options.url) {
      throw new Error('Gaussian splat runtime cache requires a file or URL');
    }

    const response = await fetch(options.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch gaussian splat asset: HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const fileName = options.fileName || 'scene.ply';
    const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
    const format = resolveGaussianSplatFormat(fileName, options.url);
    return loadGaussianSplatAsset(file, format);
  })();

  assetPromiseCache.set(options.cacheKey, promise);
  void promise.catch(() => {
    if (assetPromiseCache.get(options.cacheKey) === promise) {
      assetPromiseCache.delete(options.cacheKey);
    }
  });
  return promise;
}

function buildPreparedRuntime(
  runtimeKey: string,
  asset: GaussianSplatAsset,
  variant: 'base' | 'target',
  requestedMaxSplats: number,
  normalizationBounds: GaussianSplatBounds,
): PreparedSplatRuntime {
  const frame = asset.frames[0];
  if (!frame) {
    throw new Error('Gaussian splat asset has no frames');
  }

  const canonical = frame.buffer.data;
  const totalSplats = frame.buffer.splatCount;
  const rawBounds = cloneGaussianSplatBounds(normalizationBounds) ?? asset.metadata.boundingBox;
  const rawCenterX = (rawBounds.min[0] + rawBounds.max[0]) * 0.5;
  const rawCenterY = (rawBounds.min[1] + rawBounds.max[1]) * 0.5;
  const rawCenterZ = (rawBounds.min[2] + rawBounds.max[2]) * 0.5;
  const extentX = rawBounds.max[0] - rawBounds.min[0];
  const extentY = rawBounds.max[1] - rawBounds.min[1];
  const extentZ = rawBounds.max[2] - rawBounds.min[2];
  const maxExtent = Math.max(extentX, extentY, extentZ, 1e-5);
  const normalizationScale = 1 / maxExtent;
  const normalizedBounds = {
    min: [
      (rawBounds.min[0] - rawCenterX) * normalizationScale,
      (rawBounds.min[1] - rawCenterY) * normalizationScale,
      (rawBounds.min[2] - rawCenterZ) * normalizationScale,
    ] as [number, number, number],
    max: [
      (rawBounds.max[0] - rawCenterX) * normalizationScale,
      (rawBounds.max[1] - rawCenterY) * normalizationScale,
      (rawBounds.max[2] - rawCenterZ) * normalizationScale,
    ] as [number, number, number],
  };

  const cappedRequestedMaxSplats = variant === 'base'
    ? Math.min(
        requestedMaxSplats > 0 ? requestedMaxSplats : totalSplats,
        DEFAULT_SPLAT_BASE_LOD_MAX_SPLATS,
      )
    : (requestedMaxSplats > 0 ? Math.min(requestedMaxSplats, totalSplats) : totalSplats);
  const splatCount = cappedRequestedMaxSplats;
  const stride = totalSplats > splatCount
    ? Math.ceil(totalSplats / splatCount)
    : 1;
  const { width: textureWidth, height: textureHeight } = getTextureDimensions(splatCount);
  const centers = new Float32Array(splatCount * 3);
  const centerOpacityTextureData = new Float32Array(textureWidth * textureHeight * 4);
  const colorTextureData = new Float32Array(centerOpacityTextureData.length);
  const axisXTextureData = new Float32Array(centerOpacityTextureData.length);
  const axisYTextureData = new Float32Array(centerOpacityTextureData.length);
  const axisZTextureData = new Float32Array(centerOpacityTextureData.length);
  const orderTemplateData = new Float32Array(centerOpacityTextureData.length);

  for (let outIndex = 0; outIndex < splatCount; outIndex += 1) {
    const splatIndex = getPermutedSplatIndex(outIndex, totalSplats);
    const base = splatIndex * 14;
    const centerBase = outIndex * 3;
    const texelBase = outIndex * 4;
    const px = canonical[base + 0];
    const py = canonical[base + 1];
    const pz = canonical[base + 2];
    const sx = Math.max(canonical[base + 3], 0.0005);
    const sy = Math.max(canonical[base + 4], 0.0005);
    const sz = Math.max(canonical[base + 5], 0.0005);
    const qw = canonical[base + 6];
    const qx = canonical[base + 7];
    const qy = canonical[base + 8];
    const qz = canonical[base + 9];

    const xx = 1 - 2 * (qy * qy + qz * qz);
    const xy = 2 * (qx * qy - qz * qw);
    const xz = 2 * (qx * qz + qy * qw);
    const yx = 2 * (qx * qy + qz * qw);
    const yy = 1 - 2 * (qx * qx + qz * qz);
    const yz = 2 * (qy * qz - qx * qw);
    const zx = 2 * (qx * qz - qy * qw);
    const zy = 2 * (qy * qz + qx * qw);
    const zz = 1 - 2 * (qx * qx + qy * qy);

    const normalizedX = (px - rawCenterX) * normalizationScale;
    const normalizedY = (py - rawCenterY) * normalizationScale;
    const normalizedZ = (pz - rawCenterZ) * normalizationScale;

    centers[centerBase + 0] = normalizedX;
    centers[centerBase + 1] = normalizedY;
    centers[centerBase + 2] = normalizedZ;

    centerOpacityTextureData[texelBase + 0] = normalizedX;
    centerOpacityTextureData[texelBase + 1] = normalizedY;
    centerOpacityTextureData[texelBase + 2] = normalizedZ;
    centerOpacityTextureData[texelBase + 3] = Math.max(0, Math.min(1, canonical[base + 13]));

    colorTextureData[texelBase + 0] = Math.max(0, Math.min(1, canonical[base + 10]));
    colorTextureData[texelBase + 1] = Math.max(0, Math.min(1, canonical[base + 11]));
    colorTextureData[texelBase + 2] = Math.max(0, Math.min(1, canonical[base + 12]));
    colorTextureData[texelBase + 3] = 1;

    axisXTextureData[texelBase + 0] = xx * sx * normalizationScale;
    axisXTextureData[texelBase + 1] = yx * sx * normalizationScale;
    axisXTextureData[texelBase + 2] = zx * sx * normalizationScale;
    axisYTextureData[texelBase + 0] = xy * sy * normalizationScale;
    axisYTextureData[texelBase + 1] = yy * sy * normalizationScale;
    axisYTextureData[texelBase + 2] = zy * sy * normalizationScale;
    axisZTextureData[texelBase + 0] = xz * sz * normalizationScale;
    axisZTextureData[texelBase + 1] = yz * sz * normalizationScale;
    axisZTextureData[texelBase + 2] = zz * sz * normalizationScale;
    orderTemplateData[texelBase + 0] = outIndex;
  }

  return {
    runtimeKey,
    variant,
    requestedMaxSplats,
    totalSplats,
    splatCount,
    stride,
    textureWidth,
    textureHeight,
    rawBounds,
    normalizedBounds,
    normalizationScale,
    centers,
    centerOpacityTextureData,
    colorTextureData,
    axisXTextureData,
    axisYTextureData,
    axisZTextureData,
    orderTemplateData,
  };
}

async function resolveRuntimeNormalizationBounds(
  options: RuntimeSourceOptions,
  asset: GaussianSplatAsset,
): Promise<GaussianSplatBounds> {
  const sharedBounds = cloneGaussianSplatBounds(options.gaussianSplatSequence?.sharedBounds);
  if (sharedBounds) {
    return sharedBounds;
  }

  const referenceFrame = getGaussianSplatSequenceReferenceFrame(options.gaussianSplatSequence);
  const referenceKey = getGaussianSplatSequenceReferenceRuntimeKey(options.gaussianSplatSequence);
  if (referenceFrame && referenceKey) {
    if (referenceKey === options.cacheKey) {
      return cloneGaussianSplatBounds(asset.metadata.boundingBox) ?? asset.metadata.boundingBox;
    }

    if (referenceFrame.file || referenceFrame.splatUrl) {
      const referenceAsset = await loadAsset({
        cacheKey: referenceKey,
        file: referenceFrame.file,
        url: referenceFrame.splatUrl,
        fileName: referenceFrame.name,
      });
      return cloneGaussianSplatBounds(referenceAsset.metadata.boundingBox) ?? referenceAsset.metadata.boundingBox;
    }
  }

  return cloneGaussianSplatBounds(asset.metadata.boundingBox) ?? asset.metadata.boundingBox;
}

function serializeRuntime(runtime: PreparedSplatRuntime): Blob {
  const headerBuffer = new ArrayBuffer(HEADER_BYTE_LENGTH);
  const header = new DataView(headerBuffer);
  header.setUint32(0, RUNTIME_MAGIC, true);
  header.setUint32(4, RUNTIME_VERSION, true);
  header.setUint32(8, runtime.variant === 'base' ? 0 : 1, true);
  header.setUint32(12, runtime.requestedMaxSplats, true);
  header.setUint32(16, runtime.totalSplats, true);
  header.setUint32(20, runtime.splatCount, true);
  header.setUint32(24, runtime.stride, true);
  header.setUint32(28, runtime.textureWidth, true);
  header.setUint32(32, runtime.textureHeight, true);
  header.setFloat32(36, runtime.normalizationScale, true);
  header.setFloat32(40, runtime.rawBounds.min[0], true);
  header.setFloat32(44, runtime.rawBounds.min[1], true);
  header.setFloat32(48, runtime.rawBounds.min[2], true);
  header.setFloat32(52, runtime.rawBounds.max[0], true);
  header.setFloat32(56, runtime.rawBounds.max[1], true);
  header.setFloat32(60, runtime.rawBounds.max[2], true);
  header.setFloat32(64, runtime.normalizedBounds.min[0], true);
  header.setFloat32(68, runtime.normalizedBounds.min[1], true);
  header.setFloat32(72, runtime.normalizedBounds.min[2], true);
  header.setFloat32(76, runtime.normalizedBounds.max[0], true);
  header.setFloat32(80, runtime.normalizedBounds.max[1], true);
  header.setFloat32(84, runtime.normalizedBounds.max[2], true);

  return new Blob([
    new Uint8Array(headerBuffer),
    cloneViewBytes(runtime.centers),
    cloneViewBytes(runtime.centerOpacityTextureData),
    cloneViewBytes(runtime.colorTextureData),
    cloneViewBytes(runtime.axisXTextureData),
    cloneViewBytes(runtime.axisYTextureData),
    cloneViewBytes(runtime.axisZTextureData),
    cloneViewBytes(runtime.orderTemplateData),
  ], { type: 'application/octet-stream' });
}

function deserializeRuntime(runtimeKey: string, buffer: ArrayBuffer): PreparedSplatRuntime {
  const header = new DataView(buffer, 0, HEADER_BYTE_LENGTH);
  if (header.getUint32(0, true) !== RUNTIME_MAGIC || header.getUint32(4, true) !== RUNTIME_VERSION) {
    throw new Error('Invalid gaussian splat runtime cache file');
  }

  const variant = header.getUint32(8, true) === 0 ? 'base' : 'target';
  const requestedMaxSplats = header.getUint32(12, true);
  const totalSplats = header.getUint32(16, true);
  const splatCount = header.getUint32(20, true);
  const stride = header.getUint32(24, true);
  const textureWidth = header.getUint32(28, true);
  const textureHeight = header.getUint32(32, true);
  const normalizationScale = header.getFloat32(36, true);
  const texelFloatLength = textureWidth * textureHeight * 4;

  let offset = HEADER_BYTE_LENGTH;
  const centers = new Float32Array(buffer, offset, splatCount * 3);
  offset += centers.byteLength;
  const centerOpacityTextureData = new Float32Array(buffer, offset, texelFloatLength);
  offset += centerOpacityTextureData.byteLength;
  const colorTextureData = new Float32Array(buffer, offset, texelFloatLength);
  offset += colorTextureData.byteLength;
  const axisXTextureData = new Float32Array(buffer, offset, texelFloatLength);
  offset += axisXTextureData.byteLength;
  const axisYTextureData = new Float32Array(buffer, offset, texelFloatLength);
  offset += axisYTextureData.byteLength;
  const axisZTextureData = new Float32Array(buffer, offset, texelFloatLength);
  offset += axisZTextureData.byteLength;
  const orderTemplateData = new Float32Array(buffer, offset, texelFloatLength);

  return {
    runtimeKey,
    variant,
    requestedMaxSplats,
    totalSplats,
    splatCount,
    stride,
    textureWidth,
    textureHeight,
    rawBounds: {
      min: [
        header.getFloat32(40, true),
        header.getFloat32(44, true),
        header.getFloat32(48, true),
      ],
      max: [
        header.getFloat32(52, true),
        header.getFloat32(56, true),
        header.getFloat32(60, true),
      ],
    },
    normalizedBounds: {
      min: [
        header.getFloat32(64, true),
        header.getFloat32(68, true),
        header.getFloat32(72, true),
      ],
      max: [
        header.getFloat32(76, true),
        header.getFloat32(80, true),
        header.getFloat32(84, true),
      ],
    },
    normalizationScale,
    centers,
    centerOpacityTextureData,
    colorTextureData,
    axisXTextureData,
    axisYTextureData,
    axisZTextureData,
    orderTemplateData,
  };
}

async function loadRuntimeFromProjectCache(
  fileHash: string | undefined,
  runtimeKey: string,
  variant: 'base' | 'target',
  requestedMaxSplats: number,
): Promise<PreparedSplatRuntime | null> {
  if (!fileHash || !projectFileService.isProjectOpen()) {
    return null;
  }

  const file = await projectFileService.getGaussianSplatRuntime(
    fileHash,
    buildVariantName(variant, requestedMaxSplats),
  );
  if (!file) {
    return null;
  }

  try {
    const buffer = await file.arrayBuffer();
    const runtime = deserializeRuntime(runtimeKey, buffer);
    runtimeValueCache.set(runtimeKey, runtime);
    return runtime;
  } catch (error) {
    log.warn('Failed to read gaussian splat runtime cache file', {
      fileHash,
      variant,
      requestedMaxSplats,
      error,
    });
    return null;
  }
}

async function persistRuntimeToProjectCache(
  fileHash: string | undefined,
  runtime: PreparedSplatRuntime,
): Promise<void> {
  if (!fileHash || !projectFileService.isProjectOpen()) {
    return;
  }

  try {
    await projectFileService.saveGaussianSplatRuntime(
      fileHash,
      buildVariantName(runtime.variant, runtime.requestedMaxSplats),
      serializeRuntime(runtime),
    );
  } catch (error) {
    log.warn('Failed to persist gaussian splat runtime cache', {
      fileHash,
      runtimeKey: runtime.runtimeKey,
      error,
    });
  }
}

async function ensurePreparedRuntime(options: RuntimeRequestOptions): Promise<PreparedSplatRuntime> {
  const requestedMaxSplats = normalizeRequestedMaxSplats(options.requestedMaxSplats);
  const runtimeKey = buildRuntimeKey(
    options.cacheKey,
    options.variant,
    requestedMaxSplats,
    options.gaussianSplatSequence,
  );
  const existing = runtimeValueCache.get(runtimeKey);
  if (existing) return existing;

  const existingPromise = runtimePromiseCache.get(runtimeKey);
  if (existingPromise) return existingPromise;

  const promise = (async () => {
    const cachedRuntime = await loadRuntimeFromProjectCache(
      options.fileHash,
      runtimeKey,
      options.variant,
      requestedMaxSplats,
    );
    if (cachedRuntime) {
      return cachedRuntime;
    }

    const asset = await loadAsset(options);
    const normalizationBounds = await resolveRuntimeNormalizationBounds(options, asset);
    const runtime = buildPreparedRuntime(
      runtimeKey,
      asset,
      options.variant,
      requestedMaxSplats,
      normalizationBounds,
    );
    runtimeValueCache.set(runtimeKey, runtime);
    void persistRuntimeToProjectCache(options.fileHash, runtime);
    return runtime;
  })();

  runtimePromiseCache.set(runtimeKey, promise);
  void promise.catch(() => {
    if (runtimePromiseCache.get(runtimeKey) === promise) {
      runtimePromiseCache.delete(runtimeKey);
    }
  });
  return promise;
}

export function getPreparedSplatRuntimeSync(
  options: RuntimeRequestOptions,
): PreparedSplatRuntime | null {
  const requestedMaxSplats = normalizeRequestedMaxSplats(options.requestedMaxSplats);
  return runtimeValueCache.get(
    buildRuntimeKey(options.cacheKey, options.variant, requestedMaxSplats, options.gaussianSplatSequence),
  ) ?? null;
}

export async function resolvePreparedSplatRuntime(
  options: RuntimeSourceOptions,
): Promise<{ runtime: PreparedSplatRuntime; usingBase: boolean }> {
  const requestedMaxSplats = normalizeRequestedMaxSplats(options.requestedMaxSplats);
  const target = getPreparedSplatRuntimeSync({ ...options, variant: 'target', requestedMaxSplats });
  if (target) {
    return { runtime: target, usingBase: false };
  }

  const base = getPreparedSplatRuntimeSync({ ...options, variant: 'base', requestedMaxSplats });
  if (base) {
    return { runtime: base, usingBase: true };
  }

  const runtime = await ensurePreparedRuntime({ ...options, variant: 'base', requestedMaxSplats });
  return { runtime, usingBase: true };
}

export async function waitForTargetPreparedSplatRuntime(
  options: RuntimeSourceOptions,
): Promise<PreparedSplatRuntime> {
  const requestedMaxSplats = normalizeRequestedMaxSplats(options.requestedMaxSplats);
  return ensurePreparedRuntime({ ...options, variant: 'target', requestedMaxSplats });
}

export async function waitForBasePreparedSplatRuntime(
  options: RuntimeSourceOptions,
): Promise<PreparedSplatRuntime> {
  const requestedMaxSplats = normalizeRequestedMaxSplats(options.requestedMaxSplats);
  return ensurePreparedRuntime({ ...options, variant: 'base', requestedMaxSplats });
}

export function prewarmGaussianSplatRuntime(options: RuntimeSourceOptions): void {
  const requestedMaxSplats = normalizeRequestedMaxSplats(options.requestedMaxSplats);
  const baseTaskKey = buildRuntimeKey(
    options.cacheKey,
    'base',
    requestedMaxSplats,
    options.gaussianSplatSequence,
  );
  scheduleIdle(baseTaskKey, () => {
    void ensurePreparedRuntime({ ...options, variant: 'base', requestedMaxSplats }).catch((error) => {
      log.warn('Failed to prewarm gaussian splat base runtime', {
        cacheKey: options.cacheKey,
        requestedMaxSplats,
        error,
      });
    });
  });

  const targetTaskKey = buildRuntimeKey(
    options.cacheKey,
    'target',
    requestedMaxSplats,
    options.gaussianSplatSequence,
  );
  scheduleIdle(targetTaskKey, () => {
    void ensurePreparedRuntime({ ...options, variant: 'target', requestedMaxSplats }).catch((error) => {
      log.warn('Failed to prewarm gaussian splat target runtime', {
        cacheKey: options.cacheKey,
        requestedMaxSplats,
        error,
      });
    });
  });
}
