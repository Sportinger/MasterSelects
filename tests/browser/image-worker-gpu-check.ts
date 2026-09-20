import { VIDEO_FRAME_LAYER_COMPOSITE_SHADER, specializeVideoFrameLayerCompositeShader } from '../../src/services/render/workerGpuVideoFrameLayerShaderSource';
import { compileImageOperatorGraph, createDefaultInvertImageGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { workerVideoFrameNeedsStraightAlphaUpload } from '../../src/services/render/workerGpuOperatorPipeline';

const bitmapShader = (source: string) => source.replace('@group(0) @binding(2) var frameTexture: texture_external;', '@group(0) @binding(2) var frameTexture: texture_2d<f32>;')
  .replaceAll('textureSampleBaseClampToEdge(frameTexture, frameSampler,', 'textureSample(frameTexture, frameSampler,');

export async function checkWorkerImageGraphGpu(device: GPUDevice): Promise<string> {
  const graph = createDefaultInvertImageGraph(); graph.nodes.find(node => node.id === 'one')!.constants = { value: 0.75 };
  const plan = compileImageOperatorGraph(graph), requested = [0.2, 0.4, 0.6, 0.5];
  const data = new Uint8ClampedArray(requested.map(value => Math.round(value * 255))), input = [...data].map(value => value / 255) as [number, number, number, number];
  const operated = evaluateImageOperatorPlan(plan, input), expected = operated.map((value, index) => index < 3 ? value * operated[3] : value), imageData = new ImageData(data, 1, 1);
  const bitmap = await createImageBitmap(imageData, { premultiplyAlpha: 'none' });
  // Explicit straight-alpha source bytes isolate upload behavior from bitmap
  // backing storage. Test source sampling separately before testing graph math.
  const video = new VideoFrame(data, { format: 'RGBA', codedWidth: 1, codedHeight: 1, timestamp: 0, alpha: 'keep' });
  const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
  const base = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
  const target = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const uniform = device.createBuffer({ size: 272, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const values = new ArrayBuffer(272), view = new DataView(values);
  view.setFloat32(0, 1, true); view.setFloat32(12, 1, true); view.setFloat32(16, 1, true); view.setFloat32(60, 1, true);
  view.setFloat32(76, -1, true); view.setFloat32(88, 0.5, true); view.setFloat32(92, 0.5, true); view.setFloat32(96, 1, true);
  view.setFloat32(220, 1, true); view.setFloat32(224, 1, true); view.setFloat32(232, 1, true); view.setFloat32(248, 1, true); view.setFloat32(252, 1, true);
  device.queue.writeBuffer(uniform, 0, values);
  const run = async (kind: 'video' | 'bitmap', inspectSource = false): Promise<number[]> => {
    device.pushErrorScope('validation');
    const upload = kind === 'bitmap' || workerVideoFrameNeedsStraightAlphaUpload(video);
    const source = upload ? bitmapShader(VIDEO_FRAME_LAYER_COMPOSITE_SHADER) : VIDEO_FRAME_LAYER_COMPOSITE_SHADER;
    const code = inspectSource ? source.replace('return vec4f(mix(baseColor.rgb, blended, alpha), outAlpha);', 'return sampleExternalFrame(input.uv) + baseColor * 0.0 + vec4f(layer.opacity * 0.0);') : specializeVideoFrameLayerCompositeShader(source, plan.wgsl);
    const module = device.createShaderModule({ code });
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' }, fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] } });
    let resource: GPUBindingResource; let texture: GPUTexture | undefined;
    if (!upload) resource = device.importExternalTexture({ source: video });
    else { texture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }); device.queue.copyExternalImageToTexture({ source: kind === 'video' ? video : bitmap }, { texture, premultipliedAlpha: false }, [1, 1]); resource = texture.createView(); }
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: base.createView() }, { binding: 2, resource }, { binding: 3, resource: { buffer: uniform } }] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end(); encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 256 }, [1, 1]); device.queue.submit([encoder.finish()]);
    const validationError = await device.popErrorScope();
    if (validationError) throw new Error(`${kind} worker GPU validation: ${validationError.message}`);
    await readback.mapAsync(GPUMapMode.READ); const actual = [...new Uint8Array(readback.getMappedRange()).slice(0, 4)].map(value => value / 255); readback.unmap(); texture?.destroy();
    return actual;
  };
  try {
    for (const kind of ['video', 'bitmap'] as const) {
      const sampled = await run(kind, true);
      if (sampled.some((value, index) => Math.abs(value - input[index]) > 1 / 255)) {
        throw new Error(`${kind} worker source is not straight alpha: sampled=${sampled}; input=${input}`);
      }
      const actual = await run(kind);
      if (actual.some((value, index) => Math.abs(value - expected[index]) > 2 / 255)) {
        throw new Error(`${kind} worker: actual=${actual}; expected=${expected}; sampled source=${sampled}; input=${input}`);
      }
    }
    return 'worker VideoFrame + ImageBitmap edited-constant readback';
  }
  finally { video.close(); bitmap.close(); base.destroy(); target.destroy(); readback.destroy(); uniform.destroy(); }
}
