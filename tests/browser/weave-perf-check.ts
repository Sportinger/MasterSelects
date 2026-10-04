import { SCENE_COLOR_FORMAT } from '../../src/engine/native3d/sceneRenderer/constants';
import { StrandPass, cameraPositionFromView, strandSubdivisions, FLYAWAY_CHANNELS } from '../../src/engine/native3d/passes/StrandPass';
import { lookAt, perspective } from '../../src/engine/scene/cameraUtils/projectionMatrices';
import { getSharedSceneDefaultCameraDistance } from '../../src/engine/scene/SceneCameraUtils';
import { createDefaultWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import { buildStrandsLayerSources } from '../../src/services/operators/geometry/strandsLayerSource';
import type { SceneCamera, SceneStrandLayer } from '../../src/engine/scene/types';
import type { Effect } from '../../src/types/effects';

/**
 * Tutorial-scene timing for the P5 measurement table: the default Weave graph over its 8 s of
 * weave-in and wind at 30 fps, rendered at 1920×1080 from the default shared-scene camera.
 * CPU: graph lowering (incl. cloth steps) and curve evaluation/upload; GPU: strand shadow and
 * main passes between two timestamped empty passes.
 */
const WIDTH = 1920, HEIGHT = 1080, FPS = 30, SECONDS = 8, STATIC_REPEATS = 30;
type Mode = 'hashed' | 'coverage4x' | 'analytic';

function camera(): SceneCamera {
  const distance = getSharedSceneDefaultCameraDistance(50);
  return { viewMatrix: lookAt(0, 0, distance, 0, 0, 0, 0, 1, 0), projectionMatrix: perspective(50 * Math.PI / 180, WIDTH / HEIGHT, 0.1, 1000),
    cameraPosition: { x: 0, y: 0, z: distance }, cameraTarget: { x: 0, y: 0, z: 0 }, cameraUp: { x: 0, y: 1, z: 0 },
    viewport: { width: WIDTH, height: HEIGHT }, projection: 'perspective', fov: 50, near: 0.1, far: 1000 };
}

const percentile = (values: number[], p: number) => {
  if (!values.length) return NaN;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1) + 0.5))];
};

