import type { Layer } from '../../types/layers';
import type { ThumbnailLayerData, ThumbnailResources } from './contracts';

export function collectThumbnailLayerData(resources: ThumbnailResources, layers: Layer[]): ThumbnailLayerData[] {
  const { textureManager } = resources;
  const result: ThumbnailLayerData[] = [];

  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer?.visible || !layer.source || layer.opacity === 0) continue;

    if (layer.source.videoElement) {
      const video = layer.source.videoElement;
      if (video.readyState >= 2) {
        const extTex = textureManager.importVideoTexture(video);
        if (extTex) {
          result.push({
            layer,
            isVideo: true,
            externalTexture: extTex,
            textureView: null,
            sourceWidth: video.videoWidth,
            sourceHeight: video.videoHeight,
          });
          continue;
        }
      }
    }

    if (layer.source.imageElement) {
      const img = layer.source.imageElement;
      let texture = textureManager.getCachedImageTexture(img);
      if (!texture) {
        texture = textureManager.createImageTexture(img) ?? undefined;
      }
      if (texture) {
        result.push({
          layer,
          isVideo: false,
          externalTexture: null,
          textureView: textureManager.getImageView(texture),
          sourceWidth: img.naturalWidth,
          sourceHeight: img.naturalHeight,
        });
        continue;
      }
    }

    if (layer.source.textCanvas) {
      const source = textureManager.createCanvasSourceTexture(layer.source.textCanvas);
      if (source) {
        result.push({ layer, isVideo: false, externalTexture: null, ...source });
      }
    }
  }

  return result;
}
