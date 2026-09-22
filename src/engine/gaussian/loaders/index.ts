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
  GaussianSplatLoadOptions,
} from './types.ts';
import { parseGaussianSplatHeader as parseHeader } from './parseHeader.ts';
import { getSplatCache } from './splatCache.ts';
import { loadGaussianSplatAssetOnCurrentThread } from './loadAssetCurrentThread.ts';
import {
  canUseGaussianSplatParseWorker,
  GaussianSplatParseWorkerUnavailableError,
  loadGaussianSplatAssetInWorker,
} from './gaussianSplatParseWorkerClient.ts';

const log = Logger.create('GaussianLoader');

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
  options?: GaussianSplatLoadOptions,
): Promise<GaussianSplatAsset> {
  if (!canUseGaussianSplatParseWorker()) {
    return loadGaussianSplatAssetOnCurrentThread(file, format, options);
  }

  try {
    return await loadGaussianSplatAssetInWorker(file, format, options);
  } catch (error) {
    if (!(error instanceof GaussianSplatParseWorkerUnavailableError)) {
      throw error;
    }
    log.warn('Gaussian splat parse worker unavailable; falling back to the main thread', {
      name: file.name,
      error: error.message,
    });
    return loadGaussianSplatAssetOnCurrentThread(file, format, options);
  }
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
  options?: GaussianSplatLoadOptions,
): Promise<GaussianSplatAsset> {
  const cache = getSplatCache();

  // Check cache first
  const cached = cache.get(mediaFileId);
  if (cached && cached.frames[0]?.buffer.data.length > 0) {
    log.debug('Cache hit', { mediaFileId, splatCount: cached.metadata.splatCount });
    options?.onProgress?.({
      phase: 'normalizing',
      loadedBytes: file.size,
      totalBytes: file.size,
      percent: 1,
      message: 'Using cached splat data',
    });
    return cached;
  }

  // Cache miss — load from file
  const asset = await loadGaussianSplatAsset(file, format, options);

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
  GaussianSplatLoadOptions,
  GaussianSplatLoadProgress,
  GaussianSplatLoadProgressCallback,
} from './types.ts';

// Re-export cache
export { getSplatCache } from './splatCache.ts';
export type { SplatCache } from './splatCache.ts';

// Re-export header utilities
export { detectFormat } from './parseHeader.ts';
