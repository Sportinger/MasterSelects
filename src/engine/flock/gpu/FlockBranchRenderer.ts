import type { FlockProgram, FlockResolvedRender } from '../../../services/flock/compiler/flockProgramTypes';
import type { SceneCamera, SceneFlockLayer } from '../../scene/types';
import type { FlockGpuPipelines, FlockRenderKind } from './FlockGpuPipelines';
import type { FlockGpuSession } from './FlockGpuSession';
import { getFlockMesh } from './flockMeshes';
import { getFlockModelMesh } from './flockModelMeshes';
import { renderHostPort } from '../../../services/render/renderHostPort';
import { BRANCH_BYTES, RENDER_BLOCK_BYTES, packBranch, packRenderBlock } from './flockRenderPacking';

export interface FlockLinkBinding {
  buffer: GPUBuffer;
  perParticle: number;
  fraction: number;
}

export interface FlockDrawPlan {
  layer: SceneFlockLayer;
  session: FlockGpuSession;
  program: FlockProgram;
  render: FlockResolvedRender;
  alpha: number;
  links: Map<number, FlockLinkBinding>;
}

export type FlockPassKind = 'opaque' | 'transparent';

interface PreparedDraw {
  plan: FlockDrawPlan;
  kind: FlockRenderKind;
  blend: 'additive' | 'alpha' | 'opaque';
  branchData: ArrayBuffer;
  storage: GPUBuffer[];
  vertexBuffer?: GPUBuffer;
  vertexCount: number;
  instanceCount: number;
}

/** Draws every render branch of flock layers into the shared scene targets. */
export class FlockBranchRenderer {
  private readonly device: GPUDevice;
  private readonly pipelines: FlockGpuPipelines;
  private readonly meshBuffers = new Map<string, { buffer: GPUBuffer; vertexCount: number }>();
  private readonly placeholder: GPUBuffer;

