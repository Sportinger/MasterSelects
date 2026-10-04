import { SceneColorReadback } from './sceneColorReadback';
import { StrandPass } from '../../src/engine/native3d/passes/StrandPass';
import { MeshPass } from '../../src/engine/native3d/passes/MeshPass';
import { ModelRuntimeCache } from '../../src/engine/native3d/assets/ModelRuntimeCache';
import { lookAt, perspective } from '../../src/engine/scene/cameraUtils/projectionMatrices';
import type { SceneCamera, SceneLightLayer, ScenePrimitiveLayer, SceneStrandLayer } from '../../src/engine/scene/types';

/**
 * Shadow exchange between strands and lit meshes, with the production passes: a scene light
 * above right shadows a backdrop through the strands, and a small plane between the light and
 * the strands shadows the strands. Reports mean brightness over the pixels each effect can reach.
 */
const SIZE = 128;
const translate = (x: number, y: number, z: number, scale = 1) => Float32Array.from([scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, x, y, z, 1]);

async function check() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const camera: SceneCamera = { viewMatrix: lookAt(0, 0, 3, 0, 0, 0, 0, 1, 0), projectionMatrix: perspective(50 * Math.PI / 180, 1, 0.1, 100),
    cameraPosition: { x: 0, y: 0, z: 3 }, cameraTarget: { x: 0, y: 0, z: 0 }, cameraUp: { x: 0, y: 1, z: 0 },
    viewport: { width: SIZE, height: SIZE }, projection: 'perspective', fov: 50, near: 0.1, far: 100 };
  const base = { opacity: 1, blendMode: 'normal' as const, sourceWidth: SIZE, sourceHeight: SIZE };
  const light = { ...base, kind: 'light', layerId: 'light', clipId: 'light', worldMatrix: translate(1.5, 0, 2),
    lightSettings: { kind: 'point', color: '#ffffff', intensity: 1.5, diameter: 3, castsShadows: true, shadowStrength: 1 } } as unknown as SceneLightLayer;
  const backdrop: ScenePrimitiveLayer = { ...base, kind: 'primitive', meshType: 'plane', layerId: 'backdrop', clipId: 'backdrop', worldMatrix: translate(0, 0, -0.6, 4) };
  const blocker: ScenePrimitiveLayer = { ...base, kind: 'primitive', meshType: 'plane', layerId: 'blocker', clipId: 'blocker', worldMatrix: translate(0.75, 0, 1, 0.3) };
  const strands: SceneStrandLayer = { ...base, kind: 'strands', layerId: 'weave', clipId: 'weave', worldMatrix: translate(0, 0, 0),
    strands: { clipId: 'weave', effectId: 'weave', program: { pointCount: 6 * 48, strandCount: 6,
      stages: [{ kind: 'curve-line', nodeId: 'line', points: 48, length: 1.4, axis: 0 }, { kind: 'strand-array', nodeId: 'array', count: 6, spacing: 0.14, axis: 1 }],
      render: { nodeId: 'render', width: 0.02, color: '#e8e2d6', profile: { plies: 3, fibers: 4, radius: 0.04, plyTwist: 3, fiberTwist: -6 } } } } };
  const strandPass = new StrandPass(), meshPass = new MeshPass(), models = new ModelRuntimeCache();
  meshPass.initialize(device, 'depth24plus');
  const target = new SceneColorReadback(device, SIZE, SIZE), color = target.texture;
  const depth = device.createTexture({ size: [SIZE, SIZE], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });

  async function frame(options: { strands: boolean; receive: boolean; casters: ScenePrimitiveLayer[]; meshes: ScenePrimitiveLayer[] }) {
    device.pushErrorScope('validation');
    const encoder = device.createCommandEncoder(), temporary: GPUBuffer[] = [];
    encoder.beginRenderPass({ colorAttachments: [{ view: color.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } }).end();
    const prepared = strandPass.prepare(device, options.strands ? [strands] : [], temporary);
    const shadows = strandPass.prepareShadows(device, encoder, prepared, temporary, [light], (pass, target, viewMatrix, projectionMatrix) =>
      meshPass.renderShadowCasters(device, pass, target, { viewMatrix, projectionMatrix }, options.casters, [], models, temporary));
    if (!meshPass.renderPrimitivePass(device, encoder, color.createView(), depth.createView(), options.meshes, camera, [], [light], models,
      temporary, false, options.receive ? shadows.receiver : null)) throw new Error('Mesh pass refused the frame');
    if (!strandPass.render(device, encoder, color.createView(), depth.createView(), shadows, camera, temporary)) throw new Error('Strand pass refused the frame');
    target.encodeCopy(encoder);
    device.queue.submit([encoder.finish()]);
    const rgba = Uint8Array.from(await target.read());
    temporary.forEach(buffer => buffer.destroy());
    const error = await device.popErrorScope();
    if (error) throw new Error(error.message);
    return { rgba, receiver: shadows.receiver !== null };
  }
  const luminance = (rgba: Uint8Array, pixel: number) => rgba[pixel * 4] + rgba[pixel * 4 + 1] + rgba[pixel * 4 + 2];
  const mean = (rgba: Uint8Array, pixels: number[]) => pixels.reduce((sum, pixel) => sum + luminance(rgba, pixel), 0) / Math.max(1, pixels.length) / 3;
  const all = Array.from({ length: SIZE * SIZE }, (_, pixel) => pixel);
  try {
    const backdropOnly = await frame({ strands: false, receive: true, casters: [], meshes: [backdrop] });
    const unshadowed = await frame({ strands: true, receive: false, casters: [backdrop], meshes: [backdrop] });
    const received = await frame({ strands: true, receive: true, casters: [backdrop], meshes: [backdrop] });
    // Backdrop pixels the strands do not cover in the camera view.
    const open = all.filter(pixel => luminance(unshadowed.rgba, pixel) === luminance(backdropOnly.rgba, pixel));
    const darkened = open.filter(pixel => luminance(received.rgba, pixel) < luminance(unshadowed.rgba, pixel) - 6);
    if (!received.receiver) throw new Error('A shadow-casting scene light produced no mesh receiver');
    if (darkened.length < 50) throw new Error(`Backdrop received too little strand shadow (${darkened.length} px)`);
    if (open.some(pixel => luminance(received.rgba, pixel) > luminance(unshadowed.rgba, pixel) + 1)) throw new Error('Receiving a shadow brightened the backdrop');

    // Strand pixels near the center, which the blocker's shadow reaches; the blocker is drawn in both frames.
    const mask = await frame({ strands: true, receive: false, casters: [], meshes: [] });
    const meshes = [backdrop, blocker];
    const free = await frame({ strands: true, receive: true, casters: [backdrop], meshes });
    const blocked = await frame({ strands: true, receive: true, casters: [backdrop, blocker], meshes });
    const canvas = document.querySelector<HTMLCanvasElement>('#preview')!;
    canvas.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(blocked.rgba), SIZE, SIZE), 0, 0);
    const center = all.filter(pixel => luminance(mask.rgba, pixel) > 0
      && Math.abs(pixel % SIZE - SIZE / 2) < SIZE * 0.08 && Math.abs(Math.floor(pixel / SIZE) - SIZE / 2) < SIZE * 0.08);
    const shaded = center.filter(pixel => luminance(blocked.rgba, pixel) < luminance(free.rgba, pixel) - 6);
    if (shaded.length < center.length * 0.6) throw new Error(`Blocker shadowed too few strand pixels (${shaded.length}/${center.length})`);
    const outside = all.filter(pixel => luminance(mask.rgba, pixel) > 0 && Math.abs(pixel % SIZE - SIZE / 2) > SIZE * 0.16);
    if (outside.length < 20 || outside.some(pixel => luminance(blocked.rgba, pixel) !== luminance(free.rgba, pixel))) throw new Error('Blocker shadow reached strands outside its footprint');
    const keyLit = await (async () => {
      const encoder = device.createCommandEncoder(), temporary: GPUBuffer[] = [];
      const shadows = strandPass.prepareShadows(device, encoder, strandPass.prepare(device, [strands], temporary), temporary, []);
      device.queue.submit([encoder.finish()]);
      temporary.forEach(buffer => buffer.destroy());
      return shadows.receiver;
    })();
    if (keyLit) throw new Error('The fixed key light must not shadow meshes');
    if (errors.length) throw new Error(errors.join('\n'));
    return { pass: true, backdrop: { openPixels: open.length, darkened: darkened.length,
      meanBefore: mean(unshadowed.rgba, darkened), meanAfter: mean(received.rgba, darkened) },
    strands: { centerPixels: center.length, shaded: shaded.length, unchangedOutside: outside.length,
      meanFree: mean(free.rgba, shaded), meanBlocked: mean(blocked.rgba, shaded) },
    keyLightReceiver: false };
  } finally {
    await device.queue.onSubmittedWorkDone();
    strandPass.dispose(); meshPass.dispose(); depth.destroy(); target.destroy();
    device.destroy();
  }
}

check().then(result => { document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2); })
  .catch(error => { document.querySelector('#result')!.textContent = `FAIL: ${error.stack ?? error}`; });
