import { StrandPass } from '../../src/engine/native3d/passes/StrandPass';
import { lookAt, perspective } from '../../src/engine/scene/cameraUtils/projectionMatrices';
import { createDefaultWeaveGraph, geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { buildStrandsLayerSources } from '../../src/services/operators/geometry/strandsLayerSource';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import type { SceneCamera, SceneStrandLayer } from '../../src/engine/scene/types';
import type { Effect } from '../../src/types/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

/**
 * Visual check of the P7a looks with the production strand pass: the default weave while threads
 * are pulled in and finished (with and without Handmade), and the knot generators.
 */
const WIDTH = 512, HEIGHT = 288;
const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function camera(distance: number, tilt = 0): SceneCamera {
  const eye: [number, number, number] = [0, -distance * Math.sin(tilt), distance * Math.cos(tilt)];
  return { viewMatrix: lookAt(...eye, 0, 0, 0, 0, 1, 0), projectionMatrix: perspective(50 * Math.PI / 180, WIDTH / HEIGHT, 0.05, 100),
    cameraPosition: { x: eye[0], y: eye[1], z: eye[2] }, cameraTarget: { x: 0, y: 0, z: 0 }, cameraUp: { x: 0, y: 1, z: 0 },
    viewport: { width: WIDTH, height: HEIGHT }, projection: 'perspective', fov: 50, near: 0.05, far: 100 };
}

const knotGraph = (generator: string, constants: Record<string, unknown>): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'geometry',
  nodes: [
    { id: 'source', operator: generator, operatorVersion: 1, bindings: {}, constants: constants as never },
    { id: 'yarn', operator: 'geometry.yarn-profile', operatorVersion: 1, bindings: {}, constants: { plies: 3, fibers: 5, radius: 0.022 } },
    { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {}, constants: { width: 0.003, color: '#e2d6c2', antialiasing: 'coverage4x' } },
    { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
  ],
  edges: [{ id: 'a', from: 'source', output: 'curves', to: 'yarn', input: 'curves' }, { id: 'b', from: 'yarn', output: 'curves', to: 'render', input: 'curves' },
    { id: 'c', from: 'render', output: 'scene', to: 'output', input: 'scene' }] });

async function run() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const pass = new StrandPass();
  const color = device.createTexture({ size: [WIDTH, HEIGHT], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const depth = device.createTexture({ size: [WIDTH, HEIGHT], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const readback = device.createBuffer({ size: WIDTH * HEIGHT * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  async function draw(label: string, layer: SceneStrandLayer, view: SceneCamera) {
    const encoder = device.createCommandEncoder(), temporary: GPUBuffer[] = [];
    encoder.beginRenderPass({ colorAttachments: [{ view: color.createView(), clearValue: { r: 0.05, g: 0.05, b: 0.06, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } }).end();
    const shadows = pass.prepareShadows(device, encoder, pass.prepare(device, [layer], temporary), temporary);
    pass.render(device, encoder, color.createView(), depth.createView(), shadows, view, temporary);
    encoder.copyTextureToBuffer({ texture: color }, { buffer: readback, bytesPerRow: WIDTH * 4 }, [WIDTH, HEIGHT]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const pixels = Uint8ClampedArray.from(new Uint8Array(readback.getMappedRange()));
    readback.unmap();
    temporary.forEach(buffer => buffer.destroy());
    const figure = document.createElement('figure'), canvas = document.createElement('canvas'), caption = document.createElement('figcaption');
    canvas.width = WIDTH; canvas.height = HEIGHT; caption.textContent = label;
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, WIDTH, HEIGHT), 0, 0);
    figure.append(canvas, caption);
    document.querySelector('#frames')!.append(figure);
  }
  const strands = (id: string, program: SceneStrandLayer['strands']['program']): SceneStrandLayer => ({ kind: 'strands', layerId: id, clipId: id,
    opacity: 1, blendMode: 'normal', sourceWidth: WIDTH, sourceHeight: HEIGHT, worldMatrix: identity, strands: { clipId: id, effectId: id, program } });
  const weave = (time: number, irregularity: number) => {
    const effect: Effect = { id: 'fx', name: 'Weave', type: 'weave', enabled: true, params: { irregularity_value: irregularity }, operatorGraph: createDefaultWeaveGraph() };
    return buildStrandsLayerSources({ id: `weave-${time}-${irregularity}`, effects: [effect], startTime: 0, inPoint: 0, outPoint: 10, duration: 10 }, time, [])[0].source.strands.program;
  };
  try {
    await draw('Weave In 1.2 s', strands('w1', weave(1.2, 1)), camera(2.1, 0.5));
    await draw('Weave In 2.6 s', strands('w2', weave(2.6, 1)), camera(2.1, 0.5));
    await draw('Woven, Irregularity 1 (6 s)', strands('w3', weave(6, 1)), camera(1.25, 0.15));
    await draw('Woven, Irregularity 0 (6 s)', strands('w4', weave(6, 0)), camera(1.25, 0.15));
    for (const [shape, extra] of [['trefoil', {}], ['figure-eight', {}], ['reef', { size: 0.8 }], ['torus', { p: 3, q: 5 }]] as const) {
      const program = compileGeometryGraph(knotGraph('geometry.knot', { shape, ...extra }), geometryParameterReader({}));
      await draw(`Knot: ${shape}`, strands(`knot-${shape}`, program), camera(2.2, 0.45));
    }
    const plait = compileGeometryGraph(knotGraph('geometry.celtic-knot', { columns: 4, rows: 3, size: 0.32, height: 0.03 }), geometryParameterReader({}));
    await draw('Celtic Knot 4 × 3', strands('celtic', plait), camera(2.2, 0.3));
    if (errors.length) throw new Error(errors.join('\n'));
    return 'done';
  } finally {
    await device.queue.onSubmittedWorkDone();
    pass.dispose(); color.destroy(); depth.destroy(); readback.destroy(); device.destroy();
  }
}

run().then(result => { document.querySelector('#result')!.textContent = result; })
  .catch(error => { document.querySelector('#result')!.textContent = `FAIL: ${error.stack ?? error}`; });
