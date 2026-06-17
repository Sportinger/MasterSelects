import type { MediaFile } from '../../../stores/mediaStore';

const MAX_CROP_CANVAS_DIMENSION = 8192;
const JPEG_WEBP_QUALITY = 0.95;

export interface SourceMonitorImageCropSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CreateSourceMonitorCroppedFileInput {
  sourceFile: MediaFile;
  image: HTMLImageElement;
  crop: SourceMonitorImageCropSelection;
  existingNames: readonly string[];
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

function getPreferredOutputType(sourceFile: MediaFile): string {
  const type = sourceFile.file?.type || '';
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') {
    return type;
  }
  return 'image/png';
}

function getExtensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function splitName(name: string): { base: string; extension: string | null } {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return { base: name, extension: null };
  }
  return {
    base: name.slice(0, dotIndex),
    extension: name.slice(dotIndex + 1).toLowerCase(),
  };
}

function extensionMatchesMimeType(extension: string | null, mimeType: string): boolean {
  if (!extension) return false;
  if (mimeType === 'image/jpeg') return extension === 'jpg' || extension === 'jpeg';
  return extension === getExtensionForMimeType(mimeType);
}

function buildCropFileName(originalName: string, mimeType: string, index: number): string {
  const { base, extension } = splitName(originalName);
  const outputExtension = extensionMatchesMimeType(extension, mimeType)
    ? extension
    : getExtensionForMimeType(mimeType);
  const suffix = index <= 1 ? '' : ` ${index}`;
  return `CROP${suffix} ${base}.${outputExtension}`;
}

function getUniqueCropFileName(
  originalName: string,
  mimeType: string,
  existingNames: readonly string[],
): string {
  const existing = new Set(existingNames);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = buildCropFileName(originalName, mimeType, index);
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return buildCropFileName(originalName, mimeType, Date.now());
}

function getOutputSize(crop: SourceMonitorImageCropSelection): { width: number; height: number } {
  const cropWidth = Math.max(1, Math.round(crop.width));
  const cropHeight = Math.max(1, Math.round(crop.height));
  const scale = Math.min(
    1,
    MAX_CROP_CANVAS_DIMENSION / Math.max(cropWidth, cropHeight),
  );

  return {
    width: Math.max(1, Math.round(cropWidth * scale)),
    height: Math.max(1, Math.round(cropHeight * scale)),
  };
}

export async function createSourceMonitorCroppedFile({
  sourceFile,
  image,
  crop,
  existingNames,
}: CreateSourceMonitorCroppedFileInput): Promise<File> {
  const size = getOutputSize(crop);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Could not create crop canvas');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    size.width,
    size.height,
  );

  const preferredType = getPreferredOutputType(sourceFile);
  const preferredQuality = preferredType === 'image/jpeg' || preferredType === 'image/webp'
    ? JPEG_WEBP_QUALITY
    : undefined;
  const blob = await canvasToBlob(canvas, preferredType, preferredQuality)
    ?? await canvasToBlob(canvas, 'image/png');

  if (!blob || blob.size <= 0) {
    throw new Error('Could not encode cropped image');
  }

  const actualType = blob.type || preferredType;
  return new File(
    [blob],
    getUniqueCropFileName(sourceFile.name, actualType, existingNames),
    { type: actualType, lastModified: Date.now() },
  );
}
