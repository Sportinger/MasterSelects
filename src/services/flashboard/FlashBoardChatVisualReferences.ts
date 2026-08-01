import type { FlashBoardComposerState } from '../../stores/flashboardStore';
import type { MediaFile } from '../../stores/mediaStore';
import type { FlashBoardChatVisualReference } from './FlashBoardChatTypes';

/**
 * The start-turn route accepts 1.5 MB and each source is represented both in
 * providerInput and visualReferences. Keep the encoded image half comfortably
 * below that ceiling so prompts and tool schemas still have room.
 */
export const FLASHBOARD_CHAT_VISUAL_REFERENCE_CHARACTER_BUDGET = 420_000;
export const FLASHBOARD_CHAT_MAX_VISUAL_REFERENCES = 4;

const JPEG_CANDIDATES = [
  { maxDimension: 1280, quality: 0.82 },
  { maxDimension: 1024, quality: 0.76 },
  { maxDimension: 768, quality: 0.7 },
  { maxDimension: 512, quality: 0.64 },
  { maxDimension: 384, quality: 0.58 },
  { maxDimension: 256, quality: 0.52 },
] as const;

const SUPPORTED_IMAGE_TYPE = /^image\/(?:png|jpeg|gif|webp)$/i;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Chat stopped.', 'AbortError');
  }
}

function uniqueReferenceIds(composer: FlashBoardComposerState): string[] {
  const ordered = [
    composer.startMediaFileId,
    composer.endMediaFileId,
    ...(composer.referenceMediaFileIds ?? []),
  ];
  return [...new Set(ordered.filter((id): id is string => Boolean(id)))];
}

export function collectFlashBoardChatReferenceImages(
  composer: FlashBoardComposerState,
  mediaFiles: MediaFile[],
): MediaFile[] {
  const mediaById = new Map(mediaFiles.map((file) => [file.id, file]));
  return uniqueReferenceIds(composer)
    .map((id) => mediaById.get(id))
    .filter((file): file is MediaFile => file?.type === 'image');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not encode the chat reference image.'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the chat reference image.'));
    reader.readAsDataURL(blob);
  });
}

async function fetchImageBlob(source: string): Promise<Blob> {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Reference image could not be read (${response.status}).`);
  }
  return response.blob();
}

async function readMediaImageBlob(mediaFile: MediaFile): Promise<Blob> {
  if (mediaFile.file && mediaFile.file.size > 0) {
    return mediaFile.file;
  }

  const sources = [mediaFile.url, mediaFile.thumbnailUrl].filter(
    (source): source is string => Boolean(source),
  );
  let lastError: unknown;
  for (const source of sources) {
    try {
      return await fetchImageBlob(source);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`Reference image "${mediaFile.name}" has no readable source.`);
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Could not compress the chat reference image.'));
      }
    }, 'image/jpeg', quality);
  });
}

async function boundedImageDataUrl(
  blob: Blob,
  maximumCharacters: number,
  signal?: AbortSignal,
): Promise<{ dataUrl: string; mediaType: string }> {
  throwIfAborted(signal);
  const original = await blobToDataUrl(blob);
  const originalType = original.slice(5, original.indexOf(';')).toLowerCase();
  if (SUPPORTED_IMAGE_TYPE.test(originalType) && original.length <= maximumCharacters) {
    return { dataUrl: original, mediaType: originalType };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('The chat reference could not be decoded as an image.');
  }

  try {
    let smallest = '';
    for (const candidate of JPEG_CANDIDATES) {
      throwIfAborted(signal);
      const scale = Math.min(1, candidate.maxDimension / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('The browser cannot prepare chat reference images.');
      }
      context.fillStyle = '#000';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      smallest = await blobToDataUrl(await canvasToJpegBlob(canvas, candidate.quality));
      if (smallest.length <= maximumCharacters) {
        return { dataUrl: smallest, mediaType: 'image/jpeg' };
      }
    }

    throw new Error(
      `The compressed chat reference is still too large (${Math.ceil(smallest.length / 1024)} KB).`,
    );
  } finally {
    bitmap.close();
  }
}

export async function prepareFlashBoardChatVisualReferences(input: {
  composer: FlashBoardComposerState;
  mediaFiles: MediaFile[];
  signal?: AbortSignal;
}): Promise<FlashBoardChatVisualReference[]> {
  const images = collectFlashBoardChatReferenceImages(input.composer, input.mediaFiles);
  if (images.length === 0) return [];
  if (images.length > FLASHBOARD_CHAT_MAX_VISUAL_REFERENCES) {
    throw new Error(
      `Chat supports up to ${FLASHBOARD_CHAT_MAX_VISUAL_REFERENCES} reference images per message.`,
    );
  }

  const maximumCharacters = Math.floor(
    FLASHBOARD_CHAT_VISUAL_REFERENCE_CHARACTER_BUDGET / images.length,
  );
  const references: FlashBoardChatVisualReference[] = [];
  for (const image of images) {
    throwIfAborted(input.signal);
    try {
      const prepared = await boundedImageDataUrl(
        await readMediaImageBlob(image),
        maximumCharacters,
        input.signal,
      );
      references.push({
        dataUrl: prepared.dataUrl,
        height: image.height,
        id: image.id,
        mediaType: prepared.mediaType,
        name: image.name,
        width: image.width,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not attach "${image.name}" to chat: ${detail}`);
    }
  }
  return references;
}
