import { Logger } from '../../../services/logger';
import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../../native3d/sceneRenderer/constants';
import {
  FLOCK_CELLS_WGSL,
  FLOCK_GRID_WGSL,
  FLOCK_LINKS_WGSL,
  FLOCK_SIMULATE_WGSL,
  FLOCK_SORT_WGSL,
  FLOCK_TRAIL_WGSL,
} from '../shaders/flockComputeWgsl';
import {
  FLOCK_CURVES_WGSL,
  FLOCK_GLYPH_CUBES_WGSL,
  FLOCK_GLYPHS_WGSL,
  FLOCK_INSTANCES_WGSL,
  FLOCK_LINKS_RENDER_WGSL,
  FLOCK_VECTORS_WGSL,
} from '../shaders/flockRenderWgsl';
import { FLOCK_POINTS_CACHE_COMPUTE_WGSL, FLOCK_POINTS_CACHED_WGSL, FLOCK_POINTS_WGSL } from '../shaders/flockPointsWgsl';
import { FLOCK_ROOM_WGSL } from '../shaders/flockRoomWgsl';

const log = Logger.create('FlockGpuPipelines');

export type FlockRenderKind = 'points' | 'pointsCached' | 'instances' | 'links' | 'vectors' | 'curves' | 'glyphs' | 'glyphCubes' | 'room';
export type FlockShadowKind = 'points' | 'pointsCached' | 'instances';
export const FLOCK_SHADOW_FORMAT: GPUTextureFormat = 'depth32float';
export type FlockBlendMode = 'additive' | 'alpha' | 'opaque';

const RENDER_SOURCES: Record<FlockRenderKind, { code: string; vertex: string; fragment: string }> = {
  points: { code: FLOCK_POINTS_WGSL, vertex: 'vsPoints', fragment: 'fsPoints' },
  pointsCached: { code: FLOCK_POINTS_CACHED_WGSL, vertex: 'vsPointsCached', fragment: 'fsPoints' },
  instances: { code: FLOCK_INSTANCES_WGSL, vertex: 'vsInstances', fragment: 'fsInstances' },
  links: { code: FLOCK_LINKS_RENDER_WGSL, vertex: 'vsLinks', fragment: 'fsLines' },
  vectors: { code: FLOCK_VECTORS_WGSL, vertex: 'vsVectors', fragment: 'fsLines' },
  curves: { code: FLOCK_CURVES_WGSL, vertex: 'vsCurves', fragment: 'fsLines' },
  glyphs: { code: FLOCK_GLYPHS_WGSL, vertex: 'vsGlyphs', fragment: 'fsGlyphs' },
  glyphCubes: { code: FLOCK_GLYPH_CUBES_WGSL, vertex: 'vsGlyphCubes', fragment: 'fsLines' },
  room: { code: FLOCK_ROOM_WGSL, vertex: 'vsRoom', fragment: 'fsRoom' },
};

const SHADOW_ENTRIES: Record<FlockShadowKind, { vertex: string; fragment?: string }> = {
  points: { vertex: 'vsPointsShadow', fragment: 'fsPointsShadow' },
  pointsCached: { vertex: 'vsPointsShadowCached', fragment: 'fsPointsShadow' },
  instances: { vertex: 'vsInstancesShadow' },
};

const BRANCH_BUFFER_BINDINGS: Record<FlockRenderKind, number> = {
  points: 0,
  pointsCached: 0,
  instances: 0,
  vectors: 0,
  links: 1,
  curves: 2,
  glyphs: 2,
  glyphCubes: 2,
  room: 0,
};

const INSTANCE_VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 24,
  stepMode: 'vertex',
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
  ],
};

function uniform(binding: number, visibility: number, dynamic = false): GPUBindGroupLayoutEntry {
  return { binding, visibility, buffer: { type: 'uniform', hasDynamicOffset: dynamic } };
}

function storage(binding: number, visibility: number, readOnly: boolean): GPUBindGroupLayoutEntry {
  return { binding, visibility, buffer: { type: readOnly ? 'read-only-storage' : 'storage' } };
}

/** Shader compile/validation diagnostics are otherwise invisible to Logger readers. */
export function createCheckedModule(device: GPUDevice, code: string, label: string): GPUShaderModule {
  const module = device.createShaderModule({ code, label });
  void module.getCompilationInfo?.().then((info) => {
    const errors = info.messages.filter((message) => message.type === 'error');
    if (errors.length > 0) {
      log.error(`WGSL compile errors in ${label}`, errors.slice(0, 6).map((message) => `${message.lineNum}:${message.linePos} ${message.message}`));
    }
  }).catch(() => undefined);
  return module;
}

export function watchValidation(device: GPUDevice, label: string): () => void {
  device.pushErrorScope('validation');
  return () => {
    void device.popErrorScope().then((error) => {
      if (error) log.error(`GPU validation error while creating ${label}`, error.message);
    }).catch(() => undefined);
  };
}

