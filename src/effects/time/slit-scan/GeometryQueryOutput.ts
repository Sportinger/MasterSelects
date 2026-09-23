import { compileImageOperatorGraph } from '../../../services/operators/imageOperatorGraph';
import { effectOperatorCompileContext, effectOperatorParams } from '../../../services/operators/effectGraphOwner';
import { slitScanGeometryQuery } from './geometryContract';
import type { SlitScanGeometryCapture } from './geometryCapture';
import { slitScanGeometryMotionGraph } from '../../../services/operators/slitScanGeometryMotionGraph';

/** Numeric query output shares the exact evaluated graph and source resources
 * with color. It never reads back pixels or creates a second source history. */
export class GeometryQueryOutput {
  trajectory?: import('../DisTrajectory').DisTrajectory;
  private texture?: GPUTexture;
  private device?: GPUDevice;
  private runtime?: SlitScanGeometryCapture['passRuntime'];
  private instanceId?: string;
  private compiled?: { key: string; graph: SlitScanGeometryCapture['graph']; plan: ReturnType<typeof compileImageOperatorGraph> };

  capture(frame: SlitScanGeometryCapture, samplerId: string, motion = false): GPUTextureView | undefined {
    if (!frame.source) throw new Error('Slit Scan geometry requires a source video.');
    const params = effectOperatorParams(frame.effect);
    const key = JSON.stringify([frame.graph, params, frame.effect.type, samplerId, motion]);
    if (this.compiled?.key !== key) {
      const graph = motion ? slitScanGeometryMotionGraph(frame.graph, samplerId) : slitScanGeometryQuery(frame.graph, samplerId);
      const plan = compileImageOperatorGraph(graph, params, effectOperatorCompileContext(frame.effect));
      this.compiled = { key, graph, plan };
    }
    const { graph, plan } = this.compiled;
    const resources = new Map(frame.resources);
    if (!frame.resolveResources(plan, resources, graph)) return undefined;
    this.trajectory = motion ? [...resources.values()].find(resource => resource.disTrajectory)?.disTrajectory : undefined;
    if (!this.texture || this.device !== frame.device || this.texture.width !== frame.width || this.texture.height !== frame.height) {
      this.destroy(); this.device = frame.device;
      this.texture = frame.device.createTexture({ label: 'slit-scan-numeric-query',
        size: [frame.width, frame.height], format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    }
    const view = this.texture.createView();
    // A simple inline query still needs one numeric render pass. No dummy
    // materialization or half-float intermediate is introduced for that case.
    const renderPlan = plan.passes?.length ? plan : { ...plan, passes: [
      { id: 'slit-scan-query-output', program: plan, inputResources: plan.resourceInputs ?? [] },
    ] };
    this.runtime = frame.passRuntime;
    this.instanceId = JSON.stringify(['slit-scan-query', motion, frame.scopeId, frame.effect.id]);
    const encoded = frame.passRuntime.encode({ encoder: frame.encoder, sampler: frame.sampler,
      source: { kind: 'texture', view: frame.input }, width: frame.width, height: frame.height,
      timelineTimeSeconds: frame.timelineTime, plan: renderPlan, outputView: view, outputFormat: 'rgba32float',
      instanceId: this.instanceId, externalResources: resources });
    if (!encoded) throw new Error('Slit Scan numeric query did not render.');
    return view;
  }

  destroy(): void {
    if (this.instanceId) this.runtime?.release(this.instanceId);
    this.instanceId = undefined; this.runtime = undefined;
    const texture = this.texture, device = this.device;
    this.texture = undefined; this.device = undefined;
    if (texture && device) void Promise.resolve().then(() => device.queue.onSubmittedWorkDone())
      .then(() => texture.destroy(), () => texture.destroy());
  }
}
