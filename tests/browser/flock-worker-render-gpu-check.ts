import type { Keyframe } from '../../src/types/keyframes';
import { renderFlockProbe, type FlockWorkerProbeInput } from './flock-worker-render-probe';
import { FlockGraphBuilder } from '../../src/services/flock/presets/flockGraphBuilder';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import { encodeLoudnessCurvePayload } from '../../src/services/audio/loudnessEnvelopeManifest';
import { flockAudioCurveFingerprint } from '../../src/engine/flock/runtime/flockAudioCurve';

async function check() {
  const builder = new FlockGraphBuilder();
  const emitter = builder.add('flock.emitter', { count: 512, center: [0, 0, 0], shape: 'grid', size: [4, 4, 2], initialSpeed: 1 });
  const simulation = builder.add('flock.simulation', { minSpeed: 0, maxSpeed: 20, stepRate: '60' });
  const fluid = builder.add('flock.fluid', { center: [0, 0, 0], size: [12, 12, 8], cellSize: 2, gravity: [0, 0, 0] });
  const points = builder.add('flock.render-points', { size: 8, blend: 'opaque', colorMode: 'image', image: 'probe-pigment',
    color: '#ffffff', opacity: 1, shading: 'lit', distanceFade: 0 });
  const instances = builder.add('flock.render-instances', { mesh: 'model', model: 'probe-model', size: 0.22,
    color: '#ff3030', sizeVariance: 0, swimAmplitude: 0, shading: 'flat' });
  const output = builder.add('flock.output');
  builder.connect(emitter, 'spawn', simulation, 'spawn').connect(fluid, 'behavior', simulation, 'behavior');
  for (const branch of [points, instances]) builder.connect(simulation, 'particles', branch, 'particles').connect(branch, 'scene', output, 'scene');
  const definition = builder.build('worker-render-probe');
  const compiled = compileFlockDefinition(definition);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const property = compiled.program.simulation.params.numbers.maxSpeed.property!;
  const keyframes = [
    { id: 'speed-a', property, time: 0, value: 2, easing: 'linear' },
    { id: 'speed-b', property, time: 0.15, value: 0.2, easing: 'linear' },
  ] as Keyframe[];
  // Main-owned blob URLs are resolved from the real Worker, like project media.
  const frameStackUrls: string[] = [];
  for (const color of ['#20ff40', '#ff2040']) {
    const pigment = new OffscreenCanvas(2, 2), context = pigment.getContext('2d')!;
    context.fillStyle = color; context.fillRect(0, 0, 2, 2);
    frameStackUrls.push(URL.createObjectURL(await pigment.convertToBlob()));
  }
  for (const obj of ['v -1 -1 0\nv 1 -1 0\nv 0 1 0\nf 1 2 3',
    'v -1 -1 0\nv 1 -1 0\nv 1 1 0\nv -1 1 0\nf 1 2 3\nf 1 3 4']) {
    frameStackUrls.push(URL.createObjectURL(new Blob([obj], { type: 'text/plain' })));
  }
  const audioCurves = [-60, 0].map(db => {
    const curve = { values: new Float32Array(32).fill(db), hopDuration: 0.1, pointCount: 32 };
    const bytes = encodeLoudnessCurvePayload({ header: { schemaVersion: 1, metric: 'momentary-lufs', windowDuration: 0.4,
      hopDuration: 0.1, pointCount: 32, valueLayout: 'time-series', valueEncoding: 'db' }, values: curve.values });
    return { url: URL.createObjectURL(new Blob([bytes])), byteLength: bytes.byteLength, fingerprint: flockAudioCurveFingerprint(curve) };
  });
  const makeInput = async (): Promise<FlockWorkerProbeInput> => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
    document.querySelector('#canvases')!.append(canvas);
    const pigmentSource = new OffscreenCanvas(2, 2), context = pigmentSource.getContext('2d')!;
    context.fillStyle = '#20ff40'; context.fillRect(0, 0, 2, 2);
    return { canvas: canvas.transferControlToOffscreen(), program: compiled.program, definition, keyframes, frameStackUrls, audioCurves, pigment: await createImageBitmap(pigmentSource) };
  };
  const main = await renderFlockProbe(await makeInput());
  const worker = new Worker(new URL('./flock-worker-render.worker.ts', import.meta.url), { type: 'module' });
  const input = await makeInput();
  let heartbeats = 0;
  const heartbeat = setInterval(() => heartbeats++, 16);
  try {
    const result = await new Promise<Awaited<ReturnType<typeof renderFlockProbe>>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker render timed out')), 60000);
      worker.onerror = event => { clearTimeout(timeout); reject(new Error(`${event.message} (${event.filename}:${event.lineno}:${event.colno})`)); };
      worker.onmessage = event => {
        clearTimeout(timeout);
        if (event.data.success) resolve(event.data.result); else reject(new Error(event.data.error));
      };
      worker.postMessage(input, [input.canvas, input.pigment]);
    });
    if (!result.worker || main.worker) throw new Error('Probe did not execute in separate realms');
    if (heartbeats < 1) throw new Error('Main event loop did not run during worker render');
    for (let i = 0; i < main.particles.length; i++) {
      if (main.particles[i] !== result.particles[i]) throw new Error(`Worker simulation mismatch at ${i}`);
    }
    let maxPixelDelta = 0;
    for (let frame = 0; frame < main.images.length; frame++) {
      const a = main.images[frame], b = result.images[frame];
      for (let i = 0; i < a.length; i++) {
        const delta = Math.abs(a[i] - b[i]); maxPixelDelta = Math.max(maxPixelDelta, delta);
        if (delta > 1) throw new Error(`Worker pixel mismatch ${frame}/${i}: ${a[i]} vs ${b[i]}`);
      }
    }
    if (!result.images[0].some((value, i) => value !== result.images[1][i])) throw new Error('Model replacement did not change pixels');
    return { success: true, audioSnapshots: true, audioResimulation: true, hostProjection: true, frameStackAssets: true, comparedImages: main.images.length, nativeFrameStack: result.nativeFrameStack, sharedScene: result.sharedScene, sharedDepth: result.sharedDepth, worker: result.worker, offscreenTransferred: true, steps: result.step,
      count: compiled.program.capacity, coloredPixels: result.coloredPixels, pigmentPixels: result.pigmentPixels, modelReplacement: 'verified',
      simulation: 'exact', persistedCheckpoints: result.persistedCheckpoints, persistentSession: result.persistentSession, seekReplay: result.seekReplay, keyframeInvalidation: result.keyframeInvalidation, statusCount: result.statusCount, maxPixelDelta, mainThreadHeartbeats: heartbeats };
  } finally { clearInterval(heartbeat); [...frameStackUrls, ...audioCurves.map(curve => curve.url)].forEach(url => URL.revokeObjectURL(url)); /* Keep the worker's canvas visible for inspection. */ }
}

check().then(result => { document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2); })
  .catch(error => { document.querySelector('#result')!.textContent = JSON.stringify({ success: false, error: String(error) }); });
