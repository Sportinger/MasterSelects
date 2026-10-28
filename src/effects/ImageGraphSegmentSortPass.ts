import { SEGMENT_SORT_CHUNK, SEGMENT_SORT_MAX_ANGLE, type SegmentSortSettings } from '../services/operators/imageSegmentSortAxis';

/** Threads per line workgroup; each thread owns SEGMENT_SORT_CHUNK / 256 = 16 entries at most. */
const THREADS = 256;
const ENTRIES = SEGMENT_SORT_CHUNK / THREADS;

/**
 * One workgroup per (line, chunk): loads the chunk's keys and run starts, finds every entry's run start with a
 * max-scan, packs `runStart << 20 | level << 12 | index` (12 + 8 + 12 bits, so the sort is stable and never
 * crosses a run) into 16 KiB of workgroup memory, bitonic-sorts it, and writes each pixel the colour of the
 * source entry now at its place. Rules: src/services/operators/imageSegmentSortAxis.ts.
 */
export const SEGMENT_SORT_WGSL = /* wgsl */ `
struct SortParams { axis: u32, descending: u32, along: u32, across: u32, size: u32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<uniform> params: SortParams;
@group(0) @binding(1) var controlTex: texture_2d<f32>;
@group(0) @binding(2) var colorTex: texture_2d<f32>;
@group(0) @binding(3) var outputTex: texture_storage_2d<rgba16float, write>;
var<workgroup> entries: array<u32, ${SEGMENT_SORT_CHUNK}>;

fn sortShift(position: u32, slope: f32) -> i32 { return i32(floor(f32(position) * slope + 0.5)); }
fn sortPixel(line: i32, position: u32, slope: f32) -> vec3i {
  let offset = line + sortShift(position, slope);
  let valid = select(0, 1, offset >= 0 && offset < i32(params.across));
  if (params.axis == 0u) { return vec3i(offset, i32(position), valid); }
  return vec3i(i32(position), offset, valid);
}

@compute @workgroup_size(${THREADS})
fn segmentSortMain(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) thread: u32) {
  if (thread == 0u) {
    let angle = textureLoad(controlTex, vec2i(0, 0), 0).z;
    let finite = angle == angle && abs(angle) < 1e30;
    entries[0] = bitcast<u32>(tan(radians(clamp(select(0.0, angle, finite), -${SEGMENT_SORT_MAX_ANGLE}.0, ${SEGMENT_SORT_MAX_ANGLE}.0))));
  }
  let slope = bitcast<f32>(workgroupUniformLoad(&entries[0]));
  workgroupBarrier();
  let last = sortShift(params.along - 1u, slope);
  let line = i32(wg.x) - max(0, last);
  if (line > i32(params.across) - 1 - min(0, last)) { return; }
  let chunk = wg.y * ${SEGMENT_SORT_CHUNK}u;
  if (chunk >= params.along) { return; }
  let size = params.size;
  var levels: array<u32, ${ENTRIES}>;
  var scan: array<u32, ${ENTRIES}>;
  for (var k = 0u; k < ${ENTRIES}u; k++) {
    let index = thread + k * ${THREADS}u;
    let position = chunk + index;
    var isStart = true;
    var level = 0u;
    if (index < size && position < params.along) {
      let here = sortPixel(line, position, slope);
      if (here.z == 1) {
        let control = textureLoad(controlTex, here.xy, 0);
        let key = select(0.0, clamp(control.x, 0.0, 1.0), control.x == control.x);
        level = u32(floor(key * 255.0 + 0.5));
        if (params.descending == 1u) { level = 255u - level; }
        let before = index > 0u && sortPixel(line, position - 1u, slope).z == 1;
        isStart = !before || control.y >= 0.5;
      }
    }
    levels[k] = level;
    if (index < size) { entries[index] = select(0u, index, isStart); }
  }
  workgroupBarrier();
  // Inclusive max-scan: every entry learns where its run starts.
  for (var offset = 1u; offset < size; offset = offset << 1u) {
    for (var k = 0u; k < ${ENTRIES}u; k++) {
      let index = thread + k * ${THREADS}u;
      if (index < size) { scan[k] = max(entries[index], select(0u, entries[select(0u, index - offset, index >= offset)], index >= offset)); }
    }
    workgroupBarrier();
    for (var k = 0u; k < ${ENTRIES}u; k++) {
      let index = thread + k * ${THREADS}u;
      if (index < size) { entries[index] = scan[k]; }
    }
    workgroupBarrier();
  }
  for (var k = 0u; k < ${ENTRIES}u; k++) {
    let index = thread + k * ${THREADS}u;
    if (index < size) { entries[index] = (entries[index] << 20u) | (levels[k] << 12u) | index; }
  }
  workgroupBarrier();
  for (var span = 2u; span <= size; span = span << 1u) {
    for (var stride = span >> 1u; stride > 0u; stride = stride >> 1u) {
      for (var k = 0u; k < ${ENTRIES}u; k++) {
        let index = thread + k * ${THREADS}u;
        let partner = index ^ stride;
        if (index < size && partner > index) {
          let a = entries[index];
          let b = entries[partner];
          if ((a > b) == ((index & span) == 0u)) { entries[index] = b; entries[partner] = a; }
        }
      }
      workgroupBarrier();
    }
  }
  for (var k = 0u; k < ${ENTRIES}u; k++) {
    let index = thread + k * ${THREADS}u;
    let position = chunk + index;
    if (index >= size || position >= params.along) { continue; }
    let destination = sortPixel(line, position, slope);
    if (destination.z == 0) { continue; }
    let origin = sortPixel(line, chunk + (entries[index] & 0xfffu), slope);
    textureStore(outputTex, destination.xy, textureLoad(colorTex, origin.xy, 0));
  }
}`;

