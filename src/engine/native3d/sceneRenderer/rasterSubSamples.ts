import type { SceneCamera } from '../../scene/types';
import type { NativeSceneExportFrame } from './renderOptions';
import { reportNativeSceneExportProgress, type NativeSceneExportProgress } from './sceneExportProgress';

/**
 * Raster export sub-samples (plan 3.6, Render Quality "Raster"): an export frame renders the raster
 * scene N times, each with a Halton subpixel offset of the projection and, with an open shutter, at
 * its own time inside the shutter interval (the exporter supplies the layers of that time). The HDR
 * scene color of every render is summed in a float buffer; the last render writes the average back
 * into the scene target before tone mapping. Progress goes the same way as the path tracer's, so one
 * exporter loop drives both.
 */
const ACCUMULATE = /* wgsl */`
struct Params { width: u32, height: u32, first: u32, last: u32, inverseCount: f32, pad0: f32, pad1: f32, pad2: f32 };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var sceneColor: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> sums: array<vec4f>;
@group(0) @binding(3) var averaged: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn accumulate(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) { return; }
  let index = id.y * params.width + id.x;
  let value = textureLoad(sceneColor, id.xy, 0);
  let sum = select(sums[index], vec4f(0.0), params.first == 1u) + value;
  sums[index] = sum;
  if (params.last == 1u) { textureStore(averaged, id.xy, sum * params.inverseCount); }
}`;

const READ_ONLY_ACCUMULATE = ACCUMULATE.replace('fn accumulate', 'fn accumulateRead');

function halton(index: number, base: number): number {
  let f = 1, r = 0;
  for (let i = index; i > 0; i = Math.floor(i / base)) { f /= base; r += f * (i % base); }
  return r;
}

interface Accumulation { buffer: GPUBuffer; width: number; height: number; frameIndex: number; count: number }

export interface RasterSubSample {
  index: number;
  count: number;
  camera: SceneCamera;
}

export class RasterSubSampleAccumulator {
  private readonly accumulations = new Map<string, Accumulation>();
  private pipeline: GPUComputePipeline | null = null;
  private copyPipeline: GPUComputePipeline | null = null;
  private device: GPUDevice | null = null;
  private pending: Omit<NativeSceneExportProgress, 'gpuDone'> | null = null;

  /** The sub-sample this render is (and its jittered camera), or null when the frame is not sub-sampled. */
  begin(targetKey: string, exportFrame: NativeSceneExportFrame | undefined, camera: SceneCamera): RasterSubSample | null {
    const count = exportFrame ? Math.max(1, Math.round(exportFrame.quality.rasterSubSamples)) : 1;
    if (!exportFrame || count <= 1) return null;
    const current = this.accumulations.get(targetKey);
    const index = current && current.frameIndex === exportFrame.frameIndex ? current.count : 0;
    if (index >= count) return null;
    // Subpixel offset in [-0.5, 0.5) pixels, as a clip-space shift of the projection.
    const jx = halton(index + 1, 2) - 0.5, jy = halton(index + 1, 3) - 0.5;
    const projectionMatrix = Float32Array.from(camera.projectionMatrix);
    projectionMatrix[8] += 2 * jx / camera.viewport.width;
    projectionMatrix[9] += 2 * jy / camera.viewport.height;
    return { index, count, camera: { ...camera, projectionMatrix } };
  }

  /** After the scene passes of sub-sample `sample`: add the scene color; the last one writes the average. */
  accumulate(device: GPUDevice, encoder: GPUCommandEncoder, targetKey: string, sceneTexture: GPUTexture, exportFrame: NativeSceneExportFrame,
    sample: RasterSubSample, temporaries: GPUBuffer[]): void {
    if (this.device !== device) { this.dispose(); this.device = device; }
    const width = sceneTexture.width, height = sceneTexture.height;
    let accumulation = this.accumulations.get(targetKey);
    if (!accumulation || accumulation.width !== width || accumulation.height !== height) {
      accumulation?.buffer.destroy();
      accumulation = { buffer: device.createBuffer({ label: `raster-subsamples-${targetKey}`, size: width * height * 16, usage: GPUBufferUsage.STORAGE }),
        width, height, frameIndex: -1, count: 0 };
      this.accumulations.set(targetKey, accumulation);
    }
    if (accumulation.frameIndex !== exportFrame.frameIndex) { accumulation.frameIndex = exportFrame.frameIndex; accumulation.count = 0; }
    const last = sample.index === sample.count - 1;
    // The average replaces the scene color: read it from a copy, so the texture is not read and written in one pass.
    const source = last ? device.createTexture({ size: [width, height], format: sceneTexture.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }) : null;
    if (source) encoder.copyTextureToTexture({ texture: sceneTexture }, { texture: source }, [width, height]);
    const params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    temporaries.push(params);
    const data = new ArrayBuffer(32);
    new Uint32Array(data).set([width, height, sample.index === 0 ? 1 : 0, last ? 1 : 0]);
    new Float32Array(data)[4] = 1 / sample.count;
    device.queue.writeBuffer(params, 0, data);
    const pipeline = this.pipelineFor(device, last);
    const pass = encoder.beginComputePass({ label: 'raster-subsamples' });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: params } }, { binding: 1, resource: (source ?? sceneTexture).createView() },
      { binding: 2, resource: { buffer: accumulation.buffer } },
      ...(last ? [{ binding: 3, resource: sceneTexture.createView() }] : [])] }));
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    if (source) void device.queue.onSubmittedWorkDone().then(() => source.destroy());
    accumulation.count = sample.index + 1;
    const shutter = Math.min(1, Math.max(0, (sample.camera.lens?.shutterAngle ?? 0) / 360));
    this.pending = { frameIndex: exportFrame.frameIndex, samples: accumulation.count, targetSamples: sample.count, denoising: false,
      complete: last, timeOffset: last ? 0 : accumulation.count / sample.count * shutter * exportFrame.frameDuration };
  }

  /** After the frame's submission: report this render to the exporter. */
  afterSubmit(device: GPUDevice): void {
    if (!this.pending) return;
    reportNativeSceneExportProgress({ ...this.pending, gpuDone: device.queue.onSubmittedWorkDone() });
    this.pending = null;
  }

  private pipelineFor(device: GPUDevice, last: boolean): GPUComputePipeline {
    // Two entry points: intermediate sub-samples bind no output texture (the auto layout drops it).
    if (last) {
      this.pipeline ??= device.createComputePipeline({ label: 'raster-subsamples-average', layout: 'auto',
        compute: { module: device.createShaderModule({ code: ACCUMULATE }), entryPoint: 'accumulate' } });
      return this.pipeline;
    }
    this.copyPipeline ??= device.createComputePipeline({ label: 'raster-subsamples-sum', layout: 'auto',
      compute: { module: device.createShaderModule({ code: READ_ONLY_ACCUMULATE.replace('if (params.last == 1u) { textureStore(averaged, id.xy, sum * params.inverseCount); }', '') }),
        entryPoint: 'accumulateRead' } });
    return this.copyPipeline;
  }

  releaseTarget(key: string): void {
    this.accumulations.get(key)?.buffer.destroy();
    this.accumulations.delete(key);
  }

  dispose(): void {
    for (const key of [...this.accumulations.keys()]) this.releaseTarget(key);
    this.pipeline = null;
    this.copyPipeline = null;
    this.device = null;
  }
}
