import type { FlockProgram, FlockResolvedRender } from '../../../services/flock/compiler/flockProgramTypes';
import type { SceneCamera, SceneFlockLayer } from '../../scene/types';
import { FLOCK_SHADOW_FORMAT, type FlockGpuPipelines, type FlockRenderKind, type FlockShadowKind } from './FlockGpuPipelines';
import { FLOCK_SHADOW_MAP_SIZE, resolveFlockLight, type FlockLightSetup } from './flockLighting';
import { ROOM_VERTEX_COUNT } from '../shaders/flockRoomWgsl';
import type { FlockGpuSession } from './FlockGpuSession';
import { getFlockMesh } from './flockMeshes';
import type { FlockRenderAssets } from './FlockRenderAssets';
import { FlockPointCache } from './FlockPointCache';
import { FlockPointRasterizer, type FlockRasterTarget } from './FlockPointRasterizer';
import { flockGpuTimings } from './FlockGpuTimings';
import { FLOCK_PATH_TRACE_WORKGROUP } from '../shaders/flockPathTraceWgsl';
import { BRANCH_BYTES, RENDER_BLOCK_BYTES, flockPointChildren, flockPointChildrenForViewport, flockPointUsesCompute, flockPointUsesTriangles, packBranch, packRenderBlock } from './flockRenderPacking';

export interface FlockLinkBinding {
  buffer: GPUBuffer;
  perParticle: number;
  fraction: number;
}

export interface FlockDrawPlan {
  layer: Pick<SceneFlockLayer, 'clipId' | 'worldMatrix'> & Partial<Pick<SceneFlockLayer, 'opacity' | 'blendMode'>>;
  session: FlockGpuSession;
  program: FlockProgram;
  render: FlockResolvedRender;
  alpha: number;
  links: Map<number, FlockLinkBinding>;
}

export type FlockPassKind = 'opaque' | 'transparent';

/** A point branch the path tracer draws as spheres (plan 3.7). */
export interface FlockPathTracePoints {
  key: string;
  count: number;
  /** Lit points reflect light; unlit (and additive) points emit their color. */
  lit: boolean;
  /** Changes whenever the points may have moved (simulation step, interpolation, camera for screen-sized points). */
  version: string;
}

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
  /** Point branches: key of their per-frame point cache. */
  cacheKey: string | null;
  lit: boolean;
  compute: boolean;
}

/** Draws every render branch of flock layers into the shared scene targets. */
export class FlockBranchRenderer {
  private readonly device: GPUDevice;
  private readonly assets: FlockRenderAssets;
  private readonly pipelines: FlockGpuPipelines;
  private readonly meshBuffers = new Map<string, { buffer: GPUBuffer; vertexCount: number }>();
  private readonly modelKeys = new Map<string, string>();
  private readonly placeholder: GPUBuffer;
  private readonly shadowTextures = new Map<string, GPUTexture>();
  private readonly shadowPlaceholder: GPUTexture;
  private readonly shadowPlaceholderView: GPUTextureView;
  private readonly shadowSampler: GPUSampler;
  /** Point branches handed to the path tracer this frame, by cache key. */
  private readonly pathTraceDraws = new Map<string, PreparedDraw>();
  /** Light setup resolved during this frame's opaque pass, reused by the transparent pass. */
  private readonly lights = new WeakMap<FlockDrawPlan, FlockLightSetup>();
  private readonly pointCache: FlockPointCache;
  /** Point caches filled during this frame's opaque pass, reused by the transparent pass. */
  private readonly frameCacheKeys = new Set<string>();
  private rasterizer: FlockPointRasterizer | null = null;
  private readonly frameRasterTargets = new Map<string, FlockRasterTarget>();
  private readonly placeholderCache: GPUBindGroup;

