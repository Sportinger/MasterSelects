import type { SceneCamera } from '../../scene/types';
import type { StrandPass, StrandShadowFrame } from '../passes/StrandPass';
import { SceneLayerComposite } from '../passes/SceneLayerComposite';
import { ProjectedLayerEffects } from '../passes/ProjectedLayerEffects';
import type { LayerSpaceEffectContext } from './LayerSpaceEffectRenderer';

/** Raster strand stacks process only their owner's projected pixels, retaining scene depth. */
export class StrandProjectedEffects {
  private readonly composite = new SceneLayerComposite();
  private readonly effects = new ProjectedLayerEffects();
  private readonly keys = new Map<string, Set<string>>();
  private readonly applied = new Set<string>();

  hasApplied(target: string): boolean { return this.applied.has(target); }

  render(target: string, pass: StrandPass, device: GPUDevice, encoder: GPUCommandEncoder,
    color: GPUTextureView, depth: GPUTextureView, frame: StrandShadowFrame, camera: SceneCamera,
    temporary: GPUBuffer[], context?: LayerSpaceEffectContext): boolean {
    this.applied.delete(target);
    const selected = frame.draws.map((draw, index) => ({ draw, index }));
    const effected = selected.filter(({ draw }) => draw.layer.postProjectionEffects?.length);
    const isolated = selected.filter(({ draw }) => draw.layer.postProjectionEffects?.length
      || (draw.layer.blendMode ?? 'normal') !== 'normal');
    const keys = new Set(effected.map(({ draw }) => JSON.stringify([target, draw.layer.layerId])));
    for (const key of this.keys.get(target) ?? []) if (!keys.has(key)) this.effects.release(key);
    this.keys.set(target, keys);
    const subset = (items: typeof selected): StrandShadowFrame => ({ ...frame,
      draws: items.map(item => item.draw), targets: items.map(item => frame.targets[item.index]) });
    if (!isolated.length) return pass.render(device, encoder, color, depth, frame, camera, temporary);
    if (effected.length && !context) throw new Error('Strand image effects require the effects pipeline.');
    if (!pass.render(device, encoder, color, depth, subset(selected.filter(item => !isolated.includes(item))), camera, temporary)) return false;
    for (const item of isolated) {
      const layer = item.draw.layer;
      const key = JSON.stringify([target, layer.layerId]);
      const customBlend = (layer.blendMode ?? 'normal') !== 'normal';
      const destination = customBlend
        ? this.composite.begin(device, encoder, color, camera.viewport.width, camera.viewport.height) : color;
      // StrandPass already applies clip opacity. Both compositors use opacity one.
      const draw = (ownColor: GPUTextureView, ownDepth: GPUTextureView) =>
        pass.render(device, encoder, ownColor, ownDepth, subset([item]), camera, temporary);
      const rendered = layer.postProjectionEffects?.length
        ? this.effects.render(key, device, encoder, destination, depth, camera.viewport.width, camera.viewport.height,
          layer.postProjectionEffects, 1, draw, context!, temporary)
        : draw(destination, depth);
      if (!rendered) return false;
      if (customBlend) this.composite.end(encoder, color,
        { blendMode: layer.blendMode, opacity: 1, time: context?.timelineTimeSeconds ?? 0 }, temporary);
    }
    if (effected.length) this.applied.add(target);
    return true;
  }

  releaseTarget(target: string): void {
    for (const key of this.keys.get(target) ?? []) this.effects.release(key);
    this.keys.delete(target); this.applied.delete(target);
  }
  destroy(): void { this.effects.destroy(); this.composite.dispose(); this.keys.clear(); this.applied.clear(); }
}
