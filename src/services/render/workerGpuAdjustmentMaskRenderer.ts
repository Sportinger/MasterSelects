import type { MotionAdjustmentMixContract } from '../motionDesign/adjustment/contracts';
import {
  assertMotionAdjustmentWorkerGpuExecutionPlan,
  type MotionAdjustmentWorkerGpuExecutionPlan,
} from '../motionDesign/adjustment/workerGpuAdjustmentPlan';

const MASK_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

struct MaskMeta {
  pointOffset: u32,
  pointCount: u32,
  mode: u32,
  inverted: u32,
  opacity: f32,
  feather: f32,
  _pad0: f32,
  _pad1: f32,
};

struct Params {
  maskCount: u32,
  width: f32,
  height: f32,
  _pad: f32,
};

@group(0) @binding(0) var<storage, read> metas: array<MaskMeta>;
@group(0) @binding(1) var<storage, read> points: array<vec2f>;
@group(0) @binding(2) var<uniform> params: Params;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
  );
  var out: VertexOutput;
  out.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}

fn segmentDistance(point: vec2f, start: vec2f, end: vec2f) -> f32 {
  let segment = end - start;
  let denominator = max(dot(segment, segment), 0.000001);
  let t = clamp(dot(point - start, segment) / denominator, 0.0, 1.0);
  return distance(point, start + segment * t);
}

