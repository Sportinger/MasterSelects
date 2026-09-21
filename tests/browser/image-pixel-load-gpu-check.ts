import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const width = 3, height = 2, bytesPerRow = 256;
const sourcePixels = new Uint8ClampedArray([
  11, 21, 31, 255, 52, 62, 72, 255, 93, 103, 113, 255,
  134, 144, 154, 255, 175, 185, 195, 255, 216, 226, 236, 255,
]);
const cases = [
  { name: 'fractional-truncate', pixel: [1.9, .8], expected: [52, 62, 72, 255] },
  { name: 'negative-clamp', pixel: [-2.4, 1.7], expected: [134, 144, 154, 255] },
  { name: 'oversize-clamp', pixel: [99.2, 99.8], expected: [216, 226, 236, 255] },
] as const;

function graph(pixel: readonly [number, number]): EffectOperatorGraph {
  return { version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [
    { id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
    { id: 'pixel-x', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: pixel[0] } },
    { id: 'pixel-y', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: pixel[1] } },
    { id: 'pixel', operator: 'vector.combine.vec2', operatorVersion: 1, bindings: {} },
    { id: 'load', operator: 'image.load-pixel-clamped', operatorVersion: 1, bindings: {} },
    { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
  ], edges: [
    { id: 'x-pixel', from: 'pixel-x', output: 'value', to: 'pixel', input: 'x' },
    { id: 'y-pixel', from: 'pixel-y', output: 'value', to: 'pixel', input: 'y' },
    { id: 'frame-load', from: 'frame', output: 'image', to: 'load', input: 'image' },
    { id: 'pixel-load', from: 'pixel', output: 'value', to: 'load', input: 'pixel' },
    { id: 'load-output', from: 'load', output: 'image', to: 'output', input: 'image' },
  ] };
}

export async function checkImagePixelLoadGpu(device: GPUDevice): Promise<number> {
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const sampler = device.createSampler({ minFilter: 'nearest', magFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const video = new VideoFrame(sourcePixels, { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: 0, alpha: 'keep' });
  device.queue.writeTexture({ texture: source }, sourcePixels, { bytesPerRow: width * 4 }, [width, height]);
  let comparisons = 0;
  const render = async (sourceKind: 'texture' | 'external', pixel: readonly [number, number]) => {
    const plan = compileImageOperatorGraph(graph(pixel), {}), entryPoint = `pixelLoad${sourceKind}Fragment`;
    const module = device.createShaderModule({ code: `${common}\n${imageGraphProgramShader(plan, entryPoint, sourceKind)}` });
    const info = await module.getCompilationInfo(), errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] } });
    const packed = packImageOperatorRuntimeUniforms(plan, 0, width, height);
    const uniform = packed ? device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }) : undefined;
    if (packed && uniform) device.queue.writeBuffer(uniform, 0, packed);
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler },
      { binding: 1, resource: sourceKind === 'texture' ? source.createView() : device.importExternalTexture({ source: video }) }];
    if (uniform) entries.push({ binding: 2, resource: { buffer: uniform } });
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [
      { view: target.createView(), loadOp: 'clear', storeOp: 'store' },
    ] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]); device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ); const mapped = new Uint8Array(readback.getMappedRange());
    const pixels: number[][] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.push(Array.from(mapped.slice(y * bytesPerRow + x * 4, y * bytesPerRow + x * 4 + 4)));
    readback.unmap(); uniform?.destroy(); return pixels;
  };
  try {
    for (const item of cases) for (const sourceKind of ['texture', 'external'] as const) {
      const actual = await render(sourceKind, item.pixel);
      if (actual.some(pixel => pixel.some((value, channel) => value !== item.expected[channel]))) {
        throw new Error(`${sourceKind} ${item.name}: actual=${JSON.stringify(actual)} expected=${item.expected}`);
      }
      comparisons++;
    }
    const original = await render('texture', cases[0].pixel), rewritten = await render('texture', [2.1, .2]);
    if (original.every((pixel, index) => pixel.every((value, channel) => value === rewritten[index][channel]))) {
      throw new Error('Rewriting the pixel-coordinate graph did not change the loaded pixel.');
    }
    comparisons++;
    return comparisons;
  } finally { video.close(); source.destroy(); target.destroy(); readback.destroy(); }
}
