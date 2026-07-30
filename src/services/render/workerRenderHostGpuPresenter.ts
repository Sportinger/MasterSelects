import type { RenderGraphId, WorkerRenderStatusEvent } from '../../engine/render/contracts/workerRenderGraph';
import type {
  WorkerRenderSoftwareFrame,
  WorkerRenderSoftwareLayer,
} from './workerRenderHostRuntimeCommands';
import { closeWorkerSoftwareFrameBitmaps, forEachWorkerSoftwareLayerInPaintOrder } from './workerRenderHostSoftwarePainter';
import { calculateSourcePixelScale } from '../../utils/sourcePixelScale';

type WorkerGpuGlobal = typeof globalThis & {
  navigator?: Navigator & {
    gpu?: {
      getPreferredCanvasFormat?: () => GPUTextureFormat;
      requestAdapter?: () => Promise<GPUAdapter | null>;
    };
  };
};

export interface WorkerRenderHostGpuTargetSurface {
  readonly kind: 'webgpu';
  readonly canvas: OffscreenCanvas;
  readonly context: GPUCanvasContext;
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly pipeline: GPURenderPipeline;
  readonly sampler: GPUSampler;
  readonly presentation: 'offscreen-canvas' | 'software';
  frameSequence: number;
}

const SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) opacity: f32,
};

@vertex
fn vertexMain(
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
  @location(2) opacity: f32,
) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(position, 0.0, 1.0);
  out.uv = uv;
  out.opacity = opacity;
  return out;
}

