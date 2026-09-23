export type ImageOperatorResourceSampling = 'hardware-linear-clamp' | 'manual-bilinear-clamp' | 'exact-pixel-load' | 'exact-u32-pixel-load';
export const IMAGE_FRAME_HISTORY_RESOURCE_ID = 'effect-history';

export interface ImageOperatorNamedImage {
  id: string;
  sampling: ImageOperatorResourceSampling;
}

export function validateImageOperatorNamedImages(images: readonly ImageOperatorNamedImage[] | undefined): Map<string, ImageOperatorResourceSampling> {
  const result = new Map<string, ImageOperatorResourceSampling>();
  for (const image of images ?? []) {
    if (typeof image?.id !== 'string' || !image.id) throw new Error('Image named input declarations require a non-empty string id.');
    if (image.id === IMAGE_FRAME_HISTORY_RESOURCE_ID || image.id.startsWith('image-resource:') || image.id.startsWith('glyph-atlas:') || image.id.startsWith('memory-window:') || image.id.startsWith('input-history:') || image.id.startsWith('source-motion:')) {
      throw new Error(`Image named input ${image.id} uses a reserved compiler resource namespace.`);
    }
    if (result.has(image.id)) throw new Error(`Duplicate image named input declaration: ${image.id}.`);
    if (image.sampling !== 'hardware-linear-clamp' && image.sampling !== 'manual-bilinear-clamp') {
      throw new Error(`Image named input ${image.id} has an invalid sampling contract.`);
    }
    result.set(image.id, image.sampling);
  }
  return result;
}

export function resolveImageOperatorNamedImage(binding: unknown, declarations: ReadonlyMap<string, ImageOperatorResourceSampling>): ImageOperatorNamedImage {
  if (typeof binding !== 'string' || !binding) throw new Error('Image named input must bind to a resource id.');
  const sampling = declarations.get(binding);
  if (!sampling) throw new Error(`Image named input ${binding} is not declared in the compile context.`);
  return { id: binding, sampling };
}
