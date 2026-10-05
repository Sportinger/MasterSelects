import '../../src/engine/native3d/NativeSceneRenderer';
import { NativeSceneRuntime } from '../../src/engine/native3d/NativeSceneRuntime';
import { NativeHelperClient } from '../../src/services/nativeHelper/NativeHelperClient';
import { DEFAULT_COMPOSITION_RENDER_SETTINGS } from '../../src/engine/native3d/pathtrace/contracts/ptTypes';
import { comparePtImages } from '../../src/engine/native3d/pathtrace/native/ptImageComparison';
import { getPtStatus } from '../../src/engine/native3d/pathtrace/runtime/ptStatus';
import { checkFiberPrecision } from './pathtraceFiberPrecision';
import { referenceCamera, referenceScenes, IDENTITY, type ReferenceScene } from './pathtraceScenes';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const report = document.querySelector('#result')!, button = document.querySelector<HTMLButtonElement>('#run')!;
const convergence = document.querySelector<HTMLButtonElement>('#convergence')!;
function show(pixels: Float32Array, width: number, height: number, label: string) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.title = label;
  const context = canvas.getContext('2d')!, image = context.createImageData(width, height);
  for (let i = 0; i < pixels.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = Math.max(0, pixels[i + c] / Math.max(pixels[i + 3], 1e-8));
      image.data[i + c] = Math.min(1, v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055) * 255;
    }
    image.data[i + 3] = pixels[i + 3] * 255;
  }
  context.putImageData(image, 0, 0);
  const figure = document.createElement('figure'), caption = document.createElement('figcaption');
  caption.textContent = label; figure.append(caption, canvas); document.querySelector('#frames')!.append(figure);
}
const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'geometry', layout: {}, nodes: [
  { id: 'line', operator: 'geometry.curve-line', operatorVersion: 1, bindings: {}, constants: { points: 3, length: 2, axis: 'y' } },
  { id: 'array', operator: 'geometry.strand-array', operatorVersion: 1, bindings: {}, constants: { count: 4, spacing: .3, axis: 'x' } },
  { id: 'material', operator: 'material.fiber', operatorVersion: 1, bindings: {}, constants: { color: '#aa5522', matte: .3 } },
  { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {}, constants: { width: .12, color: '#aa5522' } },
  { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
], edges: [
  { id: 'a', from: 'line', output: 'curves', to: 'array', input: 'curves' },
  { id: 'b', from: 'array', output: 'curves', to: 'material', input: 'curves' },
  { id: 'c', from: 'material', output: 'curves', to: 'render', input: 'curves' },
  { id: 'd', from: 'render', output: 'scene', to: 'output', input: 'scene' },
] };

async function run(samples: number) {
  if (!await NativeHelperClient.connect()) throw new Error('Native helper unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
    requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
  const errors: string[] = []; device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const width = 480, height = 270;
  const coarse: ReferenceScene = { id: 'standard-weave', label: 'Coarse fibers', background: [0, 0, 0], camera: referenceCamera(width, height, [0, 0, 3]),
    layers: [{ kind: 'strands', layerId: 'coarse', clipId: 'coarse', opacity: 1, blendMode: 'normal', sourceWidth: width, sourceHeight: height,
      worldMatrix: IDENTITY, strands: { clipId: 'coarse', effectId: 'coarse', program: compileGeometryGraph(graph, geometryParameterReader({})) } }] };
  const scenes = [coarse, referenceScenes(width, height, '')[1]], results = [];
  try {
    const precision = await checkFiberPrecision(device);
    for (const scene of scenes) {
      const runtime = new NativeSceneRuntime({ flockRuntime: () => { throw new Error('No flock in fixture'); }, isRealtime: () => false, sourceFingerprint: () => undefined });
      let capture: Awaited<ReturnType<NativeSceneRuntime['beginNativeBenchmark']>> | undefined, jobId: string | undefined;
      try {
        await runtime.initialize(width, height);
        const settings = { ...DEFAULT_COMPOSITION_RENDER_SETTINGS, engine: 'path-traced' as const, renderScale: 1 as const, stillSamples: 1, maxBounces: 8 };
        let captureError = '';
        // A cold shader compile also contributes to the preview scheduler's idle interval.
        for (let attempt = 0; attempt < 600 && !capture; attempt++) {
          runtime.renderScene(device, scene.layers, scene.camera, [], false, null, null, 'main', undefined, { renderSettings: settings });
          await device.queue.onSubmittedWorkDone();
          try { capture = await runtime.beginNativeBenchmark(); } catch (error) {
            captureError = String(error); report.textContent = JSON.stringify({ attempt, status: getPtStatus(), captureError, errors });
            await new Promise(resolve => setTimeout(resolve, 20));
          }
        }
        if (!capture) throw new Error(`No stable scene snapshot: ${captureError}; ${JSON.stringify({ status: getPtStatus(), errors })}`);
        const job = await NativeHelperClient.optix.begin(); jobId = job.jobId;
        if (!await NativeHelperClient.writeFileBinary(job.inputPath, capture.snapshot)) throw new Error('Upload failed');
        report.textContent = `${scene.label}: OptiX…`;
        const native = await NativeHelperClient.optix.render(jobId, samples);
        const reference = await capture.reference(samples, progress => { report.textContent = `${scene.label}: ${progress}`; });
        const difference = comparePtImages(reference.pixels, native.pixels);
        if (difference.nonFinite || difference.meanCoverage[0] < .01 || difference.meanLuminance[0] < .001) throw new Error('Invalid/empty image');
        if (scene === coarse && (difference.relativeRmse > .05 || difference.coverageMae > .001)) throw new Error(`Coarse fiber mismatch: ${JSON.stringify(difference)}`);
        if (scene !== coarse && (difference.relativeRmse > .25 || difference.coverageMae > .0001
          || Math.abs(difference.meanLuminance[1] / difference.meanLuminance[0] - 1) > .01)) {
          throw new Error(`Dense fiber mismatch: ${JSON.stringify(difference)}`);
        }
        const row = { scene: scene.label, ...difference, webgpuMs: reference.gpuMs, webgpuWallMs: reference.wallMs, native: native.metrics };
        results.push(row); show(reference.pixels, width, height, `${scene.label}: WebGPU`); show(native.pixels, width, height, `${scene.label}: OptiX`);
      } finally { capture?.release(); if (jobId) await NativeHelperClient.optix.discard(jobId); runtime.dispose(); }
    }
    if (errors.length) throw new Error(errors.join('\n'));
    return { passed: true, precision, results, gpuErrors: errors };
  } finally { device.destroy(); }
}
function start(samples: number) {
  button.disabled = convergence.disabled = true; document.querySelector('#frames')!.replaceChildren(); report.textContent = 'Preparing…';
  void run(samples).then(result => { report.textContent = JSON.stringify(result, null, 2); }, error => { report.textContent = JSON.stringify({ passed: false, error: String(error) }, null, 2); })
    .finally(() => { button.disabled = convergence.disabled = false; });
};
button.onclick = () => start(16); convergence.onclick = () => start(64);
button.disabled = convergence.disabled = false;
