import { FlockLayerComposite, flockNeedsLayerComposite } from '../../flock/gpu/FlockLayerComposite';
import type { SceneCamera, SceneFlockLayer, SceneLayer3DData } from '../../scene/types';
import type { FlockDrawPlan, FlockPassKind } from '../../flock/gpu/FlockBranchRenderer';
import type { FlockSimulationRuntime } from '../../flock/runtime/FlockSimulationRuntime';
import type { PtSphereSetInput } from '../pathtrace/scene/ptSceneBuilder';

/**
 * Native scene integration for flock clips: advances each flock simulation to
 * the layer's source time (compute), extracts derived lines, then draws its
 * opaque branches with depth writes and its blended branches after
 * transparent geometry.
 */
export class FlockPass {
  private readonly composite = new FlockLayerComposite();
  dispose(): void { this.composite.dispose(); }

  private readonly runtime: () => FlockSimulationRuntime;

  constructor(runtime: () => FlockSimulationRuntime) {
    this.runtime = runtime;
  }

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
    const registry = this.runtime();
    const plans: FlockDrawPlan[] = [];
    for (const layer of layers) {
      const plan = registry.prepare(device, commandEncoder, layer, { realtime: realtimePlayback });
      if (plan) plans.push({ ...plan, layer: { ...plan.layer, opacity: layer.opacity, blendMode: layer.blendMode } });
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
    skipPoints = false,
  ): boolean {
    if (plans.length === 0) return true;
    const renderer = this.runtime().getRenderer(device);
    const direct = plans.filter(plan => !flockNeedsLayerComposite(plan));
    if (!renderer.render(commandEncoder, sceneView, sceneDepthView, direct, camera, pass, temporaryBuffers, skipPoints)) return false;
    if (pass === 'transparent') for (const plan of plans.filter(flockNeedsLayerComposite)) {
      if ((plan.layer.opacity ?? 1) <= 0) continue;
      const view = this.composite.begin(device, commandEncoder, sceneView, camera.viewport.width, camera.viewport.height);
      if (!renderer.render(commandEncoder, view, sceneDepthView, [plan], camera, 'opaque', temporaryBuffers, false)) return false;
      if (!renderer.render(commandEncoder, view, sceneDepthView, [plan], camera, 'transparent', temporaryBuffers, false)) return false;
      this.composite.end(commandEncoder, sceneView, plan, temporaryBuffers);
    }
    return true;
  }

  /** Point branches for the path tracer; each `emit` writes that branch's spheres into the object pool. */
  pathTracePoints(device: GPUDevice, plans: FlockDrawPlan[], camera: SceneCamera): PtSphereSetInput[] {
    if (plans.length === 0) return [];
    const renderer = this.runtime().getRenderer(device);
    return renderer.pathTracePoints(plans.filter(plan => !flockNeedsLayerComposite(plan)), camera).map(points => ({
      key: `flock:${points.key}`, count: points.count, lit: points.lit, version: points.version,
      emit: (encoder, objects, base, temporaries) => renderer.encodePathTraceSpheres(encoder, points, base, objects, camera, temporaries),
    }));
  }
}
