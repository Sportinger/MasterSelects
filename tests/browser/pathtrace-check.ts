// The app enters the scene runtime through NativeSceneRenderer; importing it first keeps that module order.
import '../../src/engine/native3d/NativeSceneRenderer';
import { NativeSceneRuntime } from '../../src/engine/native3d/NativeSceneRuntime';
import { FLYAWAY_CHANNELS, strandSubdivisions, cameraPositionFromView } from '../../src/engine/native3d/passes/StrandPass';
import { strandSegmentStarts } from '../../src/engine/native3d/passes/strandBuffers';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { PT_BVH_NODE, PT_FIBER_SEGMENT } from '../../src/engine/native3d/pathtrace/contracts/ptLayouts';
import { proceduralSkyHdr, referenceScenes, type ReferenceScene } from './pathtraceScenes';
import type { SceneStrandLayer } from '../../src/engine/scene/types';

/**
 * Path tracing reference scenes (plan section 5, step 3): renders each scene through the production
 * NativeSceneRuntime, measures GPU time with timestamps around the scene submission, reads the
 * image back and checks that it is not empty, and reports fiber segment counts and the memory the
 * path tracer's segments and BVH would take at its default subdivision.
 */
const WIDTH = 1920, HEIGHT = 1080, PREVIEW_WIDTH = 480, REPEATS = 12, PT_SUBDIVISIONS = 2;

const BLIT = /* wgsl */`
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> Out {
  let p = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  return Out(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}
@fragment fn fs(in: Out) -> @location(0) vec4f { return clamp(textureSample(source, linearSampler, in.uv), vec4f(0.0), vec4f(1.0)); }`;

const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? NaN;
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

function strandStats(scene: ReferenceScene) {
  let curveSegments = 0, rasterPieces = 0, ptSegments = 0;
  const eye = cameraPositionFromView(scene.camera.viewMatrix);
  for (const layer of scene.layers.filter((item): item is SceneStrandLayer => item.kind === 'strands')) {
    const curves = evaluateGeometryProgram(layer.strands.program);
    const segments = strandSegmentStarts(curves.starts, curves.counts).length;
    const render = layer.strands.program.render!, profile = render.profile;
    const instances = (profile ? profile.plies * profile.fibers : 1) + (profile && render.flyaways ? FLYAWAY_CHANNELS : 0);
    let extent = 0, length = 0;
    for (let index = 0; index < curves.positions.length; index += 3) extent = Math.max(extent, Math.hypot(curves.positions[index], curves.positions[index + 1], curves.positions[index + 2]));
    for (let strand = 0; strand < curves.counts.length; strand++) {
      for (let point = curves.starts[strand]; point + 1 < curves.starts[strand] + curves.counts[strand]; point++) {
        length += Math.hypot(...[0, 1, 2].map(axis => curves.positions[(point + 1) * 3 + axis] - curves.positions[point * 3 + axis]) as [number, number, number]);
      }
    }
    curveSegments += segments;
    rasterPieces += segments * instances * strandSubdivisions(segments ? length / segments : 0, extent, layer.worldMatrix, eye, scene.camera);
    ptSegments += segments * instances * PT_SUBDIVISIONS;
  }
  return { curveSegments, rasterPieces, ptSegments, ptBytes: ptSegments * PT_FIBER_SEGMENT.size + Math.max(0, 2 * ptSegments - 1) * PT_BVH_NODE.size };
}

