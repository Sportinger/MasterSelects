// Quick header-only parse for import-time metadata extraction
//
// Must be fast (<50ms) — reads only the minimum bytes needed to determine
// format, splat count, and basic properties without loading full data.

import { Logger } from '../../../services/logger.ts';
import type { GaussianSplatFormat, GaussianSplatMetadata } from './types.ts';
import { parsePlyHeaderOnly } from './PlyLoader.ts';
import { parseSplatHeaderOnly } from './SplatLoader.ts';

const log = Logger.create('GaussianParseHeader');

/** Known file extensions for format detection */
const FORMAT_BY_EXTENSION: Record<string, GaussianSplatFormat> = {
  '.compressed.ply': 'ply',
  '.ply': 'ply',
  '.splat': 'splat',
  '.ksplat': 'ksplat',
  '.spz': 'spz',
  '.sog': 'sog',
  '.lcc': 'lcc',
  '.zip': 'gsplat-zip',
};

/**
 * Detect the gaussian splat format from a file's name and/or magic bytes.
 */
export function detectFormat(file: File): GaussianSplatFormat | null {
  const name = file.name.toLowerCase();

  // Try extension first
  for (const [ext, format] of Object.entries(FORMAT_BY_EXTENSION)) {
    if (name.endsWith(ext)) {
      return format;
    }
  }

  return null;
}

/**
 * Quick header-only parse to extract metadata for import-time display.
 * This reads only the minimum bytes needed — no full data loading.
 *
 * Must complete in <50ms for reasonable UX.
 *
 * @param file The File object to parse
 * @param format Optional format override; auto-detected from extension if omitted
 * @returns Metadata about the gaussian splat file
 */
export async function parseGaussianSplatHeader(
  file: File,
  format?: GaussianSplatFormat,
): Promise<GaussianSplatMetadata> {
  const startTime = performance.now();
  const resolvedFormat = format ?? detectFormat(file);

  if (!resolvedFormat) {
    throw new Error(`Cannot detect gaussian splat format for file "${file.name}". ` +
      'Supported extensions: .ply, .compressed.ply, .splat, .ksplat, .spz, .sog, .lcc, .zip');
  }

  let metadata: GaussianSplatMetadata;

  switch (resolvedFormat) {
    case 'ply':
      metadata = await parsePlyHeaderOnly(file);
      break;

    case 'splat':
      metadata = parseSplatHeaderOnly(file);
      break;

    case 'ksplat':
    case 'gsplat-zip':
    case 'spz':
    case 'sog':
    case 'lcc':
      // Future format support — return a placeholder for now
      log.warn(`Format "${resolvedFormat}" header parsing not yet implemented, returning estimate`);
      metadata = {
        format: resolvedFormat,
        splatCount: 0,
        isTemporal: false,
        frameCount: 1,
        fps: 0,
        totalDuration: 0,
        boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
        byteSize: file.size,
        perSplatByteStride: 0,
        hasSphericalHarmonics: false,
        shDegree: 0,
        compressionType: resolvedFormat === 'ksplat' || resolvedFormat === 'spz' || resolvedFormat === 'sog' || resolvedFormat === 'lcc'
          ? 'quantized'
          : 'none',
      };
      break;

    default: {
      // Exhaustiveness check
      const _exhaustive: never = resolvedFormat;
      throw new Error(`Unhandled format: ${_exhaustive}`);
    }
  }

  const elapsed = performance.now() - startTime;
  log.debug('Header parsed', {
    file: file.name,
    format: resolvedFormat,
    splatCount: metadata.splatCount,
    elapsedMs: elapsed.toFixed(1),
  });

  return metadata;
}
