import { Logger } from '../../../../services/logger';
import type { ModelRuntimeTexture } from './types';

const log = Logger.create('ModelRuntimeCache');

export async function createTextureFromBytes(
  bytes: ArrayBuffer,
  mimeType?: string,
): Promise<ModelRuntimeTexture | null> {
  if (typeof createImageBitmap !== 'function' || typeof Blob === 'undefined') {
    return null;
  }

  try {
    const blob = new Blob([bytes], { type: mimeType || 'image/png' });
    const image = await createImageBitmap(blob);
    return {
      image,
      width: image.width,
      height: image.height,
      mimeType,
    };
  } catch (error) {
    log.warn('Failed to decode model texture', { mimeType, error });
    return null;
  }
}
