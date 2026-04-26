import { detectFormat, parseGaussianSplatHeader } from '../../../engine/gaussian/loaders/parseHeader';
import type { GaussianSplatFormat } from '../../../engine/gaussian/loaders/types';
import type { GaussianSplatSequenceFrame } from '../../../types';

export interface GaussianSplatFileStats {
  splatCount?: number;
  fileSize: number;
  container: string;
  codec: string;
}

export interface GaussianSplatSequenceStats {
  splatCount?: number;
  totalSplatCount?: number;
  minSplatCount?: number;
  maxSplatCount?: number;
  fileSize: number;
  container?: string;
  codec: string;
}

const CONTAINER_LABELS: Record<GaussianSplatFormat, string> = {
  ply: 'PLY',
  splat: 'SPLAT',
  ksplat: 'KSPLAT',
  'gsplat-zip': 'ZIP',
  spz: 'SPZ',
  sog: 'SOG',
  lcc: 'LCC',
};

function getContainerFromFormat(format: GaussianSplatFormat | null): string {
  return format ? CONTAINER_LABELS[format] : 'SPLAT';
}

export function getGaussianSplatContainerLabelFromFileName(fileName: string): string {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.compressed.ply')) return 'PLY';
  if (lowerName.endsWith('.ksplat')) return 'KSPLAT';
  if (lowerName.endsWith('.splat')) return 'SPLAT';
  if (lowerName.endsWith('.spz')) return 'SPZ';
  if (lowerName.endsWith('.sog')) return 'SOG';
  if (lowerName.endsWith('.lcc')) return 'LCC';
  if (lowerName.endsWith('.zip')) return 'ZIP';
  if (lowerName.endsWith('.ply')) return 'PLY';
  return 'SPLAT';
}

function normalizeSplatCount(count: number | undefined): number | undefined {
  return typeof count === 'number' && Number.isFinite(count) && count > 0
    ? Math.floor(count)
    : undefined;
}

export async function readGaussianSplatFileStats(file: File): Promise<GaussianSplatFileStats> {
  const detectedFormat = detectFormat(file);
  const fallback: GaussianSplatFileStats = {
    fileSize: file.size,
    container: detectedFormat
      ? getContainerFromFormat(detectedFormat)
      : getGaussianSplatContainerLabelFromFileName(file.name),
    codec: 'Splat',
  };

  try {
    const metadata = await parseGaussianSplatHeader(file, detectedFormat ?? undefined);
    return {
      ...fallback,
      container: getContainerFromFormat(metadata.format),
      splatCount: normalizeSplatCount(metadata.splatCount),
    };
  } catch {
    return fallback;
  }
}

export function summarizeGaussianSplatSequenceStats(
  frames: GaussianSplatSequenceFrame[],
): GaussianSplatSequenceStats {
  const counts = frames
    .map((frame) => normalizeSplatCount(frame.splatCount))
    .filter((count): count is number => count !== undefined);
  const totalSplatCount = counts.length > 0
    ? counts.reduce((sum, count) => sum + count, 0)
    : undefined;
  const containers = frames
    .map((frame) => frame.container)
    .filter((container): container is string => !!container);
  const firstContainer = containers[0];
  const mixedContainers = firstContainer
    ? containers.some((container) => container !== firstContainer)
    : false;

  return {
    splatCount: counts[0],
    totalSplatCount,
    minSplatCount: counts.length > 0 ? Math.min(...counts) : undefined,
    maxSplatCount: counts.length > 0 ? Math.max(...counts) : undefined,
    fileSize: frames.reduce((sum, frame) => sum + (frame.fileSize ?? frame.file?.size ?? 0), 0),
    container: mixedContainers ? 'Mixed' : firstContainer,
    codec: 'Splat Seq',
  };
}
