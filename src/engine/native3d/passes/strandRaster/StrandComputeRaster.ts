import resolveShader from '../../shaders/StrandRasterResolve.wgsl?raw';
import { FlockRadixSort } from '../../../flock/gpu/FlockRadixSort';
import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../../sceneRenderer/constants';
import { STRAND_RASTER_SHADER } from '../strandShaders';
import { StrandRasterScan } from './StrandRasterScan';

const TILE = 16;
const GROUP = 256;
/** Bytes per piece record (two vec4) and per sort entry (key, piece). */
const PIECE_BYTES = 32;
const ENTRY_BYTES = 8;
/** Sort slots per piece: pieces are short spline pieces, so almost all touch one to four tiles. */
const ENTRIES_PER_PIECE = 4;

/** One strand layer for the analytic raster: its strand bind group and how its pieces are indexed. */
export interface StrandRasterLayer {
  /** Group 0 of the strand shader (uniforms with this camera, curves, shadow maps). */
  bindGroup: GPUBindGroup;
  pieces: number;
  subdivisions: number;
  instances: number;
  /** NDC depth range the layer can occupy; the sort key spreads its depth bits over it. */
  depthRange: [number, number];
}

interface Resources {
  capacity: number;
  pieces: GPUBuffer;
  counts: GPUBuffer;
  offsets: GPUBuffer;
  sort: FlockRadixSort;
}

/**
 * Tile compute raster for strands: exact front-to-back blending of analytic pixel coverage,
 * deterministic for a given device (see StrandRaster.wgsl). GPU buffers and textures belong to
 * this render-thread owner and grow on demand.
 */
export class StrandComputeRaster {
  private device: GPUDevice | null = null;
  private binLayout: GPUBindGroupLayout | null = null;
  private tileLayout: GPUBindGroupLayout | null = null;
  private resolveLayout: GPUBindGroupLayout | null = null;
  private pipelines: Record<'expand' | 'scatter' | 'ranges' | 'tiles', GPUComputePipeline> | null = null;
  private resolvePipeline: GPURenderPipeline | null = null;
  private resources: Resources | null = null;
  private targets: { width: number; height: number; color: GPUTexture; depth: GPUTexture; ranges: GPUBuffer } | null = null;
  private readonly scan = new StrandRasterScan();

  /** Largest piece count the device's buffer limits allow. */
  static pieceLimit(device: GPUDevice): number {
    const limit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
    // Capacity rounds up by a quarter plus one workgroup (see ensureResources).
    return Math.max(0, Math.floor(Math.min(limit / PIECE_BYTES, limit / (ENTRY_BYTES * ENTRIES_PER_PIECE)) / 1.25) - GROUP);
  }

