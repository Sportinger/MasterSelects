// Public API for gaussian splat loaders
//
// Provides two main entry points:
//   loadGaussianSplatAsset()     — Full parse: File → GaussianSplatAsset
//   parseGaussianSplatHeader()   — Quick header-only parse for import metadata

import { Logger } from '../../../services/logger.ts';
import type {
  GaussianSplatFormat,
  GaussianSplatAsset,
  GaussianSplatMetadata,
} from './types.ts';
import { detectFormat } from './parseHeader.ts';
import { parseGaussianSplatHeader as parseHeader } from './parseHeader.ts';
import { canLoadWithSplatTransform, loadWithSplatTransform } from './SplatTransformLoader.ts';
import { getSplatCache } from './splatCache.ts';
import { applyCanonicalBasisCorrection, computeBoundingBox } from './normalize.ts';

const log = Logger.create('GaussianLoader');

function applyAssetBasisCorrection(asset: GaussianSplatAsset): GaussianSplatAsset {
  let correctedBounds: { min: [number, number, number]; max: [number, number, number] } | null = null;

  for (const frame of asset.frames) {
    applyCanonicalBasisCorrection(frame.buffer.data, frame.buffer.splatCount);

    const frameBounds = computeBoundingBox(frame.buffer.data, frame.buffer.splatCount);
    if (!correctedBounds) {
      correctedBounds = frameBounds;
      continue;
    }

    correctedBounds = {
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
    };
  }

  if (correctedBounds) {
    asset.metadata = {
      ...asset.metadata,
      boundingBox: correctedBounds,
    };
  }

  return asset;
}

/**
 * Load and parse a gaussian splat file into a full GaussianSplatAsset.
 *
 * Supports .ply and .splat formats. The format is auto-detected from the
 * file extension if not explicitly provided.
 *
 * Results are stored in the splat cache for re-use.
 *
 * @param file The File object to load
 * @param format Optional format override
 * @returns Parsed asset with metadata, canonical buffers, and frame data
 */
export async function loadGaussianSplatAsset(
  file: File,
  format?: GaussianSplatFormat,
): Promise<GaussianSplatAsset> {
  const resolvedFormat = format ?? detectFormat(file);

  if (!resolvedFormat) {
    throw new Error(
      `Cannot detect gaussian splat format for file "${file.name}". ` +
      'Supported extensions: .ply, .compressed.ply, .splat, .ksplat, .spz, .sog, .lcc, .zip'
    );
  }

  log.info('Loading gaussian splat asset', {
    name: file.name,
    format: resolvedFormat,
    sizeMB: (file.size / (1024 * 1024)).toFixed(1),
  });

  let asset: GaussianSplatAsset;

  try {
    if (!canLoadWithSplatTransform(file, resolvedFormat)) {
      throw new Error(`Format "${resolvedFormat}" is not supported by the splat-transform loader.`);
    }
    asset = await loadWithSplatTransform(file, resolvedFormat);
  } catch (err) {
    log.error('Failed to load gaussian splat asset', {
      name: file.name,
      format: resolvedFormat,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  asset = applyAssetBasisCorrection(asset);

  log.info('Gaussian splat asset loaded', {
    name: file.name,
    format: resolvedFormat,
    splatCount: asset.metadata.splatCount,
    shDegree: asset.metadata.shDegree,
  });

  return asset;
}

/**
 * Load a gaussian splat asset with caching by mediaFileId.
 * If the asset is already cached, returns it immediately.
 *
 * @param mediaFileId Unique media file identifier for cache lookup
 * @param file The File object to load (only used on cache miss)
 * @param format Optional format override
 */
export async function loadGaussianSplatAssetCached(
  mediaFileId: string,
  file: File,
  format?: GaussianSplatFormat,
): Promise<GaussianSplatAsset> {
  const cache = getSplatCache();

  // Check cache first
  const cached = cache.get(mediaFileId);
  if (cached && cached.frames[0]?.buffer.data.length > 0) {
    log.debug('Cache hit', { mediaFileId, splatCount: cached.metadata.splatCount });
    return cached;
  }

  // Cache miss — load from file
  const asset = await loadGaussianSplatAsset(file, format);

  // Store in cache
  cache.put(mediaFileId, asset);

  return asset;
}

/**
 * Quick header-only parse for import-time metadata extraction.
 * Must be fast (<50ms) — reads only the minimum bytes needed.
 */
export async function parseGaussianSplatHeader(
  file: File,
  format?: GaussianSplatFormat,
): Promise<GaussianSplatMetadata> {
  return parseHeader(file, format);
}

// Re-export types
export type {
  GaussianSplatFormat,
  GaussianSplatMetadata,
  GaussianSplatBuffer,
  GaussianSplatFrame,
  GaussianSplatAsset,
} from './types.ts';

// Re-export cache
export { getSplatCache } from './splatCache.ts';
export type { SplatCache } from './splatCache.ts';

// Re-export header utilities
export { detectFormat } from './parseHeader.ts';