@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var frameTexture: texture_2d<f32>;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(frameTexture, frameSampler, input.uv);
  return vec4f(color.rgb, color.a * input.opacity);
}
`;

let sharedDevicePromise: Promise<GPUDevice | null> | null = null;

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  const finite = finiteNumber(value, fallback);
  return finite > 0 ? finite : fallback;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseSolidColor(color: string): Uint8Array {
  const normalized = color.trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : '';
  if (hex.length === 6 || hex.length === 8) {
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255;
    if ([red, green, blue, alpha].every(Number.isFinite)) {
      return new Uint8Array([red, green, blue, alpha]);
    }
  }
  return new Uint8Array([0, 0, 0, 255]);
}

async function requestSharedWorkerGpuDevice(): Promise<GPUDevice | null> {
  if (sharedDevicePromise) return sharedDevicePromise;
  sharedDevicePromise = (async () => {
    const gpu = (globalThis as WorkerGpuGlobal).navigator?.gpu;
    const adapter = typeof gpu?.requestAdapter === 'function'
      ? await gpu.requestAdapter()
      : null;
    const device = await adapter?.requestDevice();
    return device ?? null;
  })().catch(() => null);
  return sharedDevicePromise;
}

function preferredCanvasFormat(): GPUTextureFormat {
  const gpu = (globalThis as WorkerGpuGlobal).navigator?.gpu;
  return typeof gpu?.getPreferredCanvasFormat === 'function'
    ? gpu.getPreferredCanvasFormat()
    : 'bgra8unorm';
}

function createPipeline(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({ code: SHADER }),
      entryPoint: 'vertexMain',
      buffers: [{
        arrayStride: 5 * Float32Array.BYTES_PER_ELEMENT,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' },
          { shaderLocation: 1, offset: 2 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x2' },
          { shaderLocation: 2, offset: 4 * Float32Array.BYTES_PER_ELEMENT, format: 'float32' },
        ],
      }],
    },
    fragment: {
      module: device.createShaderModule({ code: SHADER }),
      entryPoint: 'fragmentMain',
      targets: [{
        format,
        blend: {
          color: {
            srcFactor: 'src-alpha',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
          },
          alpha: {
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
          },
        },
      }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });
}

export async function createWorkerRenderHostGpuTargetSurface(
  canvas: OffscreenCanvas,
  presentation: 'offscreen-canvas' | 'software',
): Promise<WorkerRenderHostGpuTargetSurface | null> {
  const context = canvas.getContext('webgpu');
  if (!context) return null;
  const device = await requestSharedWorkerGpuDevice();
  if (!device) return null;
  const format = preferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });
  return {
    kind: 'webgpu',
    canvas,
    context,
    device,
    format,
    pipeline: createPipeline(device, format),
    sampler: device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    }),
    presentation,
    frameSequence: 0,
  };
}

function layerFootprint(input: {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly layer: WorkerRenderSoftwareLayer;
}): {
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
  readonly height: number;
  readonly scaleX: number;
  readonly scaleY: number;
} {
  const sourceWidth = positiveNumber(input.sourceWidth, input.targetWidth);
  const sourceHeight = positiveNumber(input.sourceHeight, input.targetHeight);
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = input.targetWidth / input.targetHeight;
  const aspectRatio = sourceAspect / targetAspect;
  const sourcePixelScale = calculateSourcePixelScale(
    sourceWidth,
    sourceHeight,
    input.targetWidth,
    input.targetHeight,
  );
  const scaleX = finiteNumber(input.layer.geometry.scale.x, 1) * sourcePixelScale;
  const scaleY = finiteNumber(input.layer.geometry.scale.y, 1) * sourcePixelScale;
  let localPositionX = finiteNumber(input.layer.geometry.position.x, 0);
  let localPositionY = finiteNumber(input.layer.geometry.position.y, 0);
  let width = input.targetWidth;
  let height = input.targetHeight;

  if (aspectRatio > 1) {
    height = input.targetWidth / sourceAspect;
    localPositionY /= aspectRatio;
  } else {
    width = input.targetHeight * sourceAspect;
    localPositionX *= aspectRatio;
  }

  return {
    centerX: (0.5 + localPositionX * scaleX) * input.targetWidth,
    centerY: (0.5 + localPositionY * scaleY) * input.targetHeight,
    width,
    height,
    scaleX,
    scaleY,
  };
}

function pixelToNdc(x: number, y: number, width: number, height: number): readonly [number, number] {
  return [
    (x / width) * 2 - 1,
    1 - (y / height) * 2,
  ];
}

function layerVertices(
  layer: WorkerRenderSoftwareLayer,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Float32Array {
  const footprint = layerFootprint({
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    layer,
  });
  const rotation = -finiteNumber(layer.geometry.rotation, 0);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const halfWidth = footprint.width / 2;
  const halfHeight = footprint.height / 2;
  const opacity = Math.max(0, Math.min(1, finiteNumber(layer.opacity, 1)));
  const rect = layer.geometry.sourceRect;
  const u0 = clampUnit(rect.x);
  const v0 = clampUnit(rect.y);
  const u1 = clampUnit(rect.x + rect.width);
  const v1 = clampUnit(rect.y + rect.height);
  const corners = [
    { x: -halfWidth, y: -halfHeight, u: u0, v: v0 },
    { x: halfWidth, y: -halfHeight, u: u1, v: v0 },
    { x: halfWidth, y: halfHeight, u: u1, v: v1 },
    { x: -halfWidth, y: halfHeight, u: u0, v: v1 },
  ].map((corner) => {
    const sx = corner.x * footprint.scaleX;
    const sy = corner.y * footprint.scaleY;
    const x = footprint.centerX + sx * cos - sy * sin;
    const y = footprint.centerY + sx * sin + sy * cos;
    const [ndcX, ndcY] = pixelToNdc(x, y, targetWidth, targetHeight);
    return { x: ndcX, y: ndcY, u: corner.u, v: corner.v };
  });
  const order = [0, 1, 2, 0, 2, 3];
  const vertices = new Float32Array(order.length * 5);
  order.forEach((cornerIndex, index) => {
    const corner = corners[cornerIndex];
    const offset = index * 5;
    vertices[offset] = corner.x;
    vertices[offset + 1] = corner.y;
    vertices[offset + 2] = corner.u;
    vertices[offset + 3] = corner.v;
    vertices[offset + 4] = opacity;
  });
  return vertices;
}

function createLayerTexture(
  surface: WorkerRenderHostGpuTargetSurface,
  layer: WorkerRenderSoftwareLayer,
): { readonly texture: GPUTexture; readonly width: number; readonly height: number } | null {
  if (layer.source.kind === 'bitmap') {
    const width = Math.max(1, layer.source.width);
    const height = Math.max(1, layer.source.height);
    const texture = surface.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    surface.device.queue.copyExternalImageToTexture(
      { source: layer.source.bitmap },
      { texture },
      { width, height },
    );
    return { texture, width, height };
  }
  if (layer.source.kind === 'solid') {
    const texture = surface.device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const color = parseSolidColor(layer.source.color);
    surface.device.queue.writeTexture(
      { texture },
      color.buffer as ArrayBuffer,
      { bytesPerRow: 4, rowsPerImage: 1 },
      { width: 1, height: 1 },
    );
    return { texture, width: 1, height: 1 };
  }
  return null;
}

function drawLayer(
  surface: WorkerRenderHostGpuTargetSurface,
  pass: GPURenderPassEncoder,
  layer: WorkerRenderSoftwareLayer,
  targetWidth: number,
  targetHeight: number,
  transientResources: Array<{ destroy(): void }>,
): void {
  if (layer.compositeOperation !== 'source-over' || layer.filter !== 'none' || layer.transition) {
    return;
  }
  const layerTexture = createLayerTexture(surface, layer);
  if (!layerTexture) return;
  transientResources.push(layerTexture.texture);
  const vertices = layerVertices(layer, layerTexture.width, layerTexture.height, targetWidth, targetHeight);
  const vertexBuffer = surface.device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  transientResources.push(vertexBuffer);
  surface.device.queue.writeBuffer(
    vertexBuffer,
    0,
    vertices.buffer as ArrayBuffer,
    vertices.byteOffset,
    vertices.byteLength,
  );
  const bindGroup = surface.device.createBindGroup({
    layout: surface.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: surface.sampler },
      { binding: 1, resource: layerTexture.texture.createView() },
    ],
  });
  pass.setPipeline(surface.pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.draw(6);
}

export function paintWorkerGpuSoftwareFrame(
  surface: WorkerRenderHostGpuTargetSurface,
  targetId: RenderGraphId,
  requestId: string,
  timelineTime: number,
  frame: WorkerRenderSoftwareFrame,
): {
  readonly frameId: string;
  readonly events: readonly WorkerRenderStatusEvent[];
  readonly presentation: WorkerRenderHostGpuTargetSurface['presentation'];
} | null {
  const width = Math.max(1, surface.canvas.width || frame.size.x);
  const height = Math.max(1, surface.canvas.height || frame.size.y);
  surface.frameSequence += 1;
  const frameId = `${targetId}:${requestId}:gpu:${surface.frameSequence}`;
  const transientResources: Array<{ destroy(): void }> = [];
  const commandEncoder = surface.device.createCommandEncoder();
  const pass = commandEncoder.beginRenderPass({
    colorAttachments: [{
      view: surface.context.getCurrentTexture().createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  let submitted = false;

  try {
    forEachWorkerSoftwareLayerInPaintOrder(frame, (layer) => {
      drawLayer(surface, pass, layer, width, height, transientResources);
    });
    pass.end();
    surface.device.queue.submit([commandEncoder.finish()]);
    submitted = true;
  } catch {
    try {
      pass.end();
    } catch {
      // Ignore pass cleanup errors after a failed GPU command.
    }
    closeWorkerSoftwareFrameBitmaps(frame);
    for (const resource of transientResources) {
      try {
        resource.destroy();
      } catch {
        // Ignore transient GPU cleanup errors.
      }
    }
    return null;
  } finally {
    if (submitted) {
      void surface.device.queue.onSubmittedWorkDone().finally(() => {
        closeWorkerSoftwareFrameBitmaps(frame);
        for (const resource of transientResources) {
          try {
            resource.destroy();
          } catch {
            // Ignore transient GPU cleanup errors.
          }
        }
      });
    }
  }

  return {
    frameId,
    presentation: surface.presentation,
    events: [{
      type: 'frame-presented',
      requestId,
      targetId,
      timelineTime,
    }],
  };
}