  private initialize(device: GPUDevice, strandLayout: GPUBindGroupLayout): void {
    if (this.device === device && this.pipelines) return;
    this.dispose();
    this.device = device;
    const storage = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } });
    const uniform: GPUBindGroupLayoutEntry = { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } };
    this.binLayout = device.createBindGroupLayout({ label: 'strand-raster-bin', entries: [uniform, storage(1), storage(2), storage(3), storage(4)] });
    this.tileLayout = device.createBindGroupLayout({ label: 'strand-raster-tiles', entries: [uniform, storage(1), storage(5), storage(6),
      { binding: 7, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      { binding: 9, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } }] });
    const module = device.createShaderModule({ label: 'strand-raster', code: STRAND_RASTER_SHADER });
    const pipeline = (entryPoint: string, layout: GPUBindGroupLayout) => device.createComputePipeline({ label: `strand-raster-${entryPoint}`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [strandLayout, layout] }), compute: { module, entryPoint } });
    this.pipelines = { expand: pipeline('rasterExpand', this.binLayout), scatter: pipeline('rasterScatter', this.binLayout),
      ranges: pipeline('rasterFindRanges', this.tileLayout), tiles: pipeline('rasterTiles', this.tileLayout) };
    this.resolveLayout = device.createBindGroupLayout({ label: 'strand-raster-resolve', entries: [0, 1].map(binding =>
      ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } })) });
    const resolve = device.createShaderModule({ label: 'strand-raster-resolve', code: resolveShader });
    this.resolvePipeline = device.createRenderPipeline({ label: 'strand-raster-resolve',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.resolveLayout] }),
      vertex: { module: resolve, entryPoint: 'fullscreenVertex' },
      fragment: { module: resolve, entryPoint: 'resolveRaster', targets: [{ format: SCENE_COLOR_FORMAT, blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
      depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' } });
  }

  private ensureResources(device: GPUDevice, pieces: number): Resources {
    if (this.resources && this.resources.capacity >= pieces) return this.resources;
    this.destroyResources();
    const capacity = Math.max(GROUP, Math.ceil(pieces * 1.25 / GROUP) * GROUP);
    const buffer = (label: string, size: number, usage: number) => device.createBuffer({ label, size, usage: GPUBufferUsage.STORAGE | usage });
    this.resources = { capacity,
      pieces: buffer('strand-raster-pieces', capacity * PIECE_BYTES, 0),
      counts: buffer('strand-raster-counts', capacity * 4, GPUBufferUsage.COPY_SRC),
      offsets: buffer('strand-raster-offsets', capacity * 4, GPUBufferUsage.COPY_DST),
      sort: new FlockRadixSort(device, capacity * ENTRIES_PER_PIECE) };
    return this.resources;
  }

  private ensureTargets(device: GPUDevice, width: number, height: number) {
    if (this.targets?.width === width && this.targets.height === height) return this.targets;
    this.destroyTargets();
    const texture = (format: GPUTextureFormat) => device.createTexture({ label: `strand-raster-${format}`, size: [width, height], format,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    const tiles = Math.ceil(width / TILE) * Math.ceil(height / TILE);
    this.targets = { width, height, color: texture('rgba16float'), depth: texture('r32float'),
      ranges: device.createBuffer({ label: 'strand-raster-ranges', size: tiles * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }) };
    return this.targets;
  }

  /**
   * Rasterizes one strand layer and composites it over the scene color and depth. Returns false
   * without encoding anything when the layer exceeds the device limits.
   */
  render(device: GPUDevice, encoder: GPUCommandEncoder, strandLayout: GPUBindGroupLayout, sceneView: GPUTextureView,
    sceneDepthView: GPUTextureView, width: number, height: number, layer: StrandRasterLayer, temporaryBuffers: GPUBuffer[]): boolean {
    if (layer.pieces <= 0) return true;
    if (layer.pieces > StrandComputeRaster.pieceLimit(device)) return false;
    this.initialize(device, strandLayout);
    const resources = this.ensureResources(device, layer.pieces);
    const targets = this.ensureTargets(device, width, height);
    const tilesX = Math.ceil(width / TILE), tilesY = Math.ceil(height / TILE);
    const depthBits = 32 - Math.ceil(Math.log2(tilesX * tilesY + 2));
    const capacity = resources.capacity * ENTRIES_PER_PIECE;
    const maxWidth = device.limits.maxComputeWorkgroupsPerDimension;
    const groups = (count: number) => Math.ceil(count / GROUP);
    const pieceGroups = groups(layer.pieces), entryGroups = groups(capacity);
    const params = (dispatchWidth: number) => {
      const data = new ArrayBuffer(48), words = new Uint32Array(data), floats = new Float32Array(data);
      words.set([layer.pieces, layer.subdivisions, layer.instances, tilesX, tilesY, capacity, depthBits, dispatchWidth]);
      floats.set(layer.depthRange, 8);
      const uniform = device.createBuffer({ label: 'strand-raster-params', size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      temporaryBuffers.push(uniform);
      device.queue.writeBuffer(uniform, 0, data);
      return uniform;
    };
    const pieceWidth = Math.min(pieceGroups, maxWidth), entryWidth = Math.min(entryGroups, maxWidth);
    const pieceParams = params(pieceWidth), entryParams = params(entryWidth);
    const bin = device.createBindGroup({ layout: this.binLayout!, label: 'strand-raster-bin', entries: [
      { binding: 0, resource: { buffer: pieceParams } }, { binding: 1, resource: { buffer: resources.pieces } },
      { binding: 2, resource: { buffer: resources.counts } }, { binding: 3, resource: { buffer: resources.offsets } },
      { binding: 4, resource: { buffer: resources.sort.input } }] });
    const tileGroup = (uniform: GPUBuffer) => device.createBindGroup({ layout: this.tileLayout!, label: 'strand-raster-tiles', entries: [
      { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: resources.pieces } },
      { binding: 5, resource: { buffer: resources.sort.output } }, { binding: 6, resource: { buffer: targets.ranges } },
      { binding: 7, resource: sceneDepthView }, { binding: 8, resource: targets.color.createView() },
      { binding: 9, resource: targets.depth.createView() }] });

    const expand = encoder.beginComputePass({ label: 'strand-raster-expand' });
    expand.setPipeline(this.pipelines!.expand);
    expand.setBindGroup(0, layer.bindGroup);
    expand.setBindGroup(1, bin);
    expand.dispatchWorkgroups(pieceWidth, Math.ceil(pieceGroups / pieceWidth));
    expand.end();
    encoder.copyBufferToBuffer(resources.counts, 0, resources.offsets, 0, layer.pieces * 4);
    this.scan.encode(device, encoder, resources.offsets, layer.pieces, temporaryBuffers);
    // Empty slots keep key 0 and sort ahead of every tile.
    encoder.clearBuffer(resources.sort.input);
    encoder.clearBuffer(targets.ranges);
    const scatter = encoder.beginComputePass({ label: 'strand-raster-scatter' });
    scatter.setPipeline(this.pipelines!.scatter);
    scatter.setBindGroup(0, layer.bindGroup);
    scatter.setBindGroup(1, bin);
    scatter.dispatchWorkgroups(pieceWidth, Math.ceil(pieceGroups / pieceWidth));
    scatter.end();
    resources.sort.encode(encoder, null);
    const tiles = encoder.beginComputePass({ label: 'strand-raster-tiles' });
    tiles.setBindGroup(0, layer.bindGroup);
    tiles.setPipeline(this.pipelines!.ranges);
    tiles.setBindGroup(1, tileGroup(entryParams));
    tiles.dispatchWorkgroups(entryWidth, Math.ceil(entryGroups / entryWidth));
    tiles.setPipeline(this.pipelines!.tiles);
    tiles.setBindGroup(1, tileGroup(pieceParams));
    tiles.dispatchWorkgroups(tilesX, tilesY);
    tiles.end();

    const resolve = encoder.beginRenderPass({ label: 'strand-raster-resolve',
      colorAttachments: [{ view: sceneView, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: sceneDepthView, depthLoadOp: 'load', depthStoreOp: 'store' } });
    resolve.setPipeline(this.resolvePipeline!);
    resolve.setBindGroup(0, device.createBindGroup({ layout: this.resolveLayout!, entries: [
      { binding: 0, resource: targets.color.createView() }, { binding: 1, resource: targets.depth.createView() }] }));
    resolve.draw(3);
    resolve.end();
    return true;
  }

  private destroyResources(): void {
    if (!this.resources) return;
    this.resources.pieces.destroy(); this.resources.counts.destroy(); this.resources.offsets.destroy(); this.resources.sort.dispose();
    this.resources = null;
  }

  private destroyTargets(): void {
    this.targets?.color.destroy(); this.targets?.depth.destroy(); this.targets?.ranges.destroy();
    this.targets = null;
  }

  dispose(): void {
    this.destroyResources();
    this.destroyTargets();
    this.scan.dispose();
    this.pipelines = null;
    this.resolvePipeline = null;
    this.binLayout = this.tileLayout = this.resolveLayout = null;
    this.device = null;
  }
}
