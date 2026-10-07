import type { SceneCamera } from '../../scene/types';
import type { StrandPass, StrandShadowFrame } from '../passes/StrandPass';
import { ProjectedLayerEffects } from '../passes/ProjectedLayerEffects';
import type { LayerSpaceEffectContext } from './LayerSpaceEffectRenderer';

/** Raster strand stacks process only their owner's projected pixels, retaining scene depth. */
export class StrandProjectedEffects {
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
    const keys = new Set(effected.map(({ draw }) => JSON.stringify([target, draw.layer.layerId])));
    for (const key of this.keys.get(target) ?? []) if (!keys.has(key)) this.effects.release(key);
    this.keys.set(target, keys);
    const subset = (items: typeof selected): StrandShadowFrame => ({ ...frame,
      draws: items.map(item => item.draw), targets: items.map(item => frame.targets[item.index]) });
    if (!effected.length) return pass.render(device, encoder, color, depth, frame, camera, temporary);
    if (!context) throw new Error('Strand image effects require the effects pipeline.');
    if (!pass.render(device, encoder, color, depth, subset(selected.filter(item => !effected.includes(item))), camera, temporary)) return false;
    for (const item of effected) {
      const key = JSON.stringify([target, item.draw.layer.layerId]);
      // The strand renderer already applies clip opacity, so composite with opacity one.
      if (!this.effects.render(key, device, encoder, color, depth, camera.viewport.width, camera.viewport.height,
        item.draw.layer.postProjectionEffects!, 1,
        (ownColor, ownDepth) => pass.render(device, encoder, ownColor, ownDepth, subset([item]), camera, temporary), context, temporary)) return false;
    }
    this.applied.add(target); return true;
  }

  releaseTarget(target: string): void {
    for (const key of this.keys.get(target) ?? []) this.effects.release(key);
    this.keys.delete(target); this.applied.delete(target);
  }
  destroy(): void { this.effects.destroy(); this.keys.clear(); this.applied.clear(); }
}
