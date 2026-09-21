import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../src/types/operatorGraph';

/** Raw half-float records deliberately contain values outside the color range. */
export async function checkImageSeedFieldGpu(device: GPUDevice): Promise<number> {
  const runtime = new ImageGraphPassRuntime(device);
  const source = device.createTexture({ size: [2, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const field = device.createTexture({ size: [2, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const output = device.createTexture({ size: [2, 1], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const sampler = device.createSampler();
  const records = new Uint16Array([0xbc00, 0x4000, 0x3c00, 0, 0x4200, 0x4400, 0x3c00, 0xbc00]);
  device.queue.writeTexture({ texture: field }, records, { bytesPerRow: 16 }, [2, 1]);
  device.queue.writeTexture({ texture: source }, new Uint8Array(8), { bytesPerRow: 8 }, [2, 1]);
  const node = (id: string, operator: string, value?: number): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings: {},
    ...(value === undefined ? {} : { constants: { value } }) });
  const edge = (from: string, port: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${to}-${input}`, from, output: port, to, input });
  try {
    for (const [x, expectedIndex] of [[.8, 0], [7.8, 1]] as const) {
      const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image', layout: {},
        nodes: [node('seed', 'geometry.voronoi-seeds'), node('x', 'values.number', x), node('y', 'values.number', -2.4),
          node('pixel', 'vector.combine.vec2'), node('read', 'field.read-nearest-seed'), node('image', 'convert.vec4-to-image'), node('output', 'image.output')],
        edges: [edge('seed', 'field', 'read', 'field'), edge('x', 'value', 'pixel', 'x'), edge('y', 'value', 'pixel', 'y'),
          edge('pixel', 'value', 'read', 'pixel'), edge('read', 'value', 'image', 'value'), edge('image', 'image', 'output', 'image')] };
      const plan = compileImageOperatorGraph(graph, {}, { fieldResources: [{ resourceId: 'seed-probe', producerNodeId: 'seed',
        outputPort: 'field', format: 'nearest-seed-rgba16float' }] });
      const encoder = device.createCommandEncoder();
      if (!runtime.encode({ encoder, sampler, source: { kind: 'texture', view: source.createView() }, width: 2, height: 1,
        timelineTimeSeconds: 0, plan, instanceId: 'seed-probe', outputView: output.createView(), outputFormat: 'rgba16float',
        externalResources: new Map([['seed-probe', { view: field.createView(), identity: 'fixed-records' }]]) })) throw new Error('Field plan was not encoded.');
      encoder.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow: 256 }, [2, 1]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const actual = new Uint16Array(readback.getMappedRange()).slice(0, 8); readback.unmap();
      if (actual.some((word, index) => word !== records[expectedIndex * 4 + index % 4])) {
        throw new Error(`Raw seed record changed: x=${x}; half-float words=${Array.from(actual)}`);
      }
    }
    return 2;
  } finally { runtime.dispose(); source.destroy(); field.destroy(); output.destroy(); readback.destroy(); }
}
