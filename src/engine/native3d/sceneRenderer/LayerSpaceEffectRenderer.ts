import type { EffectsPipeline } from '../../../effects/EffectsPipeline';
import type { ScenePlaneLayer, SceneVoxelLayer } from '../../scene/types';

type TexturedSceneLayer = ScenePlaneLayer | SceneVoxelLayer;

interface EffectTarget {
  device: GPUDevice;
  targetKey: string;
  width: number;
  height: number;
  ping: GPUTexture;
  pong: GPUTexture;
  pingView: GPUTextureView;
  pongView: GPUTextureView;
}

export interface LayerSpaceEffectContext {
  effectsPipeline: EffectsPipeline;
  sampler: GPUSampler;
}

interface SourceTexture {
  view: GPUTextureView;
  width: number;
  height: number;
}

interface PrepareLayerSpaceEffectsOptions extends LayerSpaceEffectContext {
  device: GPUDevice;
  commandEncoder: GPUCommandEncoder;
  layers: TexturedSceneLayer[];
  targetKey: string;
  resolveSource: (layer: TexturedSceneLayer) => SourceTexture | null;
}

/** Renders effects into an object's texture before the native 3D projection. */
export class LayerSpaceEffectRenderer {
  private readonly targets = new Map<string, EffectTarget>();

  prepare(options: PrepareLayerSpaceEffectsOptions): ReadonlyMap<string, GPUTextureView> {
    const views = new Map<string, GPUTextureView>();
    const activeKeys = new Set<string>();

    for (const layer of options.layers) {
      if (!layer.layerSpaceEffects?.length) continue;
      const source = options.resolveSource(layer);
      if (!source) continue;

      const cacheKey = JSON.stringify([options.targetKey, layer.layerId]);
      activeKeys.add(cacheKey);
      const target = this.ensureTarget(
        options.device,
        cacheKey,
        options.targetKey,
        source.width,
        source.height,
      );
      const result = options.effectsPipeline.applyEffects(
        options.commandEncoder,
        layer.layerSpaceEffects,
        options.sampler,
        source.view,
        target.pingView,
        target.pingView,
        target.pongView,
        source.width,
        source.height,
        target.ping,
        target.pong,
        undefined,
        layer.mediaTime ?? 0,
      );
      views.set(layer.layerId, result.finalView);
    }

    this.pruneTarget(options.targetKey, activeKeys);
    return views;
  }

  releaseTarget(targetKey: string): void {
    this.pruneTarget(targetKey, new Set());
  }

  destroy(): void {
    for (const target of this.targets.values()) this.destroyTarget(target);
    this.targets.clear();
  }

  private ensureTarget(
    device: GPUDevice,
    cacheKey: string,
    targetKey: string,
    width: number,
    height: number,
  ): EffectTarget {
    const current = this.targets.get(cacheKey);
    if (
      current
      && current.device === device
      && current.width === width
      && current.height === height
    ) {
      return current;
    }
    if (current) this.destroyTarget(current);

    const createTexture = (suffix: string) => device.createTexture({
      label: `native-scene-layer-effect-${suffix}`,
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.STORAGE_BINDING
        | GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.COPY_SRC,
    });
    const ping = createTexture(`${cacheKey}-ping`);
    const pong = createTexture(`${cacheKey}-pong`);
    const target = {
      device,
      targetKey,
      width,
      height,
      ping,
      pong,
      pingView: ping.createView(),
      pongView: pong.createView(),
    };
    this.targets.set(cacheKey, target);
    return target;
  }

  private pruneTarget(targetKey: string, activeKeys: ReadonlySet<string>): void {
    for (const [cacheKey, target] of this.targets) {
      if (target.targetKey !== targetKey || activeKeys.has(cacheKey)) continue;
      this.destroyTarget(target);
      this.targets.delete(cacheKey);
    }
  }

  private destroyTarget(target: EffectTarget): void {
    target.ping.destroy();
    target.pong.destroy();
  }
}