async function measure() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter');
  const timestamps = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({ requiredFeatures: timestamps ? ['timestamp-query'] : [] });
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const target = (format: GPUTextureFormat, usage: number) => device.createTexture({ size: [WIDTH, HEIGHT], format, usage });
  const color = target(SCENE_COLOR_FORMAT, GPUTextureUsage.RENDER_ATTACHMENT);
  const depth = target('depth24plus', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
  const querySet = timestamps ? device.createQuerySet({ type: 'timestamp', count: 2 }) : null;
  const resolve = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const view = camera(), eye = cameraPositionFromView(view.viewMatrix);
  const effect: Effect = { id: 'fx-weave', name: 'Weave', type: 'weave', enabled: true, params: {}, operatorGraph: createDefaultWeaveGraph() };
  const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  async function frame(pass: StrandPass, clipId: string, time: number, mode: Mode) {
    const clip = { id: clipId, effects: [effect], startTime: 0, inPoint: 0, outPoint: 10, duration: 10 };
    const compileStart = performance.now();
    const source = buildStrandsLayerSources(clip, time, [])[0]?.source.strands;
    const compileMs = performance.now() - compileStart;
    if (!source?.program.render) throw new Error(`No strand program at ${time}s`);
    if (mode !== 'hashed') source.program.render.antialiasing = mode;
    const layer: SceneStrandLayer = { kind: 'strands', layerId: clipId, clipId, opacity: 1, blendMode: 'normal',
      sourceWidth: WIDTH, sourceHeight: HEIGHT, worldMatrix: identity, strands: source };
    const temporary: GPUBuffer[] = [];
    const encoder = device.createCommandEncoder();
    const marker = (write: GPUComputePassTimestampWrites | undefined) => encoder.beginComputePass(write ? { timestampWrites: write } : {}).end();
    marker(querySet ? { querySet, beginningOfPassWriteIndex: 0 } : undefined);
    const clear = encoder.beginRenderPass({ colorAttachments: [{ view: color.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    clear.end();
    const prepareStart = performance.now();
    const prepared = pass.prepare(device, [layer], temporary);
    const prepareMs = performance.now() - prepareStart;
    const shadows = pass.prepareShadows(device, encoder, prepared, temporary);
    if (!pass.render(device, encoder, color.createView(), depth.createView(), shadows, view, temporary)) throw new Error('Strand pass refused the frame');
    marker(querySet ? { querySet, endOfPassWriteIndex: 1 } : undefined);
    if (querySet) { encoder.resolveQuerySet(querySet, 0, 2, resolve, 0); encoder.copyBufferToBuffer(resolve, 0, readback, 0, 16); }
    const submitted = performance.now();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const wallMs = performance.now() - submitted;
    let gpuMs = NaN;
    if (querySet) {
      await readback.mapAsync(GPUMapMode.READ);
      const [begin, end] = new BigUint64Array(readback.getMappedRange());
      gpuMs = Number(end - begin) / 1e6;
      readback.unmap();
    }
    temporary.forEach(buffer => buffer.destroy());
    const buffers = prepared[0]?.buffers;
    const profile = source.program.render.profile;
    const instances = (profile ? profile.plies * profile.fibers : 1) + (profile && source.program.render.flyaways ? FLYAWAY_CHANNELS : 0);
    const subdivisions = buffers ? strandSubdivisions(buffers.segmentLength, buffers.extent, identity, eye, view) : 0;
    return { time, compileMs, prepareMs, gpuMs, wallMs, fiberPieces: (buffers?.segmentCount ?? 0) * instances * subdivisions,
      curvePoints: source.program.pointCount, extent: buffers?.extent ?? 0 };
  }

  const rows: Record<string, string | number>[] = [];
  const summarize = (label: string, mode: Mode, samples: Awaited<ReturnType<typeof frame>>[]) => {
    const pick = (key: 'compileMs' | 'prepareMs' | 'gpuMs' | 'wallMs') => samples.map(sample => sample[key]);
    const round = (value: number) => Math.round(value * 100) / 100;
    const total = samples.map(sample => sample.compileMs + sample.prepareMs + (Number.isFinite(sample.gpuMs) ? sample.gpuMs : sample.wallMs));
    rows.push({ case: label, mode, frames: samples.length,
      'compile ms (median/p95)': `${round(percentile(pick('compileMs'), 0.5))} / ${round(percentile(pick('compileMs'), 0.95))}`,
      'curves+upload ms': `${round(percentile(pick('prepareMs'), 0.5))} / ${round(percentile(pick('prepareMs'), 0.95))}`,
      'GPU ms': `${round(percentile(pick('gpuMs'), 0.5))} / ${round(percentile(pick('gpuMs'), 0.95))}`,
      'frame ms (serial)': `${round(percentile(total, 0.5))} / ${round(percentile(total, 0.95))}`,
      'fiber pieces (max)': Math.max(...samples.map(sample => sample.fiberPieces)),
      'curve points (max)': Math.max(...samples.map(sample => sample.curvePoints)),
      'slowest CPU frames (s: ms)': samples.toSorted((a, b) => b.compileMs + b.prepareMs - a.compileMs - a.prepareMs).slice(0, 6)
        .map(sample => `${round(sample.time)}: ${round(sample.compileMs + sample.prepareMs)}`).join(', ') });
  };
  try {
    for (const mode of ['hashed', 'coverage4x', 'analytic'] as const) {
      const pass = new StrandPass();
      // A fresh clip id per mode restarts the cloth from its pre-roll, like opening the project.
      const clipId = `perf-${mode}`;
      const animated = [];
      for (let index = 0; index <= SECONDS * FPS; index++) animated.push(await frame(pass, clipId, index / FPS, mode));
      summarize('animated 0-8 s', mode, animated);
      const still = [];
      for (let index = 0; index < STATIC_REPEATS; index++) still.push(await frame(pass, clipId, 6, mode));
      summarize('paused at 6 s', mode, still.slice(1));
      pass.dispose();
    }
  } finally {
    color.destroy(); depth.destroy(); resolve.destroy(); readback.destroy(); querySet?.destroy();
    await device.queue.onSubmittedWorkDone();
    device.destroy();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const info = adapter.info;
  return { adapter: `${info.vendor} ${info.architecture} ${info.description}`.trim(), timestamps, viewport: `${WIDTH}x${HEIGHT}`, rows };
}

function renderTable(rows: Record<string, string | number>[]) {
  const columns = Object.keys(rows[0] ?? {});
  return `<table><tr>${columns.map(column => `<th>${column}</th>`).join('')}</tr>${rows.map(row =>
    `<tr>${columns.map(column => `<td>${row[column]}</td>`).join('')}</tr>`).join('')}</table>`;
}

measure().then(result => {
  document.querySelector('#table')!.innerHTML = renderTable(result.rows);
  document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2);
}).catch(error => { document.querySelector('#result')!.textContent = `FAIL: ${error.stack ?? error}`; });
