import { StrandPass } from '../../src/engine/native3d/passes/StrandPass';
import { createDefaultWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import { buildStrandsLayerSources } from '../../src/services/operators/geometry/strandsLayerSource';
import type { SceneStrandLayer } from '../../src/engine/scene/types';
import type { Effect } from '../../src/types/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { IDENTITY, referenceCamera } from './pathtraceScenes';
import { SceneColorReadback } from './sceneColorReadback';

/**
 * The raster reads the Fiber Material at once (plan 1.7): the default weave (wool) against the same
 * weave with a per-point Color Field (a ramp along each thread into the red channel) and against a
 * silk preset. Reports mean colors of the covered pixels; the field must tint, silk must shine.
 */
const WIDTH = 480, HEIGHT = 270;

function withColorRamp(graph: EffectOperatorGraph): EffectOperatorGraph {
  const next = structuredClone(graph);
  next.nodes.push(
    { id: 'pt_info', operator: 'geometry.curve-info', operatorVersion: 1, bindings: {} },
    { id: 'pt_ramp', operator: 'field.ramp', operatorVersion: 1, bindings: {}, constants: { x0: 0, y0: 0.15, x1: 0.5, y1: 1, x2: 1, y2: 0.15 } },
    { id: 'pt_low', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 0.25 } },
    { id: 'pt_color', operator: 'vector.combine.vec3', operatorVersion: 1, bindings: {} },
  );
  next.edges.push(
    { id: 'r1', from: 'pt_info', output: 'u', to: 'pt_ramp', input: 'value' },
    { id: 'r2', from: 'pt_ramp', output: 'value', to: 'pt_color', input: 'x' },
    { id: 'r3', from: 'pt_low', output: 'value', to: 'pt_color', input: 'y' },
    { id: 'r4', from: 'pt_low', output: 'value', to: 'pt_color', input: 'z' },
    { id: 'r5', from: 'pt_color', output: 'value', to: 'fiber', input: 'color' },
  );
  return next;
}

async function run() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const pass = new StrandPass(), target = new SceneColorReadback(device, WIDTH, HEIGHT);
  const depth = device.createTexture({ size: [WIDTH, HEIGHT], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const camera = referenceCamera(WIDTH, HEIGHT, [0, -0.35, 1.25]);
  async function render(label: string, graph: EffectOperatorGraph) {
    const effect: Effect = { id: `fx-${label}`, name: 'Weave', type: 'weave', enabled: true, params: {}, operatorGraph: graph };
    const program = buildStrandsLayerSources({ id: label, effects: [effect], startTime: 0, inPoint: 0, outPoint: 10, duration: 10 }, 6, [])[0].source.strands.program;
    const layer: SceneStrandLayer = { kind: 'strands', layerId: label, clipId: label, opacity: 1, blendMode: 'normal', sourceWidth: WIDTH, sourceHeight: HEIGHT,
      worldMatrix: IDENTITY, strands: { clipId: label, effectId: label, program } };
    const encoder = device.createCommandEncoder(), temporary: GPUBuffer[] = [];
    encoder.beginRenderPass({ colorAttachments: [{ view: target.texture.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } }).end();
    const prepared = pass.prepare(device, [layer], temporary);
    pass.render(device, encoder, target.texture.createView(), depth.createView(), pass.prepareShadows(device, encoder, prepared, temporary), camera, temporary);
    target.encodeCopy(encoder);
    device.queue.submit([encoder.finish()]);
    const rgba = await target.read();
    temporary.forEach(buffer => buffer.destroy());
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] > 200) { r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++; }
    const canvas = document.createElement('canvas'), figure = document.createElement('figure'), caption = document.createElement('figcaption');
    canvas.width = WIDTH; canvas.height = HEIGHT;
    canvas.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(rgba), WIDTH, HEIGHT), 0, 0);
    caption.textContent = label; figure.append(canvas, caption); document.querySelector('#frames')!.append(figure);
    return { covered: n, mean: [r / n, g / n, b / n].map(value => Math.round(value)), attributes: !!prepared[0]?.buffers.attributes };
  }
  try {
    const wool = await render('wool', createDefaultWeaveGraph());
    const ramp = await render('color ramp', withColorRamp(createDefaultWeaveGraph()));
    const silkGraph = createDefaultWeaveGraph();
    const fiber = silkGraph.nodes.find(node => node.id === 'fiber')!;
    fiber.constants = { preset: 'silk', roughnessLongitudinal: 0.15, roughnessAzimuthal: 0.35, matte: 0.05, cuticleTilt: 1, color: '#f6efe0' };
    const silk = await render('silk', silkGraph);
    if (!ramp.attributes) throw new Error('The color ramp produced no per-point attributes');
    if (!(ramp.mean[0] > ramp.mean[2] + 20)) throw new Error(`The Color Field did not tint the raster: ${JSON.stringify(ramp)}`);
    if (errors.length) throw new Error(errors.join('\n'));
    return { wool, ramp, silk };
  } finally {
    await device.queue.onSubmittedWorkDone();
    pass.dispose(); target.destroy(); depth.destroy(); device.destroy();
  }
}

run().then(result => { document.querySelector('#result')!.textContent = `PASS\n${JSON.stringify(result, null, 2)}`; })
  .catch(error => { document.querySelector('#result')!.textContent = `FAIL: ${error.stack ?? error}`; });
