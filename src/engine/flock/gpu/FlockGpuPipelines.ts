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
  FLOCK_POINTS_WGSL,
  FLOCK_VECTORS_WGSL,
} from '../shaders/flockRenderWgsl';

const log = Logger.create('FlockGpuPipelines');

export type FlockRenderKind = 'points' | 'instances' | 'links' | 'vectors' | 'curves' | 'glyphs' | 'glyphCubes';
export type FlockBlendMode = 'additive' | 'alpha' | 'opaque';

const RENDER_SOURCES: Record<FlockRenderKind, { code: string; vertex: string; fragment: string }> = {
  points: { code: FLOCK_POINTS_WGSL, vertex: 'vsPoints', fragment: 'fsPoints' },
  instances: { code: FLOCK_INSTANCES_WGSL, vertex: 'vsInstances', fragment: 'fsInstances' },
  links: { code: FLOCK_LINKS_RENDER_WGSL, vertex: 'vsLinks', fragment: 'fsLines' },
  vectors: { code: FLOCK_VECTORS_WGSL, vertex: 'vsVectors', fragment: 'fsLines' },
  curves: { code: FLOCK_CURVES_WGSL, vertex: 'vsCurves', fragment: 'fsLines' },
  glyphs: { code: FLOCK_GLYPHS_WGSL, vertex: 'vsGlyphs', fragment: 'fsGlyphs' },
  glyphCubes: { code: FLOCK_GLYPH_CUBES_WGSL, vertex: 'vsGlyphCubes', fragment: 'fsLines' },
};

const BRANCH_BUFFER_BINDINGS: Record<FlockRenderKind, number> = {
  points: 0,
  instances: 0,
  vectors: 0,
  links: 1,
  curves: 2,
  glyphs: 2,
  glyphCubes: 2,
};

function uniform(binding: number, visibility: number, dynamic = false): GPUBindGroupLayoutEntry {
  return { binding, visibility, buffer: { type: 'uniform', hasDynamicOffset: dynamic } };
}

function storage(binding: number, visibility: number, readOnly: boolean): GPUBindGroupLayoutEntry {
  return { binding, visibility, buffer: { type: readOnly ? 'read-only-storage' : 'storage' } };
}

/** Shader compile/validation diagnostics are otherwise invisible to Logger readers. */
function createCheckedModule(device: GPUDevice, code: string, label: string): GPUShaderModule {
  const module = device.createShaderModule({ code, label });
  void module.getCompilationInfo?.().then((info) => {
    const errors = info.messages.filter((message) => message.type === 'error');
    if (errors.length > 0) {
      log.error(`WGSL compile errors in ${label}`, errors.slice(0, 6).map((message) => `${message.lineNum}:${message.linePos} ${message.message}`));
    }
  }).catch(() => undefined);
  return module;
}

function watchValidation(device: GPUDevice, label: string): () => void {
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
  private readonly branchLayouts = new Map<FlockRenderKind, GPUBindGroupLayout>();
  private readonly renderModules = new Map<FlockRenderKind, GPUShaderModule>();
  private readonly renderPipelines = new Map<string, GPURenderPipeline>();
  private readonly device: GPUDevice;

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

    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.frameLayout = device.createBindGroupLayout({
      label: 'flock-render-frame-layout',
      entries: [uniform(0, VF), storage(1, GPUShaderStage.VERTEX, true), storage(2, GPUShaderStage.VERTEX, true)],
    });
  }

  getBranchLayout(kind: FlockRenderKind): GPUBindGroupLayout {
    let layout = this.branchLayouts.get(kind);
    if (!layout) {
      const entries: GPUBindGroupLayoutEntry[] = [uniform(0, GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT)];
      for (let binding = 1; binding <= BRANCH_BUFFER_BINDINGS[kind]; binding += 1) {
        entries.push(storage(binding, GPUShaderStage.VERTEX, true));
      }
      layout = this.device.createBindGroupLayout({ label: `flock-branch-${kind}-layout`, entries });
      this.branchLayouts.set(kind, layout);
    }
    return layout;
  }

  getRenderPipeline(kind: FlockRenderKind, blend: FlockBlendMode): GPURenderPipeline {
    const key = `${kind}:${blend}`;
    const existing = this.renderPipelines.get(key);
    if (existing) return existing;
    const source = RENDER_SOURCES[kind];
    let module = this.renderModules.get(kind);
    if (!module) {
      module = createCheckedModule(this.device, source.code, `flock-render-${kind}`);
      this.renderModules.set(kind, module);
    }
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
        bindGroupLayouts: [this.frameLayout, this.getBranchLayout(kind)],
        label: `flock-render-${kind}-layout`,
      }),
      vertex: {
        module,
        entryPoint: source.vertex,
        buffers: kind === 'instances'
          ? [{
              arrayStride: 24,
              stepMode: 'vertex',
              attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x3' },
                { shaderLocation: 1, offset: 12, format: 'float32x3' },
              ],
            }]
          : [],
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
