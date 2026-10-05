import '../../src/engine/native3d/NativeSceneRenderer';
import { PathTraceRuntime, setPtDebugView } from '../../src/engine/native3d/pathtrace/runtime/PathTraceRuntime';
import { getPtStatus } from '../../src/engine/native3d/pathtrace/runtime/ptStatus';
import { DEFAULT_COMPOSITION_RENDER_SETTINGS, DEFAULT_EXPORT_RENDER_QUALITY } from '../../src/engine/native3d/pathtrace/contracts/ptTypes';
import { referenceCamera, IDENTITY } from './pathtraceScenes';
import type { ScenePlaneLayer } from '../../src/engine/scene/types';
import type { PtRealtimeRenderer } from '../../src/engine/native3d/pathtrace/runtime/ptRealtime';

const width = 512, height = 128;
function check(condition: boolean, message: string): void { if (!condition) throw new Error(message); }

async function run() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice({ requiredLimits: {
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize,
  }});
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const color = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const depth = device.createTexture({ size: [width, height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const camera = referenceCamera(width, height, [0, 0, 4]);
  const settings = { ...DEFAULT_COMPOSITION_RENDER_SETTINGS, engine: 'path-traced' as const, renderScale: 1 as const, stillSamples: 8, maxBounces: 1 };
  const plane = (x: number): ScenePlaneLayer => {
    const worldMatrix = Float32Array.from(IDENTITY); worldMatrix[12] = x;
    return { kind: 'plane', layerId: 'plane', clipId: 'plane', opacity: 1, blendMode: 'normal',
      sourceWidth: width, sourceHeight: height, worldMatrix };
  };
  const runtime = new PathTraceRuntime(() => {});
  type TargetProbe = { depth: GPUBuffer; accumulation: GPUBuffer; samplePixels: number };
  const target = () => (runtime as unknown as { targets: Map<string, TargetProbe> }).targets.get('main')!;
  const render = async (x: number, exporting = false) => {
    const encoder = device.createCommandEncoder(), temporaries: GPUBuffer[] = [];
    runtime.render({ device, encoder, targetKey: 'main', strands: [], meshes: [], voxels: [], sphereSets: [], lights: [],
      planes: [{ layer: plane(x), textureView: null, version: 'static' }], camera, settings,
      sceneView: color.createView(), sceneDepthView: depth.createView(), realtime: false, temporaries,
      ...(exporting ? { exportFrame: { frameIndex: 0, frameDuration: 1 / 30,
        quality: { ...DEFAULT_EXPORT_RENDER_QUALITY, samplesPerPixel: 8, denoise: false } } } : {}) });
    device.queue.submit([encoder.finish()]); runtime.afterSubmit(device);
    await device.queue.onSubmittedWorkDone(); temporaries.forEach(buffer => buffer.destroy());
    return getPtStatus('main')!;
  };
  const read = async (source: GPUBuffer) => {
    const copy = device.createBuffer({ size: source.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(source, 0, copy, 0, source.size);
    device.queue.submit([encoder.finish()]); await copy.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(copy.getMappedRange()).slice(); copy.destroy(); return data;
  };
  const readImage = async () => {
    const copy = device.createBuffer({ size: width * height * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: color }, { buffer: copy, bytesPerRow: width * 8 }, [width, height]);
    device.queue.submit([encoder.finish()]); await copy.mapAsync(GPUMapMode.READ);
    const data = new Uint16Array(copy.getMappedRange()).slice(); copy.destroy(); return data;
  };
  try {
    // Debug view suppresses asynchronous OIDN but uses the same scene invalidation and accumulation.
    setPtDebugView('albedo');
    let partial = false, submissions = 0, samples = 0;
    while (samples < 8 && submissions < 100) {
      samples = (await render(0)).samples;
      partial ||= target().samplePixels !== 0;
      submissions++;
    }
    check(partial, 'Heavy image never split into partial samples');
    check(samples === 8, 'Static plane continuously reset accumulation');
    const states = await read(target().depth);
    check(states.every((value, index) => index % 4 !== 3 || value === 8), 'Pixels were missed or sampled twice');
    const preview = await read(target().accumulation);
    await render(0, true); await render(0, true);
    const exported = await read(target().accumulation);
    let maxDifference = 0;
    preview.forEach((value, index) => { maxDifference = Math.max(maxDifference, Math.abs(value - exported[index])); });
    check(maxDifference < 1e-4, 'Partial preview samples differ from full export batches');

    // The ordinary preview must leave realtime mode once this plane holds still.
    setPtDebugView('none');
    const first = await render(0);
    // An unmistakable realtime placeholder proves new pixels are shown BEFORE one whole sample.
    const realtime = (runtime as unknown as { realtime: PtRealtimeRenderer }).realtime.lastOutput('main')!;
    const placeholder = new Float32Array(width * height * 4);
    for (let index = 0; index < placeholder.length; index += 4) placeholder.set([1, 0, 0, 1], index);
    device.queue.writeBuffer(realtime.color, 0, placeholder);
    const second = await render(0);
    check(first.state === 'realtime' && second.state !== 'realtime', 'Unchanged plane keeps realtime path running');
    check(second.samples === 0 && !!second.partialSample && second.partialSample < 1, 'Partial sample progress is missing');
    const presented = await readImage(), partialStates = await read(target().depth);
    const center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    check(partialStates[center + 3] === 1 && partialStates[3] === 0, 'Preview did not start in the center');
    check(presented[center] < 0x3bff || presented[center + 1] !== 0 || presented[center + 2] !== 0 || presented[center + 3] !== 0x3c00,
      'First sampled tile remains hidden behind the realtime placeholder');
    check(presented[0] >= 0x3bff && presented[1] === 0 && presented[2] === 0 && presented[3] === 0x3c00,
      `Unsampled pixels lost their realtime placeholder: ${Array.from(presented.subarray(0, 4))}`);
    const moved = await render(100);
    check(moved.state === 'realtime' && moved.samples === 0, 'Geometry edits no longer invalidate the image');
    const reset = await read(target().depth);
    check(reset.every(value => value === 0), 'Old pixel sample counts survived a scene edit');
    runtime.pausePreview();
    check(!runtime.needsPreviewFrame, 'Raster switch leaves preview wakeups pending');
    check(errors.length === 0, errors.join('\n'));
    return { passed: true, adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description },
      partialSampleSubmissions: submissions, samples, exportMaxDifference: maxDifference,
      firstPartialSample: second.partialSample, centerFirst: true, firstTileVisible: true,
      staticPlaneStates: [first.state, second.state, moved.state], gpuErrors: errors };
  } finally {
    runtime.dispose(); color.destroy(); depth.destroy();
    setPtDebugView('none');
    await device.queue.onSubmittedWorkDone(); device.destroy();
  }
}

run().then(result => { document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2); }, error => {
  document.querySelector('#result')!.textContent = JSON.stringify({ passed: false, error: String(error) }, null, 2);
});
