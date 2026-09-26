import type { FlockProgram, FlockResolvedRender } from '../../../services/flock/compiler/flockProgramTypes';
import type { SceneCamera, SceneFlockLayer } from '../../scene/types';
import { FLOCK_SHADOW_FORMAT, type FlockGpuPipelines, type FlockRenderKind, type FlockShadowKind } from './FlockGpuPipelines';
import { FLOCK_SHADOW_MAP_SIZE, resolveFlockLight, type FlockLightSetup } from './flockLighting';
import { ROOM_VERTEX_COUNT } from '../shaders/flockRoomWgsl';
import type { FlockGpuSession } from './FlockGpuSession';
import { getFlockMesh } from './flockMeshes';
import { getFlockModelMesh } from './flockModelMeshes';
import { getFlockPigmentBinding } from './flockPigmentTextures';
import { renderHostPort } from '../../../services/render/renderHostPort';
import { BRANCH_BYTES, RENDER_BLOCK_BYTES, flockPointChildren, packBranch, packRenderBlock } from './flockRenderPacking';

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
  pigmentAsset: string;
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
  private readonly shadowTextures = new Map<string, GPUTexture>();
  private readonly shadowPlaceholder: GPUTexture;
  private readonly shadowPlaceholderView: GPUTextureView;
  private readonly shadowSampler: GPUSampler;
  /** Light setup resolved during this frame's opaque pass, reused by the transparent pass. */
  private readonly lights = new WeakMap<FlockDrawPlan, FlockLightSetup>();

  constructor(device: GPUDevice, pipelines: FlockGpuPipelines) {
    this.device = device;
    this.pipelines = pipelines;
    this.placeholder = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE, label: 'flock-placeholder-storage' });
    this.shadowPlaceholder = device.createTexture({
      size: [1, 1],
      format: FLOCK_SHADOW_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      label: 'flock-shadow-placeholder',
    });
    this.shadowPlaceholderView = this.shadowPlaceholder.createView();
    this.shadowSampler = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear', label: 'flock-shadow-sampler' });
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
          case 'points':
            instanceCount = program.capacity * flockPointChildren(branch);
            break;
          case 'room':
            vertexCount = ROOM_VERTEX_COUNT;
            instanceCount = 1;
            break;
          default:
            break;
        }
        if (instanceCount <= 0) continue;
        const usesPigment = branch.p.e.colorMode === 'image' || (branch.p.n.relief ?? 0) !== 0;
        const pigmentAsset = usesPigment ? branch.p.a.image ?? '' : '';
        draws.push({ plan, kind: packed.renderKind, blend: packed.blend, branchData: packed.data, pigmentAsset, storage, vertexBuffer, vertexCount, instanceCount });
      }
    }
    return draws;
  }

  private shadowTexture(clipId: string): GPUTexture {
    let texture = this.shadowTextures.get(clipId);
    if (!texture) {
      texture = this.device.createTexture({
        size: [FLOCK_SHADOW_MAP_SIZE, FLOCK_SHADOW_MAP_SIZE],
        format: FLOCK_SHADOW_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        label: `flock-shadow-${clipId}`,
      });
      this.shadowTextures.set(clipId, texture);
    }
    return texture;
  }

  private frameGroup(plan: FlockDrawPlan, camera: SceneCamera, light: FlockLightSetup, shadowView: GPUTextureView, temporaryBuffers: GPUBuffer[]): GPUBindGroup {
    const frameBuffer = this.device.createBuffer({ size: RENDER_BLOCK_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'flock-render-block' });
    temporaryBuffers.push(frameBuffer);
    this.device.queue.writeBuffer(frameBuffer, 0, packRenderBlock({
      camera,
      layerWorld: plan.layer.worldMatrix,
      render: plan.render,
      emitters: plan.program.emitters,
      light,
      alpha: plan.alpha,
      capacity: plan.program.capacity,
      maxSpeed: plan.program.simulation.params.numbers.maxSpeed?.base ?? 45,
      stepRate: plan.program.stepRate,
      neighborLimit: plan.program.simulation.neighborLimit,
    }));
    return this.device.createBindGroup({
      layout: this.pipelines.frameLayout,
      entries: [
        { binding: 0, resource: { buffer: frameBuffer } },
        { binding: 1, resource: { buffer: plan.session.currentState } },
        { binding: 2, resource: { buffer: plan.session.previousState } },
        { binding: 3, resource: shadowView },
        { binding: 4, resource: this.shadowSampler },
      ],
      label: 'flock-frame-group',
    });
  }

  private branchGroup(draw: PreparedDraw, temporaryBuffers: GPUBuffer[]): GPUBindGroup {
    const branchBuffer = this.device.createBuffer({ size: BRANCH_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: `flock-branch-${draw.kind}` });
    temporaryBuffers.push(branchBuffer);
    this.device.queue.writeBuffer(branchBuffer, 0, draw.branchData);
    const pigment = getFlockPigmentBinding(this.device, draw.pigmentAsset, () => renderHostPort.requestRender());
    return this.device.createBindGroup({
      layout: this.pipelines.getBranchLayout(draw.kind),
      entries: [
        { binding: 0, resource: { buffer: branchBuffer } },
        ...draw.storage.map((buffer, index) => ({ binding: index + 1, resource: { buffer } })),
        { binding: 8, resource: pigment.view },
        { binding: 9, resource: pigment.sampler },
      ],
      label: `flock-branch-group-${draw.kind}`,
    });
  }

  /** Renders every point/instance branch of lit plans into that plan's shadow map (opaque pass only). */
  private renderShadows(commandEncoder: GPUCommandEncoder, plans: FlockDrawPlan[], camera: SceneCamera, temporaryBuffers: GPUBuffer[]): void {
    for (const plan of plans) {
      const light = resolveFlockLight(plan.render, plan.program.emitters);
      this.lights.set(plan, light);
      if (!light.enabled) continue;
      const casters = [...this.collect([plan], 'opaque'), ...this.collect([plan], 'transparent')]
        .filter((draw) => draw.kind === 'points' || draw.kind === 'instances');
      const shadowPass = commandEncoder.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.shadowTexture(plan.layer.clipId).createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
        label: 'native-scene-flock-shadow-pass',
      });
      if (casters.length > 0) {
        const frame = this.frameGroup(plan, camera, light, this.shadowPlaceholderView, temporaryBuffers);
        for (const draw of casters) {
          shadowPass.setPipeline(this.pipelines.getShadowPipeline(draw.kind as FlockShadowKind));
          shadowPass.setBindGroup(0, frame);
          shadowPass.setBindGroup(1, this.branchGroup(draw, temporaryBuffers));
          if (draw.vertexBuffer) shadowPass.setVertexBuffer(0, draw.vertexBuffer);
          shadowPass.draw(draw.vertexCount, draw.instanceCount);
        }
      }
      shadowPass.end();
    }
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
    if (pass === 'opaque') this.renderShadows(commandEncoder, plans, camera, temporaryBuffers);
    const draws = this.collect(plans, pass);
    if (draws.length === 0) return true;
    const frameGroups = new Map<FlockDrawPlan, GPUBindGroup>();
    for (const plan of new Set(draws.map((draw) => draw.plan))) {
      const light = this.lights.get(plan) ?? resolveFlockLight(plan.render, plan.program.emitters);
      const shadowView = light.enabled ? this.shadowTexture(plan.layer.clipId).createView() : this.shadowPlaceholderView;
      frameGroups.set(plan, this.frameGroup(plan, camera, light, shadowView, temporaryBuffers));
    }

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: sceneView, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: sceneDepthView, depthLoadOp: 'load', depthStoreOp: 'store' },
      label: `native-scene-flock-${pass}-pass`,
    });
    for (const draw of draws) {
      renderPass.setPipeline(this.pipelines.getRenderPipeline(draw.kind, draw.blend));
      renderPass.setBindGroup(0, frameGroups.get(draw.plan)!);
      renderPass.setBindGroup(1, this.branchGroup(draw, temporaryBuffers));
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
    for (const texture of this.shadowTextures.values()) texture.destroy();
    this.shadowTextures.clear();
    this.shadowPlaceholder.destroy();
  }
}
