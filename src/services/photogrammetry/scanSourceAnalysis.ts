export type ScanImageQuality = 'good' | 'warning' | 'error';

export interface ScanImageAnalysis {
  key: string;
  file: File;
  width: number;
  height: number;
  megapixels: number;
  quality: ScanImageQuality;
  note: string;
}

export interface ScanSourceMerge {
  files: File[];
  duplicates: number;
  unsupported: number;
}

const SCAN_IMAGE_EXTENSIONS = new Set([
  'avif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'webp',
]);

export function scanSourceKey(file: File): string {
  return `${file.name.toLowerCase()}::${file.size}::${file.lastModified}`;
}

export function isSupportedScanImage(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return SCAN_IMAGE_EXTENSIONS.has(extension);
}

export function mergeScanSourceFiles(existing: File[], candidates: File[]): ScanSourceMerge {
  const keys = new Set(existing.map(scanSourceKey));
  const files: File[] = [];
  let duplicates = 0;
  let unsupported = 0;

  for (const file of candidates) {
    if (!isSupportedScanImage(file)) {
      unsupported += 1;
      continue;
    }
    const key = scanSourceKey(file);
    if (keys.has(key)) {
      duplicates += 1;
      continue;
    }
    keys.add(key);
    files.push(file);
  }
  return { files, duplicates, unsupported };
}

async function inspectScanImage(file: File): Promise<ScanImageAnalysis> {
  const key = scanSourceKey(file);
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close();
    const megapixels = (width * height) / 1_000_000;
    const shortEdge = Math.min(width, height);
    const quality: ScanImageQuality = shortEdge < 720 || megapixels < 0.8
      ? 'warning'
      : 'good';
    const note = quality === 'good'
      ? 'Ready'
      : 'Below 720p; camera matching may be unreliable';
    return { key, file, width, height, megapixels, quality, note };
  } catch {
    return {
      key,
      file,
      width: 0,
      height: 0,
      megapixels: 0,
      quality: 'error',
      note: 'This browser could not decode the image',
    };
  }
}

export async function analyzeScanImages(
  files: File[],
  concurrency = 3,
): Promise<ScanImageAnalysis[]> {
  const results = new Array<ScanImageAnalysis>(files.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < files.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await inspectScanImage(files[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return results;
}