async function run() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter');
  const timestamps = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({ requiredFeatures: timestamps ? ['timestamp-query'] : [],
    requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const hdrUrl = URL.createObjectURL(proceduralSkyHdr());
  const querySet = timestamps ? device.createQuerySet({ type: 'timestamp', count: 2 }) : null;
  const resolve = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const stamps = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const previewHeight = Math.round(PREVIEW_WIDTH * HEIGHT / WIDTH);
  const preview = device.createTexture({ size: [PREVIEW_WIDTH, previewHeight], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const bytesPerRow = Math.ceil(PREVIEW_WIDTH * 4 / 256) * 256;
  const pixels = device.createBuffer({ size: bytesPerRow * previewHeight, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const blitModule = device.createShaderModule({ code: BLIT });
  const blit = device.createRenderPipeline({ layout: 'auto', vertex: { module: blitModule, entryPoint: 'vs' },
    fragment: { module: blitModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const marker = (index: number) => {
    const encoder = device.createCommandEncoder();
    encoder.beginComputePass(querySet ? { timestampWrites: index === 0 ? { querySet, beginningOfPassWriteIndex: 0 } : { querySet, endOfPassWriteIndex: 1 } } : {}).end();
    if (querySet && index === 1) { encoder.resolveQuerySet(querySet, 0, 2, resolve, 0); encoder.copyBufferToBuffer(resolve, 0, stamps, 0, 16); }
    device.queue.submit([encoder.finish()]);
  };
  const rows: Record<string, string | number>[] = [];
  try {
    for (const scene of referenceScenes(WIDTH, HEIGHT, hdrUrl)) {
      const runtime = new NativeSceneRuntime({ flockRuntime: () => { throw new Error('no flock in reference scenes'); }, isRealtime: () => false,
        sourceFingerprint: () => undefined });
      await runtime.initialize(WIDTH, HEIGHT);
      const gpu: number[] = [], wall: number[] = [];
      let view: GPUTextureView | null = null;
      for (let repeat = 0; repeat < REPEATS; repeat++) {
        marker(0);
        const started = performance.now();
        view = runtime.renderScene(device, scene.layers, scene.camera, [], false);
        if (!view) throw new Error(`${scene.id}: the scene runtime rendered nothing`);
        marker(1);
        await device.queue.onSubmittedWorkDone();
        wall.push(performance.now() - started);
        if (querySet) {
          await stamps.mapAsync(GPUMapMode.READ);
          const [begin, end] = new BigUint64Array(stamps.getMappedRange());
          gpu.push(Number(end - begin) / 1e6);
          stamps.unmap();
        }
      }
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: preview.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(blit);
      pass.setBindGroup(0, device.createBindGroup({ layout: blit.getBindGroupLayout(0), entries: [{ binding: 0, resource: view! }, { binding: 1, resource: sampler }] }));
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer({ texture: preview }, { buffer: pixels, bytesPerRow }, [PREVIEW_WIDTH, previewHeight]);
      device.queue.submit([encoder.finish()]);
      await pixels.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(pixels.getMappedRange());
      const image = new ImageData(PREVIEW_WIDTH, previewHeight);
      let covered = 0;
      for (let y = 0; y < previewHeight; y++) {
        for (let x = 0; x < PREVIEW_WIDTH; x++) {
          const source = y * bytesPerRow + x * 4, target = (y * PREVIEW_WIDTH + x) * 4, alpha = mapped[source + 3] / 255;
          if (alpha > 0.02) covered++;
          for (let channel = 0; channel < 3; channel++) {
            image.data[target + channel] = Math.round(mapped[source + channel] + scene.background[channel] * 255 * (1 - alpha));
          }
          image.data[target + 3] = 255;
        }
      }
      pixels.unmap();
      const coverage = covered / (PREVIEW_WIDTH * previewHeight);
      if (coverage < 0.01) throw new Error(`${scene.id}: readback is empty (${(coverage * 100).toFixed(2)} % covered)`);
      const figure = document.createElement('figure'), canvas = document.createElement('canvas'), caption = document.createElement('figcaption');
      canvas.width = PREVIEW_WIDTH; canvas.height = previewHeight; canvas.getContext('2d')!.putImageData(image, 0, 0);
      caption.textContent = `${scene.label} (Raster)`;
      figure.append(canvas, caption);
      document.querySelector('#frames')!.append(figure);
      const stats = strandStats(scene);
      rows.push({ scene: scene.label, 'curve segments': stats.curveSegments, 'raster pieces': stats.rasterPieces,
        [`PT segments (subdivision ${PT_SUBDIVISIONS})`]: stats.ptSegments, 'PT segments + BVH': megabytes(stats.ptBytes),
        'raster GPU ms (median)': timestamps ? median(gpu.slice(1)).toFixed(2) : 'n/a', 'raster wall ms (median)': median(wall.slice(1)).toFixed(2),
        coverage: `${(coverage * 100).toFixed(1)} %` });
      runtime.dispose();
    }
  } finally {
    URL.revokeObjectURL(hdrUrl);
    await device.queue.onSubmittedWorkDone();
    resolve.destroy(); stamps.destroy(); preview.destroy(); pixels.destroy(); querySet?.destroy();
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

run().then(result => {
  document.querySelector('#table')!.innerHTML = renderTable(result.rows);
  document.querySelector('#result')!.textContent = `PASS\n${JSON.stringify(result, null, 2)}`;
}).catch(error => { document.querySelector('#result')!.textContent = `FAIL: ${error.stack ?? error}`; });
