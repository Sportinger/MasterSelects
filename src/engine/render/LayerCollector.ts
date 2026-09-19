// Collects layer render data by importing textures from various sources

import type { Layer, LayerRenderData, DetailedStats } from '../core/types';
import type { TextureManager } from '../texture/TextureManager';
import type { ScrubbingCache } from '../texture/ScrubbingCache';
import { Logger } from '../../services/logger';
import type { MotionRenderer } from '../motion/MotionRenderer';
import type { LayerCollectorMutationSink } from './layerCollector/collectorStatus';
import { isCollectableLayer } from './layerCollector/collectionPredicates';
import {
  collectNativeDecoderFrame,
  collectParallelVideoFrame,
} from './layerCollector/directVideoCollectors';
import { HtmlVideoCollector } from './layerCollector/htmlVideoCollector';
import { collectStaticLayerData } from './layerCollector/staticSourceCollectors';
import { WebCodecsLayerCollector } from './layerCollector/webCodecsCollector';

const log = Logger.create('LayerCollector');

export interface LayerCollectorDeps {
  textureManager: TextureManager;
  motionRenderer?: MotionRenderer | null;
  scrubbingCache: ScrubbingCache | null;
  getLastVideoTime: (key: string) => number | undefined;
  setLastVideoTime: (key: string, time: number) => void;
  isExporting: boolean;
  isPlaying: boolean;
}

export class LayerCollector {
  private layerRenderData: LayerRenderData[] = [];
  private currentDecoder: DetailedStats['decoder'] = 'none';
  private currentWebCodecsInfo?: DetailedStats['webCodecsInfo'];
  private hasVideo = false;
  private lastCollectedCount = -1;
  private readonly statusSink: LayerCollectorMutationSink = {
    setDecoder: (decoder) => {
      this.currentDecoder = decoder;
    },
    setWebCodecsInfo: (info) => {
      this.currentWebCodecsInfo = info;
    },
    markHasVideo: () => {
      this.hasVideo = true;
    },
  };
  private readonly htmlVideoCollector = new HtmlVideoCollector(this.statusSink);
  private readonly webCodecsCollector = new WebCodecsLayerCollector(
    this.statusSink,
    this.htmlVideoCollector
  );

  collect(layers: Layer[], deps: LayerCollectorDeps): LayerRenderData[] {
    this.layerRenderData.length = 0;
    this.hasVideo = false;
    this.currentDecoder = 'none';
    this.currentWebCodecsInfo = undefined;

    // Process layers in reverse order (lower slots render on top)
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!isCollectableLayer(layer)) {
        continue;
      }

      try {
        const data = this.collectLayerData(layer, deps);
        if (data) {
          this.layerRenderData.push(data);
        }
      } catch (err) {
        log.warn(`Layer ${layer.id} collect error, skipping`, err);
      }
    }

    // Only log when collected count changes (not per-frame)
    if (this.layerRenderData.length !== this.lastCollectedCount) {
      log.debug(`Layers collected: ${this.layerRenderData.length}/${layers.length}`);
      this.lastCollectedCount = this.layerRenderData.length;
    }
    return this.layerRenderData;
  }

  private collectLayerData(layer: Layer, deps: LayerCollectorDeps): LayerRenderData | null {
    const source = layer.source;
    if (!source) return null;

    const staticLayerData = collectStaticLayerData(layer, deps);
    if (staticLayerData !== undefined) {
      if (staticLayerData && source.isLiveInput) {
        this.currentDecoder = 'HTMLVideo';
        this.hasVideo = true;
      }
      return staticLayerData;
    }

    if (source.type === 'video') {
      const nativeData = collectNativeDecoderFrame(layer, deps);
      if (nativeData) {
        this.currentDecoder = 'NativeHelper';
        return nativeData;
      }

      const parallelData = collectParallelVideoFrame(layer, deps);
      if (parallelData) {
        this.currentDecoder = 'ParallelDecode';
        this.hasVideo = true;
        return parallelData;
      }

      if (deps.isExporting && source.videoElement) {
        return this.htmlVideoCollector.collect(layer, source.videoElement, deps);
      }

      return this.webCodecsCollector.collect(layer, deps);
    }

    return null;
  }

  getDecoder(): DetailedStats['decoder'] {
    return this.currentDecoder;
  }

  getWebCodecsInfo(): DetailedStats['webCodecsInfo'] {
    return this.currentWebCodecsInfo;
  }

  hasActiveVideo(): boolean {
    return this.hasVideo;
  }

  isVideoGpuReady(video: HTMLVideoElement): boolean {
    return this.htmlVideoCollector.isVideoGpuReady(video);
  }

  markVideoGpuReady(video: HTMLVideoElement): void {
    this.htmlVideoCollector.markVideoGpuReady(video);
  }

  resetVideoGpuReady(video: HTMLVideoElement): void {
    this.htmlVideoCollector.resetVideoGpuReady(video);
  }
}
