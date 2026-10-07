import { Logger } from '../../../services/logger';
import { getCanvasVersion } from '../../../services/canvasVersion';
import type { ScenePlaneLayer } from '../../scene/types';

const log = Logger.create('NativeSceneRenderer');

export interface CachedPlaneTexture {
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | VideoFrame;
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
  videoCanvas?: HTMLCanvasElement;
  /** Content revision of the last upload; only set for sources that report one. */
  uploadedRevision?: string;
}

export interface PlaneTextureSourceState {
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | VideoFrame;
  width: number;
  height: number;
  transient?: boolean;
  videoCanvas?: HTMLCanvasElement;
}

export function resolvePlaneTextureSource(
  layer: ScenePlaneLayer,
  cached?: CachedPlaneTexture,
): PlaneTextureSourceState | null {
  if (layer.videoFrame) {
    const width = Math.max(
      1,
      Math.floor(layer.videoFrame.displayWidth || layer.videoFrame.codedWidth || layer.sourceWidth || 1),
    );
    const height = Math.max(
      1,
      Math.floor(layer.videoFrame.displayHeight || layer.videoFrame.codedHeight || layer.sourceHeight || 1),
    );
    return {
      source: layer.videoFrame,
      width,
      height,
      transient: true,
    };
  }

  if (layer.videoElement) {
    const width = Math.max(
      1,
      Math.floor(layer.videoElement.videoWidth || layer.sourceWidth || 1),
    );
    const height = Math.max(
      1,
      Math.floor(layer.videoElement.videoHeight || layer.sourceHeight || 1),
    );
    if ((layer.videoElement.readyState ?? 0) < 2) {
      return null;
    }
    // While the element is mid-seek (scrubbing), drawImage/copyExternalImage
    // can legally produce an empty frame. Returning null makes the caller
    // hold the last uploaded texture instead of flashing black.
    if (layer.videoElement.seeking && cached) {
      return null;
    }

    if (layer.preciseVideoSampling) {
      if (typeof document === 'undefined') {
        return null;
      }
      let videoCanvas = cached?.videoCanvas;
      if (!videoCanvas || videoCanvas.width !== width || videoCanvas.height !== height) {
        videoCanvas = document.createElement('canvas');
        videoCanvas.width = width;
        videoCanvas.height = height;
      }
      const context = videoCanvas.getContext('2d', {
        alpha: true,
        willReadFrequently: false,
      });
      if (!context) {
        return null;
      }
      try {
        context.clearRect(0, 0, width, height);
        context.drawImage(layer.videoElement, 0, 0, width, height);
      } catch (error) {
        log.warn('Failed to draw precise native 3D video plane frame', {
          layerId: layer.layerId,
          error,
        });
        return null;
      }
      return {
        source: videoCanvas,
        width,
        height,
        videoCanvas,
      };
    }

    return {
      source: layer.videoElement,
      width,
      height,
    };
  }

  if (layer.imageElement) {
    const width = Math.max(
      1,
      Math.floor(layer.imageElement.naturalWidth || layer.sourceWidth || 1),
    );
    const height = Math.max(
      1,
      Math.floor(layer.imageElement.naturalHeight || layer.sourceHeight || 1),
    );
    return {
      source: layer.imageElement,
      width,
      height,
    };
  }

  if (layer.canvas) {
    const width = Math.max(1, Math.floor(layer.canvas.width || layer.sourceWidth || 1));
    const height = Math.max(1, Math.floor(layer.canvas.height || layer.sourceHeight || 1));
    return {
      source: layer.canvas,
      width,
      height,
    };
  }

  return null;
}

/**
 * Revision of a source whose pixels only change when it says so: loaded images
 * (by URL) and text/solid rasters (by canvas version). Video and other canvases are
 * redrawn in place without a revision and return null, so they upload every frame.
 */
export function planeTextureSourceRevision(source: PlaneTextureSourceState['source']): string | null {
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    return source.complete ? `image:${source.currentSrc || source.src}` : null;
  }
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement
    && (source.dataset.masterselectsDynamic === 'text' || source.dataset.masterselectsDynamic === 'solid')) {
    return `${source.dataset.masterselectsDynamic}:${getCanvasVersion(source)}`;
  }
  return null;
}
