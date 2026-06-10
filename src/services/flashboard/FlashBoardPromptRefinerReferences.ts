import {
  FLASHBOARD_PROMPT_REFINER_MAX_REFERENCE_IMAGE_EDGE,
  FLASHBOARD_PROMPT_REFINER_REFERENCE_IMAGE_QUALITY,
} from './FlashBoardPromptRefinerConfig';
import type { FlashBoardPromptRefinerReference, PreparedPromptReference } from './FlashBoardPromptRefinerTypes';

function getReferenceSource(reference: FlashBoardPromptRefinerReference): { url: string; revoke?: boolean } | null {
  if (reference.file?.type.startsWith('image/')) {
    return {
      url: URL.createObjectURL(reference.file),
      revoke: true,
    };
  }

  const url = reference.thumbnailUrl ?? (reference.mediaType === 'image' ? reference.url : undefined);
  return url ? { url } : null;
}

function loadImage(sourceUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be loaded.'));
    image.src = sourceUrl;
  });
}

async function imageUrlToJpegDataUrl(sourceUrl: string): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('Prompt refinement image preparation requires a browser.');
  }

  const image = await loadImage(sourceUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  if (!sourceWidth || !sourceHeight) {
    throw new Error('Image has no readable dimensions.');
  }

  const scale = Math.min(
    1,
    FLASHBOARD_PROMPT_REFINER_MAX_REFERENCE_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight),
  );
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not prepare image canvas.');
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', FLASHBOARD_PROMPT_REFINER_REFERENCE_IMAGE_QUALITY);
}

async function prepareReferenceImage(reference: FlashBoardPromptRefinerReference): Promise<PreparedPromptReference | null> {
  const source = getReferenceSource(reference);
  if (!source) {
    return null;
  }

  try {
    return {
      role: reference.role,
      label: reference.label,
      displayName: reference.displayName,
      dataUrl: await imageUrlToJpegDataUrl(source.url),
    };
  } catch (error) {
    throw new Error(`Could not prepare ${reference.label} (${reference.displayName}) for prompt refinement.`, {
      cause: error,
    });
  } finally {
    if (source.revoke) {
      URL.revokeObjectURL(source.url);
    }
  }
}

export async function prepareReferenceImages(
  references: FlashBoardPromptRefinerReference[],
): Promise<PreparedPromptReference[]> {
  const prepared = await Promise.all(references.map((reference) => prepareReferenceImage(reference)));
  return prepared.filter((reference): reference is PreparedPromptReference => Boolean(reference));
}
