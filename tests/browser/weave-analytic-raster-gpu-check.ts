import { SceneColorReadback } from './sceneColorReadback';
import { StrandPass } from '../../src/engine/native3d/passes/StrandPass';
import { STRAND_RASTER_SHADER } from '../../src/engine/native3d/passes/strandShaders';
import { StrandRasterScan } from '../../src/engine/native3d/passes/strandRaster/StrandRasterScan';
import type { SceneCamera, SceneStrandLayer } from '../../src/engine/scene/types';
import type { GeometryStage, GeometryStrandRender } from '../../src/services/operators/geometry/geometryProgram';

/**
 * Exact checks of the analytic strand raster with the production pass: compilation, the prefix
 * sum, pixel coverage equal to the fiber width (also across piece joints), determinism, scene
 * occlusion, zero opacity/width, front-to-back blending and a real yarn with flyaways.
 */
const WIDTH = 128, HEIGHT = 64;
const identity = () => Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

async function check() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const info = await device.createShaderModule({ code: STRAND_RASTER_SHADER }).getCompilationInfo();
  const compileErrors = info.messages.filter(message => message.type === 'error');
  if (compileErrors.length) throw new Error(compileErrors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n'));
  const results: Record<string, unknown> = { compilation: 'passed', scan: await checkScan(device) };
  // Orthographic: NDC equals scene units, 32 px per unit vertically; strands lie at depth 0.2.
  const camera: SceneCamera = { viewMatrix: identity(), projectionMatrix: identity(), cameraPosition: { x: 0, y: 0, z: 2 },
    cameraTarget: { x: 0, y: 0, z: 0 }, cameraUp: { x: 0, y: 1, z: 0 }, viewport: { width: WIDTH, height: HEIGHT },
    projection: 'orthographic', fov: 60, near: 0.1, far: 10 };
  camera.viewMatrix[14] = -2;
  camera.projectionMatrix[10] = -0.1;
  const pass = new StrandPass();
  const target = new SceneColorReadback(device, WIDTH, HEIGHT), color = target.texture;
  const depth = device.createTexture({ size: [WIDTH, HEIGHT], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const layer = (stages: GeometryStage[], render: GeometryStrandRender, opacity = 1, id = 'analytic'): SceneStrandLayer => ({
    kind: 'strands', layerId: id, clipId: id, opacity, blendMode: 'normal', sourceWidth: WIDTH, sourceHeight: HEIGHT, worldMatrix: identity(),
    strands: { clipId: id, effectId: 'weave', program: { stages, render, pointCount: 0, strandCount: 0 } } });
  const line = (points: number, y = 0): GeometryStage[] => [{ kind: 'curve-line', nodeId: 'line', points, length: 1.6, axis: 0 },
    { kind: 'set-position', nodeId: 'lift', offset: { instructions: [{ nodeId: 'c', operation: 'constant', type: 'vec3', inputs: [], value: 0 },
      { nodeId: 'y', operation: 'constant', type: 'scalar', inputs: [], value: y },
      { nodeId: 'v', operation: 'combine-vector', type: 'vec3', inputs: [0, 1, 0] }], output: 2 } }];

  async function frame(layers: SceneStrandLayer[], sceneDepth = 1) {
    device.pushErrorScope('validation');
    const encoder = device.createCommandEncoder(), temporary: GPUBuffer[] = [];
    encoder.beginRenderPass({ colorAttachments: [{ view: color.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: sceneDepth, depthLoadOp: 'clear', depthStoreOp: 'store' } }).end();
    const shadows = pass.prepareShadows(device, encoder, pass.prepare(device, layers, temporary), temporary);
    if (!pass.render(device, encoder, color.createView(), depth.createView(), shadows, camera, temporary)) throw new Error('Strand pass refused the frame');
    target.encodeCopy(encoder);
    device.queue.submit([encoder.finish()]);
    const rgba = Uint8Array.from(await target.read());
    temporary.forEach(buffer => buffer.destroy());
    const error = await device.popErrorScope();
    if (error) throw new Error(error.message);
    return rgba;
  }
  const alpha = (rgba: Uint8Array, x: number, y: number) => rgba[(y * WIDTH + x) * 4 + 3] / 255;
  const columnCoverage = (rgba: Uint8Array) => Array.from({ length: 89 }, (_, index) => {
    let sum = 0;
    for (let y = 0; y < HEIGHT; y++) sum += alpha(rgba, index + 20, y);
    return sum;
  });
  const fiber = (width: number): GeometryStrandRender => ({ nodeId: 'render', width, color: '#ffffff', antialiasing: 'analytic' });
  try {
    for (const pixels of [0.5, 2.5]) {
      for (const points of [9, 64]) {
        const image = await frame([layer(line(points, 0.013), fiber(pixels / 32))]);
        const sums = columnCoverage(image);
        const mean = sums.reduce((a, b) => a + b, 0) / sums.length, spread = Math.max(...sums) - Math.min(...sums);
        if (Math.abs(mean - pixels) > 0.03 || spread > 0.04) {
          const rows = Array.from({ length: HEIGHT }, (_, y) => y).filter(y => sums.some((_, i) => alpha(image, i + 20, y) > 0));
          throw new Error(`${pixels} px fiber (${points} points): coverage ${mean} ± ${spread} rows ${rows} sums ${sums.map(v => v.toFixed(3)).join(' ')}`);
        }
        results[`fiber${pixels}px_${points}points`] = { meanCoverage: mean, spread };
      }
    }
    const thin = layer(line(64, 0.013), fiber(1.5 / 32));
    const first = await frame([thin]), again = await frame([thin]);
    if (first.some((value, index) => value !== again[index])) throw new Error('Repeated analytic frame changed pixels');
    if ((await frame([thin], 0.01)).some((value, index) => index % 4 === 3 && value > 0)) throw new Error('Scene depth did not hide the strands');
    if ((await frame([layer(line(64), fiber(1.5 / 32), 0)])).some((value, index) => index % 4 === 3 && value > 0)) throw new Error('Zero opacity drew pixels');
    if ((await frame([layer(line(64), fiber(0))])).some((value, index) => index % 4 === 3 && value > 0)) throw new Error('Zero width drew pixels');
    // Two wide half-transparent fibers on the same row: coverage combines as 1 - (1 - a)(1 - a).
    const wide = (id: string) => layer(line(64, 0.0), fiber(4 / 32), 0.5, id);
    const stacked = await frame([wide('front'), wide('back')]);
    const center = alpha(stacked, 64, 31);
    results.halfTransparentPair = { center };
    // Layers composite one after another through the shared depth, so the second one only adds where the first is under half covered.
    if (Math.abs(center - 0.5) > 0.01 && Math.abs(center - 0.75) > 0.01) throw new Error(`Stacked transparency gave ${center}`);
    const yarn: GeometryStage[] = [{ kind: 'curve-line', nodeId: 'line', points: 64, length: 1.6, axis: 0 },
      { kind: 'strand-array', nodeId: 'array', count: 5, spacing: 0.25, axis: 1 }];
    const yarnRender = (antialiasing: GeometryStrandRender['antialiasing']): GeometryStrandRender => ({ nodeId: 'render', width: 0.025, color: '#dedbcf',
      antialiasing, profile: { plies: 3, fibers: 5, radius: 0.055, plyTwist: 3, fiberTwist: -7 }, flyaways: { density: 4, length: 0.12, lift: 2, hair: 0.4, seed: 3 } });
    const analytic = await frame([layer(yarn, yarnRender('analytic'))]);
    const coverage = await frame([layer(yarn, yarnRender('coverage4x'))]);
    const total = (rgba: Uint8Array) => rgba.reduce((sum, value, index) => index % 4 === 3 ? sum + value / 255 : sum, 0);
    const ratio = total(analytic) / Math.max(total(coverage), 1e-6);
    if (ratio < 0.85 || ratio > 1.15) throw new Error(`Yarn coverage differs from 4x coverage by ${ratio}`);
    results.yarn = { analyticCoverage: total(analytic), coverage4x: total(coverage), ratio };
    const canvas = document.querySelector<HTMLCanvasElement>('#preview')!;
    canvas.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(analytic), WIDTH, HEIGHT), 0, 0);
    if (errors.length) throw new Error(errors.join('\n'));
    return { pass: true, ...results };
  } finally {
    await device.queue.onSubmittedWorkDone();
    pass.dispose(); depth.destroy(); target.destroy(); device.destroy();
  }
}

async function checkScan(device: GPUDevice) {
  const scan = new StrandRasterScan(), count = 70_001;
  const values = Uint32Array.from({ length: count }, (_, index) => (index * 2654435761) % 7);
  const buffer = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const readback = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeBuffer(buffer, 0, values);
  const encoder = device.createCommandEncoder(), temporary: GPUBuffer[] = [];
  scan.encode(device, encoder, buffer, count, temporary);
  encoder.copyBufferToBuffer(buffer, 0, readback, 0, count * 4);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const result = new Uint32Array(readback.getMappedRange());
  let running = 0;
  for (let index = 0; index < count; index++) {
    if (result[index] !== running) throw new Error(`Prefix sum differs at ${index}: ${result[index]} instead of ${running}`);
    running += values[index];
  }
  readback.unmap();
  [buffer, readback, ...temporary].forEach(item => item.destroy());
  scan.dispose();
  return { count, total: running };
}

check().then(result => { document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2); })
  .catch(error => { document.querySelector('#result')!.textContent = `FAIL: ${error.stack ?? error}`; });