  constructor(device: GPUDevice, pipelines: FlockGpuPipelines, assets: FlockRenderAssets) {
    this.device = device;
    this.assets = assets;
    this.pipelines = pipelines;
    this.placeholder = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE, label: 'flock-placeholder-storage' });
    this.placeholderCache = device.createBindGroup({ layout: pipelines.pointCacheRenderLayout, entries: [{ binding: 0, resource: { buffer: this.placeholder } }] });
    this.shadowPlaceholder = device.createTexture({
      size: [1, 1],
      format: FLOCK_SHADOW_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      label: 'flock-shadow-placeholder',
    });
    this.shadowPlaceholderView = this.shadowPlaceholder.createView();
    this.shadowSampler = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear', label: 'flock-shadow-sampler' });
    this.pointCache = new FlockPointCache(device, pipelines);
  }

  private meshBuffer(kind: string, modelAssetId: string): { buffer: GPUBuffer; vertexCount: number } {
    let mesh = getFlockMesh(kind === 'model' ? 'arrow' : kind);
    let key: string = mesh.kind;
    if (kind === 'model') {
      const model = this.assets.model(modelAssetId);
      if (model.mesh) {
        mesh = model.mesh;
        key = `model:${modelAssetId}:${model.revision ?? 0}`;
        const previous = this.modelKeys.get(modelAssetId);
        if (previous && previous !== key) {
          const retired = this.meshBuffers.get(previous);
          this.meshBuffers.delete(previous);
          if (retired) void this.device.queue.onSubmittedWorkDone().then(
            () => retired.buffer.destroy(), () => retired.buffer.destroy(),
          );
        }
        this.modelKeys.set(modelAssetId, key);
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

  private collect(plans: FlockDrawPlan[], pass: FlockPassKind, viewport: SceneCamera['viewport']): PreparedDraw[] {
    const draws: PreparedDraw[] = [];
    for (const plan of plans) {
      const { session, program } = plan;
      for (const branch of plan.render.branches) {
        const trail = branch.spec.trailIndex >= 0 ? session.trailResources[branch.spec.trailIndex] : undefined;
        const link = branch.spec.kind === 'links' ? plan.links.get(branch.spec.index) : undefined;
        const pointChildren = branch.spec.kind === 'points'
          ? flockPointChildrenForViewport(branch, program.capacity, viewport.width * viewport.height)
          : 1;
        const packed = packBranch(branch, {
          pointChildren,
          viewportHeight: viewport.height,
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
            instanceCount = program.capacity * pointChildren;
            vertexCount = flockPointUsesTriangles(branch, viewport.height) ? 3 : 6;
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
        const cacheKey = packed.renderKind === 'points' ? `${plan.layer.clipId}:${branch.spec.index}:${pointChildren}` : null;
        const lit = packed.renderKind === 'points' ? branch.p.e.shading === 'lit' : true;
        const compute = flockPointUsesCompute(branch, viewport.height);
        draws.push({ plan, kind: packed.renderKind, blend: packed.blend, branchData: packed.data, pigmentAsset, storage, vertexBuffer, vertexCount, instanceCount, cacheKey, lit, compute });
      }
    }
    return draws;
  }

  /** The plans' point branches for the path tracer, with their point counts (those within the cache budget). */
  pathTracePoints(plans: FlockDrawPlan[], camera: SceneCamera): FlockPathTracePoints[] {
    this.pathTraceDraws.clear();
    const points: FlockPathTracePoints[] = [];
    for (const plan of plans) {
      for (const draw of [...this.collect([plan], 'opaque', camera.viewport), ...this.collect([plan], 'transparent', camera.viewport)]) {
        if (draw.kind !== 'points' || !draw.cacheKey || !this.pointCache.ensure(draw.cacheKey, draw.instanceCount)) continue;
        this.pathTraceDraws.set(draw.cacheKey, draw);
        points.push({ key: draw.cacheKey, count: draw.instanceCount, lit: draw.lit && draw.blend !== 'additive',
          version: `${plan.session.step}|${plan.alpha}|${plan.render.time}|${Array.from(camera.viewMatrix).join(',')}` });
      }
    }
    return points;
  }

  /** Evaluates the points of `points` (cachePoints) and writes them as spheres at vec4 `base` of the path tracer's object pool. */
  encodePathTraceSpheres(encoder: GPUCommandEncoder, points: FlockPathTracePoints, base: number, objects: GPUBuffer, camera: SceneCamera,
    temporaryBuffers: GPUBuffer[]): void {
    const draw = this.pathTraceDraws.get(points.key);
    const entry = draw ? this.pointCache.ensure(points.key, draw.instanceCount) : null;
    if (!draw || !entry) return;
    const frame = this.frameGroup(draw.plan, camera, resolveFlockLight(draw.plan.render, draw.plan.program.emitters), this.shadowPlaceholderView,
      temporaryBuffers);
    const branch = this.branchGroup(draw, temporaryBuffers);
    this.pointCache.encode(encoder, 'cachePoints', entry, frame, branch);
    const dispatchWidth = Math.min(65535, this.device.limits.maxComputeWorkgroupsPerDimension) * FLOCK_PATH_TRACE_WORKGROUP;
    const params = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'flock-path-trace-params' });
    temporaryBuffers.push(params);
    this.device.queue.writeBuffer(params, 0, Uint32Array.of(entry.total, base, dispatchWidth, 0));
    const pass = encoder.beginComputePass({ label: 'flock-path-trace-spheres' });
    pass.setPipeline(this.pipelines.getPathTracePipeline());
    pass.setBindGroup(0, frame);
    pass.setBindGroup(1, branch);
    pass.setBindGroup(2, this.device.createBindGroup({ layout: this.pipelines.pathTraceLayout, label: 'flock-path-trace-group', entries: [
      { binding: 0, resource: { buffer: entry.buffer } }, { binding: 1, resource: { buffer: objects } }, { binding: 2, resource: { buffer: params } }] }));
    pass.dispatchWorkgroups(Math.ceil(Math.min(entry.total, dispatchWidth) / FLOCK_PATH_TRACE_WORKGROUP), Math.ceil(entry.total / dispatchWidth));
    pass.end();
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
        { binding: 5, resource: { buffer: plan.session.identityMapping } },
      ],
      label: 'flock-frame-group',
    });
  }

  private branchGroup(draw: PreparedDraw, temporaryBuffers: GPUBuffer[]): GPUBindGroup {
    const branchBuffer = this.device.createBuffer({ size: BRANCH_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: `flock-branch-${draw.kind}` });
    temporaryBuffers.push(branchBuffer);
    this.device.queue.writeBuffer(branchBuffer, 0, draw.branchData);
    const pigment = this.assets.pigment(draw.pigmentAsset);
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

  private cachedGroup(draw: PreparedDraw): GPUBindGroup | null {
    return draw.cacheKey && this.frameCacheKeys.has(draw.cacheKey) ? this.pointCache.renderGroup(draw.cacheKey) : null;
  }

  /**
   * Opaque-pass preparation per plan: resolve the key light, fill point caches
   * (one compute invocation per point), render casters into the shadow map and
   * resolve cached points' shadow visibility.
   */
  private prepareFrame(commandEncoder: GPUCommandEncoder, plans: FlockDrawPlan[], camera: SceneCamera, temporaryBuffers: GPUBuffer[]): void {
    this.frameCacheKeys.clear();
    this.frameRasterTargets.clear();
    this.rasterizer?.beginFrame();
    this.pointCache.beginFrame();
    for (const plan of plans) {
      const light = resolveFlockLight(plan.render, plan.program.emitters);
      this.lights.set(plan, light);
      const draws = [...this.collect([plan], 'opaque', camera.viewport), ...this.collect([plan], 'transparent', camera.viewport)];
      const pointDraws = draws.filter((draw) => draw.kind === 'points');
      const drawDiagnostics = {
        clipId: plan.layer.clipId, viewport: { ...camera.viewport }, simulated: plan.program.capacity,
        points: pointDraws.reduce((sum, draw) => sum + draw.instanceCount, 0),
        shadowPoints: light.enabled ? pointDraws.length * plan.program.capacity : 0,
        children: pointDraws.map((draw) => draw.instanceCount / plan.program.capacity),
        requestedChildren: plan.render.branches.filter((branch) => branch.spec.kind === 'points').map(flockPointChildren),
        updatedAt: Date.now(),
      };
      let prepFrame: GPUBindGroup | null = null;
      const prepFrameGroup = () => {
        prepFrame ??= this.frameGroup(plan, camera, light, this.shadowPlaceholderView, temporaryBuffers);
        return prepFrame;
      };
      const cached: PreparedDraw[] = [];
      for (const draw of draws) {
        if (!draw.cacheKey) continue;
        const entry = this.pointCache.ensure(draw.cacheKey, draw.instanceCount);
        if (!entry) continue;
        this.pointCache.encode(commandEncoder, 'cachePoints', entry, prepFrameGroup(), this.branchGroup(draw, temporaryBuffers));
        this.frameCacheKeys.add(draw.cacheKey);
        if (draw.compute) {
          this.rasterizer ??= new FlockPointRasterizer(this.device, this.pipelines);
          const target = this.rasterizer.ensure(`main:${draw.cacheKey}`, camera.viewport.width, camera.viewport.height, draw.instanceCount);
          if (target) this.frameRasterTargets.set(draw.cacheKey, target);
        }
        cached.push(draw);
      }
      flockGpuTimings(this.device).recordDraw({ ...drawDiagnostics,
        computePoints: pointDraws.reduce((sum, draw) => sum + (this.frameRasterTargets.has(draw.cacheKey!) ? draw.instanceCount : 0), 0),
      });
      if (!light.enabled) continue;

      const casters = draws.filter((draw) => draw.kind === 'points' || draw.kind === 'instances').map(draw => {
        if (draw.kind !== 'points') return draw;
        const branchData = draw.branchData.slice(0);
        new Float32Array(branchData)[42] = 1;
        return { ...draw, branchData, instanceCount: plan.program.capacity };
      });
      const computeCasters = casters.filter(draw => {
        const params = new Float32Array(draw.branchData);
        return draw.kind === 'points' && (1 + params[7] * 0.35) * Math.max(1, params[46]) <= 8;
      });
      let shadowTarget: FlockRasterTarget | null = null;
      let shadowGroups: [GPUBindGroup, GPUBindGroup, GPUBindGroup] | null = null;
      if (computeCasters.length > 0) {
        this.rasterizer ??= new FlockPointRasterizer(this.device, this.pipelines);
        shadowTarget = this.rasterizer.ensure(`shadow:${plan.layer.clipId}`, FLOCK_SHADOW_MAP_SIZE, FLOCK_SHADOW_MAP_SIZE, plan.program.capacity);
        if (shadowTarget) {
          for (const [index, caster] of computeCasters.entries()) {
            shadowGroups = [prepFrameGroup(), this.branchGroup(caster, temporaryBuffers), this.placeholderCache];
            if (index === 0) this.rasterizer.encode(commandEncoder, 'clearPixels', shadowTarget, shadowGroups);
            this.rasterizer.encode(commandEncoder, 'shadowDepth', shadowTarget, shadowGroups);
          }
        }
      }
      const shadowView = this.shadowTexture(plan.layer.clipId).createView();
      const shadowPass = commandEncoder.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: { view: shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        label: 'native-scene-flock-shadow-pass',
        timestampWrites: flockGpuTimings(this.device).writes(commandEncoder, 'shadow'),
      });
      if (shadowTarget && shadowGroups) this.rasterizer!.draw(shadowPass, shadowTarget, shadowGroups, true);
      for (const draw of casters) {
        if (shadowTarget && computeCasters.includes(draw)) continue;
        shadowPass.setPipeline(this.pipelines.getShadowPipeline(draw.kind as FlockShadowKind));
        shadowPass.setBindGroup(0, prepFrameGroup());
        shadowPass.setBindGroup(1, this.branchGroup(draw, temporaryBuffers));
        if (draw.vertexBuffer) shadowPass.setVertexBuffer(0, draw.vertexBuffer);
        shadowPass.draw(draw.vertexCount, draw.instanceCount);
      }
      shadowPass.end();

      const litCached = cached.filter((draw) => draw.lit && !this.frameRasterTargets.has(draw.cacheKey!));
      if (litCached.length === 0) continue;
      const mainFrame = this.frameGroup(plan, camera, light, this.shadowTexture(plan.layer.clipId).createView(), temporaryBuffers);
      for (const draw of litCached) {
        const entry = this.pointCache.ensure(draw.cacheKey!, draw.instanceCount)!;
        this.pointCache.encode(commandEncoder, 'cacheVisibility', entry, mainFrame, this.branchGroup(draw, temporaryBuffers));
      }
    }
    this.pointCache.pruneUnused();
  }

  render(
    commandEncoder: GPUCommandEncoder,
    sceneView: GPUTextureView,
    sceneDepthView: GPUTextureView,
    plans: FlockDrawPlan[],
    camera: SceneCamera,
    pass: FlockPassKind,
    temporaryBuffers: GPUBuffer[],
    /** Path traced frames: the path tracer draws the point branches as spheres. */
    skipPoints = false,
  ): boolean {
    if (pass === 'opaque') this.prepareFrame(commandEncoder, plans, camera, temporaryBuffers);
    const draws = this.collect(plans, pass, camera.viewport).filter(draw => !skipPoints || draw.kind !== 'points');
    if (draws.length === 0) return true;
    const frameGroups = new Map<FlockDrawPlan, GPUBindGroup>();
    for (const plan of new Set(draws.map((draw) => draw.plan))) {
      const light = this.lights.get(plan) ?? resolveFlockLight(plan.render, plan.program.emitters);
      const shadowView = light.enabled ? this.shadowTexture(plan.layer.clipId).createView() : this.shadowPlaceholderView;
      frameGroups.set(plan, this.frameGroup(plan, camera, light, shadowView, temporaryBuffers));
    }

    const rasterGroups = new Map<PreparedDraw, [GPUBindGroup, GPUBindGroup, GPUBindGroup]>();
    for (const draw of draws) {
      const target = draw.cacheKey ? this.frameRasterTargets.get(draw.cacheKey) : null;
      if (!target) continue;
      const groups: [GPUBindGroup, GPUBindGroup, GPUBindGroup] = [frameGroups.get(draw.plan)!, this.branchGroup(draw, temporaryBuffers), this.cachedGroup(draw)!];
      rasterGroups.set(draw, groups);
      this.rasterizer!.encode(commandEncoder, 'clearPixels', target, groups);
      this.rasterizer!.encode(commandEncoder, 'pointDepth', target, groups);
      this.rasterizer!.encode(commandEncoder, 'pointWinner', target, groups);
    }

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: sceneView, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: sceneDepthView, depthLoadOp: 'load', depthStoreOp: 'store' },
      label: `native-scene-flock-${pass}-pass`,
      timestampWrites: flockGpuTimings(this.device).writes(commandEncoder, `main-${pass}`),
    });
    for (const draw of draws) {
      const rasterGroup = rasterGroups.get(draw);
      if (rasterGroup) {
        this.rasterizer!.draw(renderPass, this.frameRasterTargets.get(draw.cacheKey!)!, rasterGroup);
        continue;
      }
      const cacheGroup = this.cachedGroup(draw);
      renderPass.setPipeline(this.pipelines.getRenderPipeline(cacheGroup ? 'pointsCached' : draw.kind, draw.blend));
      renderPass.setBindGroup(0, frameGroups.get(draw.plan)!);
      renderPass.setBindGroup(1, this.branchGroup(draw, temporaryBuffers));
      if (cacheGroup) renderPass.setBindGroup(2, cacheGroup);
      if (draw.vertexBuffer) renderPass.setVertexBuffer(0, draw.vertexBuffer);
      renderPass.draw(draw.vertexCount, draw.instanceCount);
    }
    renderPass.end();
    return true;
  }

  dispose(): void {
    for (const entry of this.meshBuffers.values()) entry.buffer.destroy();
    this.meshBuffers.clear();
    this.modelKeys.clear();
    this.placeholder.destroy();
    this.pointCache.dispose();
    this.rasterizer?.dispose();
    for (const texture of this.shadowTextures.values()) texture.destroy();
    this.shadowTextures.clear();
    this.shadowPlaceholder.destroy();
  }
}
