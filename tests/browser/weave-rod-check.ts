import { StrandPass } from '../../src/engine/native3d/passes/StrandPass';
import { lookAt, perspective } from '../../src/engine/scene/cameraUtils/projectionMatrices';
import { geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { compileGeometryGraph, type GeometryProgram } from '../../src/services/operators/geometry/geometryProgram';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import type { SceneCamera, SceneStrandLayer } from '../../src/engine/scene/types';
import type { EffectOperatorGraph, OperatorValue } from '../../src/types/operatorGraph';

/**
 * Visual and timing check of Rod Simulation with the production strand pass: a reef knot tightened
 * by its pulled ends, and knots dropped onto a floor where they collapse and stack.
 */
const WIDTH = 512, HEIGHT = 288;
const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** A camera given in geometry coordinates (Y up); the shared scene is displayed with +Y down. */
function camera(at: [number, number, number], aim: [number, number, number] = [0, 0, 0]): SceneCamera {
  const eye: [number, number, number] = [at[0], -at[1], at[2]], target: [number, number, number] = [aim[0], -aim[1], aim[2]];
  return { viewMatrix: lookAt(...eye, ...target, 0, -1, 0), projectionMatrix: perspective(50 * Math.PI / 180, WIDTH / HEIGHT, 0.05, 100),
    cameraPosition: { x: eye[0], y: eye[1], z: eye[2] }, cameraTarget: { x: target[0], y: target[1], z: target[2] }, cameraUp: { x: 0, y: -1, z: 0 },
    viewport: { width: WIDTH, height: HEIGHT }, projection: 'perspective', fov: 50, near: 0.05, far: 100 };
}

/** Generator → Rod Simulation (+ Gravity) → Yarn Profile → Strand Render; the yarn is as thick as the rod. */
function rodGraph(generator: Record<string, OperatorValue>, rod: Record<string, OperatorValue>, gravity = 0): EffectOperatorGraph {
  const radius = Number(rod.radius ?? 0.03), { operator, ...source } = generator;
  return { version: 1, schemaVersion: 1, domain: 'geometry', layout: {}, nodes: [
    { id: 'source', operator: String(operator), operatorVersion: 1, bindings: {}, constants: source },
    { id: 'rod', operator: 'geometry.rod-simulation', operatorVersion: 1, bindings: {}, constants: rod as never },
    { id: 'gravity', operator: 'forces.gravity', operatorVersion: 1, bindings: {}, constants: { strength: gravity } },
    { id: 'yarn', operator: 'geometry.yarn-profile', operatorVersion: 1, bindings: {}, constants: { plies: 3, fibers: 5, radius } },
    { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {}, constants: { width: 0.003, color: '#e2d6c2', antialiasing: 'coverage4x' } },
    { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
  ], edges: [
    { id: 'a', from: 'source', output: 'curves', to: 'rod', input: 'curves' }, { id: 'g', from: 'gravity', output: 'force', to: 'rod', input: 'forces' },
    { id: 'b', from: 'rod', output: 'curves', to: 'yarn', input: 'curves' }, { id: 'c', from: 'yarn', output: 'curves', to: 'render', input: 'curves' },
    { id: 'd', from: 'render', output: 'scene', to: 'output', input: 'scene' }] };
}

const program = (graph: EffectOperatorGraph, time: number) => compileGeometryGraph(graph, geometryParameterReader({}), undefined, { simulationTime: time });

/** CPU cost per frame of compiling and evaluating 30 fps playback from 0 to `seconds`. */
function playback(graph: EffectOperatorGraph, seconds: number) {
  const times: number[] = [];
  for (let frame = 0; frame <= seconds * 30; frame++) {
    const start = performance.now();
    evaluateGeometryProgram(program(graph, frame / 30));
    times.push(performance.now() - start);
  }
  const sorted = times.toSorted((a, b) => a - b);
  return `mean ${(times.reduce((sum, value) => sum + value, 0) / times.length).toFixed(2)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(2)} ms`;
}

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
  async function draw(label: string, id: string, strands: GeometryProgram, view: SceneCamera) {
    const layer: SceneStrandLayer = { kind: 'strands', layerId: id, clipId: id, opacity: 1, blendMode: 'normal', sourceWidth: WIDTH, sourceHeight: HEIGHT,
      worldMatrix: identity, strands: { clipId: id, effectId: id, program: strands } };
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
  const lines: string[] = [];
  try {
    const reef = rodGraph({ operator: 'geometry.knot', shape: 'reef', size: 0.6, depth: 0.12 }, { pull: 0.3, pullTime: 2, friction: 0.3, preroll: 0 });
    for (const time of [0, 1, 2, 4]) await draw(`Reef knot tightening, ${time} s`, `reef-${time}`, program(reef, time), camera([0, 0.35, 2.6]));
    await draw('Reef knot tightened, close-up', 'reef-close', program(reef, 4), camera([0, 0.12, 0.75]));
    lines.push(`reef knot playback: ${playback(reef, 4)}`);
    const floor = { floor: 'floor', floorHeight: -0.45, pin: 'none', friction: 0.6, preroll: 0 };
    const trefoil = rodGraph({ operator: 'geometry.knot', shape: 'trefoil', size: 0.35, depth: 0.12 }, floor, 9.8);
    for (const time of [0, 0.4, 3]) await draw(`Trefoil dropped, ${time} s`, `drop-${time}`, program(trefoil, time), camera([0, 0.9, 2.2], [0, -0.35, 0]));
    lines.push(`trefoil drop playback: ${playback(trefoil, 3)}`);
    const plait = rodGraph({ operator: 'geometry.celtic-knot', columns: 3, rows: 2, size: 0.3, height: 0.06 }, floor, 9.8);
    for (const time of [0, 3]) await draw(`Celtic knot dropped, ${time} s`, `celtic-${time}`, program(plait, time), camera([0, 0.9, 2.2], [0, -0.35, 0]));
    lines.push(`celtic drop playback: ${playback(plait, 3)}`);
    if (errors.length) throw new Error(errors.join('\n'));
    return [...lines, 'done'].join('\n');
  } finally {
    await device.queue.onSubmittedWorkDone();
    pass.dispose(); color.destroy(); depth.destroy(); readback.destroy(); device.destroy();
  }
}

run().then(result => { document.querySelector('#result')!.textContent = result; })
  .catch(error => { document.querySelector('#result')!.textContent = `FAIL: ${error.stack ?? error}`; });