fn maskCoverage(meta: MaskMeta, uv: vec2f) -> f32 {
  if (meta.pointCount < 3u) { return 0.0; }
  let pixel = vec2f(uv.x * params.width, uv.y * params.height);
  var inside = false;
  var minimumDistance = 1e20;
  var previousIndex = meta.pointOffset + meta.pointCount - 1u;
  for (var localIndex = 0u; localIndex < meta.pointCount; localIndex += 1u) {
    let currentIndex = meta.pointOffset + localIndex;
    let current = points[currentIndex] * vec2f(params.width, params.height);
    let previous = points[previousIndex] * vec2f(params.width, params.height);
    minimumDistance = min(minimumDistance, segmentDistance(pixel, previous, current));
    let crosses = ((current.y > pixel.y) != (previous.y > pixel.y)) &&
      (pixel.x < (previous.x - current.x) * (pixel.y - current.y) /
        max(abs(previous.y - current.y), 0.000001) * sign(previous.y - current.y) + current.x);
    if (crosses) { inside = !inside; }
    previousIndex = currentIndex;
  }
  var coverage = select(0.0, 1.0, inside);
  if (meta.feather > 0.0) {
    let signedDistance = select(-minimumDistance, minimumDistance, inside);
    coverage = smoothstep(-meta.feather, meta.feather, signedDistance);
  }
  if (meta.inverted != 0u) { coverage = 1.0 - coverage; }
  return clamp(coverage * meta.opacity, 0.0, 1.0);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  var accumulated = 0.0;
  for (var index = 0u; index < params.maskCount; index += 1u) {
    let meta = metas[index];
    let coverage = maskCoverage(meta, input.uv);
    if (index == 0u) {
      accumulated = select(coverage, 1.0 - coverage, meta.mode == 1u);
    } else if (meta.mode == 0u) {
      accumulated = coverage + accumulated * (1.0 - coverage);
    } else if (meta.mode == 1u) {
      accumulated = accumulated * (1.0 - coverage);
    } else {
      accumulated = accumulated * coverage;
    }
  }
  let value = clamp(accumulated, 0.0, 1.0);
  return vec4f(value, value, value, value);
}
`;

interface MaskPipelineResources {
  readonly pipeline: GPURenderPipeline;
  readonly bindGroupLayout: GPUBindGroupLayout;
}

export interface WorkerGpuAdjustmentMaskBinding {
  readonly layerId: string;
  readonly maskLookupId: string;
  readonly view: GPUTextureView;
}

export interface WorkerGpuAdjustmentMaskEncoding {
  readonly bindings: readonly WorkerGpuAdjustmentMaskBinding[];
  readonly transientResources: ReadonlyArray<{ destroy(): void }>;
}

const resourcesByDevice = new WeakMap<GPUDevice, MaskPipelineResources>();

function getResources(device: GPUDevice): MaskPipelineResources {
  const existing = resourcesByDevice.get(device);
  if (existing) return existing;
  const module = device.createShaderModule({
    label: 'worker-gpu-adjustment-vector-mask',
    code: MASK_SHADER,
  });
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'worker-gpu-adjustment-vector-mask-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    label: 'worker-gpu-adjustment-vector-mask-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: { module, entryPoint: 'vertexMain' },
    fragment: {
      module,
      entryPoint: 'fragmentMain',
      targets: [{ format: 'rgba8unorm' }],
    },
    primitive: { topology: 'triangle-list' },
  });
  const created = { pipeline, bindGroupLayout };
  resourcesByDevice.set(device, created);
  return created;
}

function modeIndex(mode: MotionAdjustmentMixContract['masks'][number]['mode']): number {
  return mode === 'add' ? 0 : mode === 'subtract' ? 1 : 2;
}

export function packWorkerGpuAdjustmentMasks(mix: MotionAdjustmentMixContract): {
  readonly metadata: ArrayBuffer;
  readonly points: Float32Array;
} {
  const metadata = new ArrayBuffer(Math.max(1, mix.masks.length) * 32);
  const metadataView = new DataView(metadata);
  const points: number[] = [];
  mix.masks.forEach((mask, index) => {
    const offset = index * 32;
    metadataView.setUint32(offset, points.length / 2, true);
    metadataView.setUint32(offset + 4, mask.points.length, true);
    metadataView.setUint32(offset + 8, modeIndex(mask.mode), true);
    metadataView.setUint32(offset + 12, mask.inverted ? 1 : 0, true);
    metadataView.setFloat32(offset + 16, mask.opacity, true);
    metadataView.setFloat32(offset + 20, mask.feather, true);
    for (const point of mask.points) points.push(point.x, point.y);
  });
  return {
    metadata,
    points: new Float32Array(points.length > 0 ? points : [0, 0]),
  };
}

function mixesByLayer(plan: MotionAdjustmentWorkerGpuExecutionPlan) {
  return plan.renderPlan.operations.flatMap((operation) => (
    (operation.kind === 'composite-source' || operation.kind === 'mix-adjustment-result')
      && operation.mix.masks.length > 0
      ? [{ layerId: operation.layerId, mix: operation.mix }]
      : []
  ));
}

export function encodeWorkerGpuAdjustmentMasks(
  plan: MotionAdjustmentWorkerGpuExecutionPlan,
  device: GPUDevice,
  commandEncoder: GPUCommandEncoder,
  width: number,
  height: number,
): WorkerGpuAdjustmentMaskEncoding {
  assertMotionAdjustmentWorkerGpuExecutionPlan(plan);
  const resources = getResources(device);
  const bindings: WorkerGpuAdjustmentMaskBinding[] = [];
  const transientResources: Array<{ destroy(): void }> = [];
  try {
    for (const { layerId, mix } of mixesByLayer(plan)) {
      const packed = packWorkerGpuAdjustmentMasks(mix);
      const metadataBuffer = device.createBuffer({
        size: packed.metadata.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      transientResources.push(metadataBuffer);
      const pointsBuffer = device.createBuffer({
        size: packed.points.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      transientResources.push(pointsBuffer);
      const paramsBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      transientResources.push(paramsBuffer);
      const texture = device.createTexture({
        label: `worker-gpu-adjustment-mask:${layerId}`,
        size: { width, height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      transientResources.push(texture);
      device.queue.writeBuffer(metadataBuffer, 0, packed.metadata);
      device.queue.writeBuffer(
        pointsBuffer,
        0,
        packed.points.buffer,
        packed.points.byteOffset,
        packed.points.byteLength,
      );
      const params = new ArrayBuffer(16);
      const paramsView = new DataView(params);
      paramsView.setUint32(0, mix.masks.length, true);
      paramsView.setFloat32(4, width, true);
      paramsView.setFloat32(8, height, true);
      device.queue.writeBuffer(paramsBuffer, 0, params);
      const bindGroup = device.createBindGroup({
        layout: resources.bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: metadataBuffer } },
          { binding: 1, resource: { buffer: pointsBuffer } },
          { binding: 2, resource: { buffer: paramsBuffer } },
        ],
      });
      let pass: GPURenderPassEncoder | null = null;
      let passEnded = false;
      try {
        pass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: texture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });
        pass.setPipeline(resources.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(6);
        pass.end();
        passEnded = true;
      } finally {
        if (pass && !passEnded) {
          try {
            pass.end();
          } catch {
            // Preserve the original encoding error.
          }
        }
      }
      bindings.push({
        layerId,
        maskLookupId: workerGpuAdjustmentMaskLookupId(plan, layerId),
        view: texture.createView(),
      });
    }
    return { bindings, transientResources };
  } catch (error) {
    for (const resource of transientResources.reverse()) {
      try {
        resource.destroy();
      } catch {
        // Preserve the original allocation/encoding error.
      }
    }
    throw error;
  }
}

export function workerGpuAdjustmentMaskLookupId(
  plan: Pick<MotionAdjustmentWorkerGpuExecutionPlan, 'resourceNamespace'>,
  layerId: string,
): string {
  return JSON.stringify([plan.resourceNamespace, 'worker-gpu-mask', layerId]);
}