  constructor(device: GPUDevice, pipelines: FlockGpuPipelines) {
    this.device = device;
    this.pipelines = pipelines;
    this.placeholder = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE, label: 'flock-placeholder-storage' });
  }

  private meshBuffer(kind: string, modelAssetId: string): { buffer: GPUBuffer; vertexCount: number } {
    let mesh = getFlockMesh(kind === 'model' ? 'arrow' : kind);
    let key: string = mesh.kind;
    if (kind === 'model') {
      const model = getFlockModelMesh(modelAssetId, () => renderHostPort.requestRender());
      if (model.status === 'ready' && model.mesh) {
        mesh = model.mesh;
        key = `model:${modelAssetId}`;
      }
    }
    let entry = this.meshBuffers.get(key);
    if (!entry) {
      const buffer = this.device.createBuffer({ size: mesh.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: `flock-mesh-${key}` });
      this.device.queue.writeBuffer(buffer, 0, mesh.vertices.buffer as ArrayBuffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
      entry = { buffer, vertexCount: mesh.vertexCount };
      this.meshBuffers.set(key, entry);
    }
    return entry;
  }

  private collect(plans: FlockDrawPlan[], pass: FlockPassKind): PreparedDraw[] {
    const draws: PreparedDraw[] = [];
    for (const plan of plans) {
      const { session, program } = plan;
      for (const branch of plan.render.branches) {
        const trail = branch.spec.trailIndex >= 0 ? session.trailResources[branch.spec.trailIndex] : undefined;
        const link = branch.spec.kind === 'links' ? plan.links.get(branch.spec.index) : undefined;
        const packed = packBranch(branch, {
          perParticle: link?.perParticle,
          fraction: link?.fraction,
          headRing: trail ? Math.floor(session.step / trail.interval) % trail.samples : 0,
          slotCount: trail?.slotCount ?? 0,
          samples: trail?.samples ?? 1,
          interval: trail?.interval ?? 1,
        });
        if ((packed.blend === 'opaque') !== (pass === 'opaque')) continue;
        let storage: GPUBuffer[] = [];
        let vertexCount = 6;
        let instanceCount = program.capacity;
        let vertexBuffer: GPUBuffer | undefined;
        switch (packed.renderKind) {
          case 'instances': {
            const mesh = this.meshBuffer(branch.p.e.mesh ?? 'krill', branch.p.a.model ?? '');
            vertexBuffer = mesh.buffer;
            vertexCount = mesh.vertexCount;
            break;
          }
          case 'links':
            if (!link) continue;
            storage = [link.buffer];
            instanceCount = program.capacity * link.perParticle;
            break;
          case 'curves':
            if (!trail || trail.slotCount === 0) continue;
            storage = [trail.ring, trail.slots];
            vertexCount = 6 * trail.samples * Math.max(1, branch.spec.params.integers.subdivisions ?? 3);
            instanceCount = trail.slotCount;
            break;
          case 'glyphs':
          case 'glyphCubes': {
            const anchoredToTrail = (branch.p.e.anchor ?? 'trail-head') !== 'particles';
            if (anchoredToTrail && (!trail || trail.slotCount === 0)) continue;
            storage = anchoredToTrail && trail ? [trail.ring, trail.slots] : [this.placeholder, this.placeholder];
            instanceCount = anchoredToTrail && trail ? trail.slotCount : program.capacity;
            vertexCount = packed.renderKind === 'glyphCubes' ? 72 : 6;
            break;
          }
          default:
            break;
        }
        if (instanceCount <= 0) continue;
        draws.push({ plan, kind: packed.renderKind, blend: packed.blend, branchData: packed.data, storage, vertexBuffer, vertexCount, instanceCount });
      }
    }
    return draws;
  }

  render(
    commandEncoder: GPUCommandEncoder,
    sceneView: GPUTextureView,
    sceneDepthView: GPUTextureView,
    plans: FlockDrawPlan[],
    camera: SceneCamera,
    pass: FlockPassKind,
    temporaryBuffers: GPUBuffer[],
  ): boolean {
    const draws = this.collect(plans, pass);
    if (draws.length === 0) return true;
    const frameGroups = new Map<FlockDrawPlan, GPUBindGroup>();
    for (const plan of new Set(draws.map((draw) => draw.plan))) {
      const frameBuffer = this.device.createBuffer({ size: RENDER_BLOCK_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'flock-render-block' });
      temporaryBuffers.push(frameBuffer);
      this.device.queue.writeBuffer(frameBuffer, 0, packRenderBlock({
        camera,
        layerWorld: plan.layer.worldMatrix,
        render: plan.render,
        alpha: plan.alpha,
        capacity: plan.program.capacity,
        maxSpeed: plan.program.simulation.params.numbers.maxSpeed?.base ?? 45,
        stepRate: plan.program.stepRate,
        neighborLimit: plan.program.simulation.neighborLimit,
      }));
      frameGroups.set(plan, this.device.createBindGroup({
        layout: this.pipelines.frameLayout,
        entries: [
          { binding: 0, resource: { buffer: frameBuffer } },
          { binding: 1, resource: { buffer: plan.session.currentState } },
          { binding: 2, resource: { buffer: plan.session.previousState } },
        ],
        label: 'flock-frame-group',
      }));
    }

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: sceneView, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: sceneDepthView, depthLoadOp: 'load', depthStoreOp: 'store' },
      label: `native-scene-flock-${pass}-pass`,
    });
    for (const draw of draws) {
      const branchBuffer = this.device.createBuffer({ size: BRANCH_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: `flock-branch-${draw.kind}` });
      temporaryBuffers.push(branchBuffer);
      this.device.queue.writeBuffer(branchBuffer, 0, draw.branchData);
      const branchGroup = this.device.createBindGroup({
        layout: this.pipelines.getBranchLayout(draw.kind),
        entries: [
          { binding: 0, resource: { buffer: branchBuffer } },
          ...draw.storage.map((buffer, index) => ({ binding: index + 1, resource: { buffer } })),
        ],
        label: `flock-branch-group-${draw.kind}`,
      });
      renderPass.setPipeline(this.pipelines.getRenderPipeline(draw.kind, draw.blend));
      renderPass.setBindGroup(0, frameGroups.get(draw.plan)!);
      renderPass.setBindGroup(1, branchGroup);
      if (draw.vertexBuffer) renderPass.setVertexBuffer(0, draw.vertexBuffer);
      renderPass.draw(draw.vertexCount, draw.instanceCount);
    }
    renderPass.end();
    return true;
  }

  dispose(): void {
    for (const entry of this.meshBuffers.values()) entry.buffer.destroy();
    this.meshBuffers.clear();
    this.placeholder.destroy();
  }
}
