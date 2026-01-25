// Collects layer render data by importing textures from various sources

import type { Layer, LayerRenderData, DetailedStats } from '../core/types';
import type { TextureManager } from '../texture/TextureManager';
import type { ScrubbingCache } from '../texture/ScrubbingCache';

export interface LayerCollectorDeps {
  textureManager: TextureManager;
  scrubbingCache: ScrubbingCache | null;
  getLastVideoTime: (key: string) => number | undefined;
  setLastVideoTime: (key: string, time: number) => void;
  isExporting: boolean;
}

export class LayerCollector {
  private layerRenderData: LayerRenderData[] = [];
  private currentDecoder: DetailedStats['decoder'] = 'none';
  private hasVideo = false;

  collect(layers: Layer[], deps: LayerCollectorDeps): LayerRenderData[] {
    this.layerRenderData.length = 0;
    this.hasVideo = false;
    this.currentDecoder = 'none';

    // Process layers in reverse order (lower slots render on top)
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer?.visible || !layer.source || layer.opacity === 0) continue;

      const data = this.collectLayerData(layer, deps);
      if (data) {
        this.layerRenderData.push(data);
      }
    }

    return this.layerRenderData;
  }

  private collectLayerData(layer: Layer, deps: LayerCollectorDeps): LayerRenderData | null {
    const source = layer.source;
    if (!source) return null;

    // 1. Try Native Helper decoder (turbo mode)
    if (source.nativeDecoder) {
      const bitmap = source.nativeDecoder.getCurrentFrame();
      if (bitmap) {
        const texture = deps.textureManager.createImageBitmapTexture(bitmap);
        if (texture) {
          this.currentDecoder = 'NativeHelper';
          return {
            layer,
            isVideo: false,
            externalTexture: null,
            textureView: texture.createView(),
            sourceWidth: bitmap.width,
            sourceHeight: bitmap.height,
          };
        }
      }
    }

    // 2. Try direct VideoFrame (parallel decoder)
    if (source.videoFrame) {
      const frame = source.videoFrame;
      const extTex = deps.textureManager.importVideoTexture(frame);
      if (extTex) {
        this.currentDecoder = 'ParallelDecode';
        this.hasVideo = true;
        return {
          layer,
          isVideo: true,
          externalTexture: extTex,
          textureView: null,
          sourceWidth: frame.displayWidth,
          sourceHeight: frame.displayHeight,
        };
      }
    }

    // 3. Try WebCodecs VideoFrame
    if (source.webCodecsPlayer) {
      const frame = source.webCodecsPlayer.getCurrentFrame();
      if (frame) {
        const extTex = deps.textureManager.importVideoTexture(frame);
        if (extTex) {
          this.currentDecoder = 'WebCodecs';
          this.hasVideo = true;
          return {
            layer,
            isVideo: true,
            externalTexture: extTex,
            textureView: null,
            sourceWidth: frame.displayWidth,
            sourceHeight: frame.displayHeight,
          };
        }
      }
    }

    // 4. Try HTMLVideoElement
    if (source.videoElement) {
      const data = this.tryHTMLVideo(layer, source.videoElement, deps);
      if (data) return data;
    }

    // 5. Try Image
    if (source.imageElement) {
      const data = this.tryImage(layer, source.imageElement, deps);
      if (data) return data;
    }

    // 6. Try Text Canvas
    if (source.textCanvas) {
      const data = this.tryTextCanvas(layer, source.textCanvas, deps);
      if (data) return data;
    }

    // 7. Nested Composition (placeholder - actual texture set later)
    if (source.nestedComposition) {
      const nestedComp = source.nestedComposition;
      return {
        layer,
        isVideo: false,
        externalTexture: null,
        textureView: null, // Set after pre-render
        sourceWidth: nestedComp.width,
        sourceHeight: nestedComp.height,
      };
    }

    return null;
  }

  private tryHTMLVideo(layer: Layer, video: HTMLVideoElement, deps: LayerCollectorDeps): LayerRenderData | null {
    const videoKey = video.src || layer.id;

    if (video.readyState >= 2) {
      const lastTime = deps.getLastVideoTime(videoKey);
      const currentTime = video.currentTime;
      const videoTimeChanged = lastTime === undefined || Math.abs(currentTime - lastTime) > 0.001;

      // Use cache for paused videos (skip during export)
      if (!videoTimeChanged && !deps.isExporting) {
        const lastFrame = deps.scrubbingCache?.getLastFrame(video);
        if (lastFrame) {
          this.currentDecoder = 'HTMLVideo(paused-cache)';
          return {
            layer,
            isVideo: false,
            externalTexture: null,
            textureView: lastFrame.view,
            sourceWidth: lastFrame.width,
            sourceHeight: lastFrame.height,
          };
        }
      }

      // Import external texture
      const extTex = deps.textureManager.importVideoTexture(video);
      if (extTex) {
        deps.setLastVideoTime(videoKey, currentTime);

        // Cache frame for pause fallback
        const now = performance.now();
        const lastCapture = deps.scrubbingCache?.getLastCaptureTime(video) || 0;
        if (now - lastCapture > 200) {
          deps.scrubbingCache?.captureVideoFrame(video);
          deps.scrubbingCache?.setLastCaptureTime(video, now);
        }

        this.currentDecoder = 'HTMLVideo';
        this.hasVideo = true;
        return {
          layer,
          isVideo: true,
          externalTexture: extTex,
          textureView: null,
          sourceWidth: video.videoWidth,
          sourceHeight: video.videoHeight,
        };
      }

      // Fallback to cache
      const lastFrame = deps.scrubbingCache?.getLastFrame(video);
      if (lastFrame) {
        this.currentDecoder = 'HTMLVideo(cached)';
        return {
          layer,
          isVideo: false,
          externalTexture: null,
          textureView: lastFrame.view,
          sourceWidth: lastFrame.width,
          sourceHeight: lastFrame.height,
        };
      }
    } else {
      // Video not ready - try cache
      const lastFrame = deps.scrubbingCache?.getLastFrame(video);
      if (lastFrame) {
        return {
          layer,
          isVideo: false,
          externalTexture: null,
          textureView: lastFrame.view,
          sourceWidth: lastFrame.width,
          sourceHeight: lastFrame.height,
        };
      }
    }

    return null;
  }

  private tryImage(layer: Layer, img: HTMLImageElement, deps: LayerCollectorDeps): LayerRenderData | null {
    let texture = deps.textureManager.getCachedImageTexture(img);
    if (!texture) {
      texture = deps.textureManager.createImageTexture(img) ?? undefined;
    }
    if (texture) {
      return {
        layer,
        isVideo: false,
        externalTexture: null,
        textureView: deps.textureManager.getImageView(texture),
        sourceWidth: img.naturalWidth,
        sourceHeight: img.naturalHeight,
      };
    }
    return null;
  }

  private tryTextCanvas(layer: Layer, canvas: HTMLCanvasElement, deps: LayerCollectorDeps): LayerRenderData | null {
    const texture = deps.textureManager.createCanvasTexture(canvas);
    if (texture) {
      return {
        layer,
        isVideo: false,
        externalTexture: null,
        textureView: deps.textureManager.getImageView(texture),
        sourceWidth: canvas.width,
        sourceHeight: canvas.height,
      };
    }
    return null;
  }

  getDecoder(): DetailedStats['decoder'] {
    return this.currentDecoder;
  }

  hasActiveVideo(): boolean {
    return this.hasVideo;
  }
}