export class FlockGpuPipelines {
  readonly gridLayout: GPUBindGroupLayout;
  readonly sortLayout: GPUBindGroupLayout;
  readonly cellsLayout: GPUBindGroupLayout;
  readonly simulateLayout: GPUBindGroupLayout;
  readonly trailLayout: GPUBindGroupLayout;
  readonly linksLayout: GPUBindGroupLayout;
  readonly hashPipeline: GPUComputePipeline;
  readonly sortPipeline: GPUComputePipeline;
  readonly cellsPipeline: GPUComputePipeline;
  readonly simulatePipeline: GPUComputePipeline;
  readonly trailPipeline: GPUComputePipeline;
  readonly linksPipeline: GPUComputePipeline;
  readonly frameLayout: GPUBindGroupLayout;
  readonly pointCacheComputeLayout: GPUBindGroupLayout;
  readonly pointCacheRenderLayout: GPUBindGroupLayout;
  private readonly pointCachePipelines = new Map<'cachePoints' | 'cacheVisibility', GPUComputePipeline>();
  private readonly branchLayouts = new Map<FlockRenderKind, GPUBindGroupLayout>();
  private readonly renderModules = new Map<FlockRenderKind, GPUShaderModule>();
  private readonly renderPipelines = new Map<string, GPURenderPipeline>();
  private readonly shadowPipelines = new Map<FlockShadowKind, GPURenderPipeline>();
  private readonly device: GPUDevice;
  private pointCacheModule: GPUShaderModule | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
    const C = GPUShaderStage.COMPUTE;
    const done = watchValidation(device, 'flock compute pipelines');
    this.gridLayout = device.createBindGroupLayout({
      label: 'flock-grid-layout',
      entries: [storage(0, C, true), storage(1, C, false), storage(2, C, false), uniform(3, C, true)],
    });
    this.sortLayout = device.createBindGroupLayout({
      label: 'flock-sort-layout',
      entries: [storage(0, C, false), storage(1, C, false), uniform(2, C, true)],
    });
    this.cellsLayout = device.createBindGroupLayout({
      label: 'flock-cells-layout',
      entries: [storage(0, C, true), storage(1, C, false), uniform(2, C, true)],
    });
    this.simulateLayout = device.createBindGroupLayout({
      label: 'flock-simulate-layout',
      entries: [storage(0, C, true), storage(1, C, false), storage(2, C, true), storage(3, C, true), uniform(4, C, true), storage(5, C, false)],
    });
    this.trailLayout = device.createBindGroupLayout({
      label: 'flock-trail-layout',
      entries: [storage(0, C, true), storage(1, C, true), storage(2, C, false), uniform(3, C, true)],
    });
    this.linksLayout = device.createBindGroupLayout({
      label: 'flock-links-layout',
      entries: [storage(0, C, true), storage(1, C, true), storage(2, C, true), storage(3, C, false), uniform(4, C, false)],
    });
    const compute = (code: string, entryPoint: string, layout: GPUBindGroupLayout, label: string) => device.createComputePipeline({
      label,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout], label: `${label}-layout` }),
      compute: { module: createCheckedModule(device, code, label), entryPoint },
    });
    this.hashPipeline = compute(FLOCK_GRID_WGSL, 'hashParticles', this.gridLayout, 'flock-hash');
    this.sortPipeline = compute(FLOCK_SORT_WGSL, 'sortStep', this.sortLayout, 'flock-sort');
    this.cellsPipeline = compute(FLOCK_CELLS_WGSL, 'cellRanges', this.cellsLayout, 'flock-cells');
    this.simulatePipeline = compute(FLOCK_SIMULATE_WGSL, 'simulate', this.simulateLayout, 'flock-simulate');
    this.trailPipeline = compute(FLOCK_TRAIL_WGSL, 'trailWrite', this.trailLayout, 'flock-trails');
    this.linksPipeline = compute(FLOCK_LINKS_WGSL, 'buildLinks', this.linksLayout, 'flock-links');
    done();

    // Render layouts are also visible to compute so the point cache prepass can share them.
    const VFC = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
    const VC = GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE;
    this.frameLayout = device.createBindGroupLayout({
      label: 'flock-render-frame-layout',
      entries: [
        uniform(0, VFC),
        storage(1, VFC, true),
        storage(2, VC, true),
        { binding: 3, visibility: VFC, texture: { sampleType: 'depth' } },
        { binding: 4, visibility: VFC, sampler: { type: 'comparison' } },
      ],
    });
    this.pointCacheComputeLayout = device.createBindGroupLayout({
      label: 'flock-point-cache-compute-layout',
      entries: [storage(0, GPUShaderStage.COMPUTE, false), uniform(1, GPUShaderStage.COMPUTE)],
    });
    this.pointCacheRenderLayout = device.createBindGroupLayout({
      label: 'flock-point-cache-render-layout',
      entries: [storage(0, VFC, true)],
    });
  }

  getBranchLayout(requestedKind: FlockRenderKind): GPUBindGroupLayout {
    // Cached points bind the same branch group as direct points.
    const kind = requestedKind === 'pointsCached' ? 'points' : requestedKind;
    let layout = this.branchLayouts.get(kind);
    if (!layout) {
      const VFC = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
      const VC = GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE;
      const entries: GPUBindGroupLayoutEntry[] = [uniform(0, VFC)];
      for (let binding = 1; binding <= BRANCH_BUFFER_BINDINGS[kind]; binding += 1) {
        entries.push(storage(binding, VC, true));
      }
      entries.push(
        { binding: 8, visibility: VC, texture: { sampleType: 'float' } },
        { binding: 9, visibility: VC, sampler: { type: 'filtering' } },
      );
      layout = this.device.createBindGroupLayout({ label: `flock-branch-${kind}-layout`, entries });
      this.branchLayouts.set(kind, layout);
    }
    return layout;
  }

  private renderModule(kind: FlockRenderKind): GPUShaderModule {
    let module = this.renderModules.get(kind);
    if (!module) {
      module = createCheckedModule(this.device, RENDER_SOURCES[kind].code, `flock-render-${kind}`);
      this.renderModules.set(kind, module);
    }
    return module;
  }

  private renderGroupLayouts(kind: FlockRenderKind): GPUBindGroupLayout[] {
    const layouts = [this.frameLayout, this.getBranchLayout(kind)];
    if (kind === 'pointsCached') layouts.push(this.pointCacheRenderLayout);
    return layouts;
  }

  /** Compute prepass that writes one record per point (position, color) or its shadow visibility. */
  getPointCachePipeline(entryPoint: 'cachePoints' | 'cacheVisibility'): GPUComputePipeline {
    const existing = this.pointCachePipelines.get(entryPoint);
    if (existing) return existing;
    let module = this.pointCacheModule;
    if (!module) {
      module = createCheckedModule(this.device, FLOCK_POINTS_CACHE_COMPUTE_WGSL, 'flock-point-cache');
      this.pointCacheModule = module;
    }
    const done = watchValidation(this.device, `flock ${entryPoint} pipeline`);
    const pipeline = this.device.createComputePipeline({
      label: `flock-${entryPoint}`,
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.frameLayout, this.getBranchLayout('points'), this.pointCacheComputeLayout],
        label: `flock-${entryPoint}-layout`,
      }),
      compute: { module, entryPoint },
    });
    done();
    this.pointCachePipelines.set(entryPoint, pipeline);
    return pipeline;
  }

  /** Depth-only pipeline that draws a casting branch into the key light's shadow map. */
  getShadowPipeline(kind: FlockShadowKind): GPURenderPipeline {
    const existing = this.shadowPipelines.get(kind);
    if (existing) return existing;
    const module = this.renderModule(kind);
    const entries = SHADOW_ENTRIES[kind];
    const done = watchValidation(this.device, `flock ${kind} shadow pipeline`);
    const pipeline = this.device.createRenderPipeline({
      label: `flock-shadow-${kind}`,
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: this.renderGroupLayouts(kind),
        label: `flock-shadow-${kind}-layout`,
      }),
      vertex: {
        module,
        entryPoint: entries.vertex,
        buffers: kind === 'instances' ? [INSTANCE_VERTEX_LAYOUT] : [],
      },
      ...(entries.fragment ? { fragment: { module, entryPoint: entries.fragment, targets: [] } } : {}),
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: FLOCK_SHADOW_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    });
    done();
    this.shadowPipelines.set(kind, pipeline);
    return pipeline;
  }

  getRenderPipeline(kind: FlockRenderKind, blend: FlockBlendMode): GPURenderPipeline {
    const key = `${kind}:${blend}`;
    const existing = this.renderPipelines.get(key);
    if (existing) return existing;
    const source = RENDER_SOURCES[kind];
    const module = this.renderModule(kind);
    const blendState: GPUBlendState | undefined = blend === 'opaque'
      ? undefined
      : blend === 'additive'
        ? {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          }
        : {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          };
    const done = watchValidation(this.device, `flock ${key} render pipeline`);
    const pipeline = this.device.createRenderPipeline({
      label: `flock-render-${key}`,
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: this.renderGroupLayouts(kind),
        label: `flock-render-${kind}-layout`,
      }),
      vertex: {
        module,
        entryPoint: source.vertex,
        buffers: kind === 'instances' ? [INSTANCE_VERTEX_LAYOUT] : [],
      },
      fragment: {
        module,
        entryPoint: source.fragment,
        targets: [{ format: SCENE_COLOR_FORMAT, ...(blendState ? { blend: blendState } : {}) }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: SCENE_DEPTH_FORMAT,
        depthWriteEnabled: blend === 'opaque',
        depthCompare: 'less-equal',
      },
    });
    done();
    this.renderPipelines.set(key, pipeline);
    return pipeline;
  }
}

const pipelinesByDevice = new WeakMap<GPUDevice, FlockGpuPipelines>();

export function getFlockGpuPipelines(device: GPUDevice): FlockGpuPipelines {
  let pipelines = pipelinesByDevice.get(device);
  if (!pipelines) {
    pipelines = new FlockGpuPipelines(device);
    pipelinesByDevice.set(device, pipelines);
  }
  return pipelines;
}
