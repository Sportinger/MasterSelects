import type { ScenePlaneLayer } from '../../scene/types';
import type { LayerSpaceEffectContext } from '../sceneRenderer/LayerSpaceEffectRenderer';
import { SlitScanSurfacePass, type SlitScanSurfaceDraw } from './SlitScanSurfacePass';
import { ProjectedLayerEffects } from './ProjectedLayerEffects';

/** Slit Scan adapter for the shared projected-image effect pass. */
export class SlitScanProjectedEffects {
  private readonly effects = new ProjectedLayerEffects();
  private readonly mesh = new SlitScanSurfacePass();
  render(key: string, device: GPUDevice, encoder: GPUCommandEncoder, output: GPUTextureView,
    sceneDepth: GPUTextureView, width: number, height: number, layer: ScenePlaneLayer,
    draw: SlitScanSurfaceDraw, context: LayerSpaceEffectContext, temporary: GPUBuffer[]): void {
    this.effects.render(key, device, encoder, output, sceneDepth, width, height, layer.postProjectionEffects ?? [], draw.opacity,
      (color, depth) => { this.mesh.render(device, encoder, color, depth, [{ ...draw, opacity: 1 }], temporary); return true; }, context, temporary);
  }
  release(key: string): void { this.effects.release(key); }
  destroy(): void { this.effects.destroy(); this.mesh.dispose(); }
}
