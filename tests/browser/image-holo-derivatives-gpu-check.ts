import common from '../../src/effects/_shared/commonShader';
import { holo } from '../../src/effects/analog';

const width = 17;
const height = 13;
const bytesPerRow = 256;

type DerivativeVariant = 'auto' | 'fine' | 'coarse';

function sourcePixels(): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  const cells = [
    [42, 55, 61, 29], [69, 47, 76, 223],
    [51, 72, 43, 151], [78, 58, 66, 251],
  ];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = cells[(y & 1) * 2 + (x & 1)];
    pixels.set(cell, (y * width + x) * 4);
  }
  return pixels;
}

function shaderFor(variant: DerivativeVariant): string {
  if (variant === 'auto') return holo.shader;
  const suffix = variant === 'fine' ? 'Fine' : 'Coarse';
  return holo.shader
    .replaceAll('dpdx(', `dpdx${suffix}(`)
    .replaceAll('dpdy(', `dpdy${suffix}(`);
}

function uniforms(): Float32Array {
  return new Float32Array([
    width, height, 11, .61,
    0, 1.375, .61, 0,
    .08, .22, .29, 1,
    .31, .12, .25, 1,
  ]);
}

async function render(
  device: GPUDevice,
  sampler: GPUSampler,
  source: GPUTextureView,
  target: GPUTexture,
  readback: GPUBuffer,
  variant: DerivativeVariant,
): Promise<Uint8Array> {
  device.pushErrorScope('validation');
  let popped = false;
  const pop = async () => { popped = true; return device.popErrorScope(); };
  const uniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(uniform, 0, uniforms());
    const module = device.createShaderModule({ code: `${common}\n${shaderFor(variant)}` });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(`${variant}: ${errors.map(message => message.message).join('\n')}`);
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: holo.entryPoint, targets: [{ format: 'rgba8unorm' }] },
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: source },
        { binding: 2, resource: { buffer: uniform } },
      ],
    }));
    pass.draw(6);
    pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(readback.getMappedRange());
    const compact = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      compact.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
    }
    readback.unmap();
    const validation = await pop();
    if (validation) throw new Error(`${variant}: ${validation.message}`);
    return compact;
  } catch (error) {
    const validation = popped ? null : await pop();
    if (validation) throw new Error(`${variant}: ${validation.message}`, { cause: error });
    throw error;
  } finally {
    uniform.destroy();
  }
}

function comparison(label: string, expected: Uint8Array, actual: Uint8Array): string {
  let mismatches = 0;
  for (let index = 0; index < expected.length; index++) {
    if (expected[index] !== actual[index]) mismatches++;
  }
  return mismatches === 0
    ? `${label}: exact byte-equal (${expected.length}/${expected.length})`
    : `${label}: ${mismatches}/${expected.length} byte mismatches`;
}

export async function checkHoloDerivativesGpu(device: GPUDevice): Promise<string> {
  const pixels = sourcePixels();
  const source = device.createTexture({
    size: [width, height], format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const target = device.createTexture({
    size: [width, height], format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const sampler = device.createSampler({ minFilter: 'nearest', magFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: width * 4 }, [width, height]);
  try {
    const auto = await render(device, sampler, source.createView(), target, readback, 'auto');
    const fine = await render(device, sampler, source.createView(), target, readback, 'fine');
    const coarse = await render(device, sampler, source.createView(), target, readback, 'coarse');
    return `${comparison('auto vs fine', auto, fine)}; ${comparison('auto vs coarse', auto, coarse)}`;
  } finally {
    source.destroy();
    target.destroy();
    readback.destroy();
  }
}
