import { SceneLayerComposite } from '../../native3d/passes/SceneLayerComposite';
import type { FlockDrawPlan } from './FlockBranchRenderer';
export { SCENE_LAYER_BLEND_CASES as FLOCK_LAYER_BLEND_CASES } from '../../native3d/passes/SceneLayerComposite';

export function flockNeedsLayerComposite(plan: FlockDrawPlan): boolean {
  return (plan.layer.blendMode ?? 'normal') !== 'normal' || (plan.layer.opacity ?? 1) < 1;
}

/** Maps simulation timing onto the shared HDR scene compositor. */
export class FlockLayerComposite {
  private readonly composite = new SceneLayerComposite();
  begin(device: GPUDevice, encoder: GPUCommandEncoder, scene: GPUTextureView, width: number, height: number): GPUTextureView {
    return this.composite.begin(device, encoder, scene, width, height);
  }
  end(encoder: GPUCommandEncoder, scene: GPUTextureView, plan: FlockDrawPlan, temporaryBuffers: GPUBuffer[]): void {
    this.composite.end(encoder, scene, {
      blendMode: plan.layer.blendMode, opacity: plan.layer.opacity, time: plan.session.step / plan.program.stepRate,
    }, temporaryBuffers);
  }
  dispose(): void { this.composite.dispose(); }
}
