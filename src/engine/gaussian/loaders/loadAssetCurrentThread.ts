import { Logger } from '../../../services/logger.ts';
import { applyCanonicalBasisCorrection, computeBoundingBox } from './normalize.ts';
import { detectFormat } from './parseHeader.ts';
import { loadPly } from './PlyLoader.ts';
import { canLoadWithSplatTransform, loadWithSplatTransform } from './SplatTransformLoader.ts';
import type {
  GaussianSplatAsset,
  GaussianSplatFormat,
  GaussianSplatLoadOptions,
} from './types.ts';

const log = Logger.create('GaussianLoader');

function applyAssetBasisCorrection(asset: GaussianSplatAsset): GaussianSplatAsset {
  let correctedBounds: { min: [number, number, number]; max: [number, number, number] } | null = null;

  for (const frame of asset.frames) {
    applyCanonicalBasisCorrection(frame.buffer.data, frame.buffer.splatCount);
    const frameBounds = computeBoundingBox(frame.buffer.data, frame.buffer.splatCount);
    correctedBounds = correctedBounds
      ? {
          min: [
            Math.min(correctedBounds.min[0], frameBounds.min[0]),
            Math.min(correctedBounds.min[1], frameBounds.min[1]),
            Math.min(correctedBounds.min[2], frameBounds.min[2]),
          ],
          max: [
            Math.max(correctedBounds.max[0], frameBounds.max[0]),
            Math.max(correctedBounds.max[1], frameBounds.max[1]),
            Math.max(correctedBounds.max[2], frameBounds.max[2]),
          ],
        }
      : frameBounds;
  }

  if (correctedBounds) {
    asset.metadata = { ...asset.metadata, boundingBox: correctedBounds };
  }

  return asset;
}

function shouldUsePointCloudPlyFallback(format: GaussianSplatFormat, error: unknown): boolean {
  if (format !== 'ply') return false;
  const message = error instanceof Error ? error.message : String(error);
  return /Missing required splat properties|scale_0|sx|invalid file header/i.test(message);
}

/** Runs the CPU-heavy parse on whichever thread invoked it. */
export async function loadGaussianSplatAssetOnCurrentThread(
  file: File,
  format?: GaussianSplatFormat,
  options?: GaussianSplatLoadOptions,
): Promise<GaussianSplatAsset> {
  const resolvedFormat = format ?? detectFormat(file);
  if (!resolvedFormat) {
    throw new Error(
      `Cannot detect gaussian splat format for file "${file.name}". ` +
      'Supported extensions: .ply, .compressed.ply, .splat, .ksplat, .spz, .sog, .lcc, .zip',
    );
  }

  log.info('Loading gaussian splat asset', {
    name: file.name,
    format: resolvedFormat,
    sizeMB: (file.size / (1024 * 1024)).toFixed(1),
  });

  let asset: GaussianSplatAsset;
  try {
    if (resolvedFormat === 'ply' && options?.maxSplats && options.maxSplats > 0) {
      asset = await loadPly(file, options);
    } else {
      if (!canLoadWithSplatTransform(file, resolvedFormat)) {
        throw new Error(`Format "${resolvedFormat}" is not supported by the splat-transform loader.`);
      }
      asset = await loadWithSplatTransform(file, resolvedFormat, options);
    }
  } catch (error) {
    if (!shouldUsePointCloudPlyFallback(resolvedFormat, error)) {
      log.error('Failed to load gaussian splat asset', {
        name: file.name,
        format: resolvedFormat,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    log.debug('Falling back to point-cloud PLY loader', {
      name: file.name,
      format: resolvedFormat,
      reason: error instanceof Error ? error.message : String(error),
    });
    options?.onProgress?.({
      phase: 'parsing',
      loadedBytes: file.size,
      totalBytes: file.size,
      percent: 0.9,
      message: 'Parsing point-cloud PLY',
    });
    asset = await loadPly(file, options);
  }

  options?.onProgress?.({
    phase: 'normalizing',
    loadedBytes: file.size,
    totalBytes: file.size,
    percent: 0.96,
    message: 'Normalizing scene basis',
  });
  asset = applyAssetBasisCorrection(asset);

  log.info('Gaussian splat asset loaded', {
    name: file.name,
    format: resolvedFormat,
    splatCount: asset.metadata.splatCount,
    shDegree: asset.metadata.shDegree,
  });
  return asset;
}