/** Power-of-two entries per workgroup: the chunk length rounded up (at least the thread count). */
export function segmentSortEntries(along: number): number {
  let size = THREADS;
  while (size < Math.min(along, SEGMENT_SORT_CHUNK)) size <<= 1;
  return size;
}

/** Owns the Segment Sort compute pipeline of one device; per-encode state is only a small uniform buffer. */
export class ImageGraphSegmentSortPass {
  private readonly device: GPUDevice;
  private state?: { pipeline: GPUComputePipeline; layout: GPUBindGroupLayout };
  constructor(device: GPUDevice) { this.device = device; }

  encode(encoder: GPUCommandEncoder, settings: SegmentSortSettings, width: number, height: number,
    control: GPUTextureView, color: GPUTextureView, output: GPUTextureView): void {
    const { pipeline, layout } = this.pipeline();
    const columns = settings.axis === 'columns';
    const along = columns ? height : width, across = columns ? width : height;
    const uniforms = new Uint32Array([columns ? 0 : 1, settings.order === 'descending' ? 1 : 0, along, across, segmentSortEntries(along), 0, 0, 0]);
    const buffer = this.device.createBuffer({ label: 'image-graph-segment-sort-params', size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, uniforms);
    const bind = this.device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: control },
      { binding: 2, resource: color }, { binding: 3, resource: output }] });
    const pass = encoder.beginComputePass({ label: 'image-graph-segment-sort' });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind);
    // Enough line workgroups for any angle up to 45° (a slanted frame has at most across + along lines).
    pass.dispatchWorkgroups(across + along, Math.ceil(along / SEGMENT_SORT_CHUNK)); pass.end();
  }

  private pipeline() {
    if (this.state) return this.state;
    const layout = this.device.createBindGroupLayout({ label: 'image-graph-segment-sort', entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    ] });
    const module = this.device.createShaderModule({ label: 'image-graph-segment-sort', code: SEGMENT_SORT_WGSL });
    const pipeline = this.device.createComputePipeline({ label: 'image-graph-segment-sort', layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'segmentSortMain' } });
    this.state = { pipeline, layout };
    return this.state;
  }
}
