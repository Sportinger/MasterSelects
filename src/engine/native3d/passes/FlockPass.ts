import type { SceneCamera, SceneFlockLayer, SceneLayer3DData } from '../../scene/types';
import type { FlockDrawPlan, FlockPassKind } from '../../flock/gpu/FlockBranchRenderer';
import { getFlockSimulationRegistry } from '../../flock/runtime/FlockSimulationRegistry';

/**
 * Native scene integration for flock clips: advances each flock simulation to
 * the layer's source time (compute), extracts derived lines, then draws its
 * opaque branches with depth writes and its blended branches after
 * transparent geometry.
 */
export class FlockPass {
  collect(layers: SceneLayer3DData[]): SceneFlockLayer[] {
    return layers.filter((layer): layer is SceneFlockLayer => layer.kind === 'flock');
  }

  prepare(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    layers: SceneFlockLayer[],
    realtimePlayback: boolean,
  ): FlockDrawPlan[] {
    if (layers.length === 0) return [];
    const registry = getFlockSimulationRegistry();
    const plans: FlockDrawPlan[] = [];
    for (const layer of layers) {
      const plan = registry.prepare(device, commandEncoder, layer, { realtime: realtimePlayback });
      if (plan) plans.push(plan);
    }
    return plans;
  }

  render(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    sceneView: GPUTextureView,
    sceneDepthView: GPUTextureView,
    plans: FlockDrawPlan[],
    camera: SceneCamera,
    pass: FlockPassKind,
    temporaryBuffers: GPUBuffer[],
  ): boolean {
    if (plans.length === 0) return true;
    return getFlockSimulationRegistry()
      .getRenderer(device)
      .render(commandEncoder, sceneView, sceneDepthView, plans, camera, pass, temporaryBuffers);
  }
}
