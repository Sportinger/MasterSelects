import { CompositorPipeline } from '../../src/engine/pipeline/CompositorPipeline';
import type { Layer } from '../../src/engine/core/types';
import { compileImageOperatorGraph, createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';

export async function checkImageCompositeGpu(device: GPUDevice, sampler: GPUSampler, fixture: Uint8Array, size: number) {
  const sampled = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
  const source = device.createTexture({ size: [size, 1], format: 'rgba8unorm', usage: sampled });
  const base = device.createTexture({ size: [size, 1], format: 'rgba8unorm', usage: sampled });
  const mask = device.createTexture({ size: [size, 1], format: 'rgba8unorm', usage: sampled });
  const target = device.createTexture({ size: [size, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: size * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, fixture, { bytesPerRow: size * 4 }, [size, 1]);
  device.queue.writeTexture({ texture: mask }, new Uint8Array(size * 4).fill(255), { bytesPerRow: size * 4 }, [size, 1]);
  const compositor = new CompositorPipeline(device);
  await compositor.createPipelines();
  const layer = { id: 'image-graph-probe', opacity: 1, blendMode: 'normal', position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, maskInvert: false } as unknown as Layer;
  const bypass = createDefaultInvertImageGraph();
  bypass.nodes.filter(item => item.id.startsWith('invert-')).forEach(item => { item.bypassed = true; });
  const cases = [
    { name: 'legacy', program: undefined, invert: true },
    { name: 'graph', program: compileImageOperatorGraph(createDefaultInvertImageGraph()), invert: false },
    { name: 'bypass', program: compileImageOperatorGraph(bypass), invert: false },
    { name: 'plain', program: undefined, invert: false },
  ];
  const outputs = new Map<string, Uint8Array>();
  let renderPasses = 0;
  try {
    for (const item of cases) {
      const uniform = compositor.getOrCreateUniformBuffer(`probe-${item.name}`);
      compositor.updateLayerUniforms(layer, size, size, false, uniform, { brightness: 0, contrast: 1, saturation: 1, invert: item.invert, operatorProgram: item.program });
      const pipeline = compositor.getCompositePipeline(item.program);
      if (!pipeline) throw new Error(`Missing compositor pipeline for ${item.name}`);
      const bindGroup = compositor.createCompositeBindGroup(sampler, base.createView(), source.createView(), uniform, mask.createView());
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
      renderPasses++;
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: size * 4 }, [size, 1]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      outputs.set(item.name, new Uint8Array(readback.getMappedRange()).slice()); readback.unmap();
    }
    const equal = (left: Uint8Array, right: Uint8Array) => left.every((value, index) => value === right[index]);
    if (!equal(outputs.get('legacy')!, outputs.get('graph')!)) throw new Error('Compositor legacy/default graph pixel readback differs');
    if (!equal(outputs.get('bypass')!, outputs.get('plain')!)) throw new Error('Compositor bypass differs from non-inverted composite');
    if (equal(outputs.get('graph')!, outputs.get('bypass')!)) throw new Error('Compositor bypass did not change output');
    if (renderPasses !== cases.length) throw new Error(`Expected one pass per case, got ${renderPasses}/${cases.length}`);
    return renderPasses;
  } finally {
    compositor.destroy(); source.destroy(); base.destroy(); mask.destroy(); target.destroy(); readback.destroy();
  }
}
