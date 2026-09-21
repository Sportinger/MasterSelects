import { resolveImageGraphExternalResources } from '../../src/effects/_shared/imageGraphExternalResources';
import { releaseGlyphAtlasesForDevice } from '../../src/effects/_shared/glyphAtlas';
import { EffectsPipeline, type EffectFrameHistoryContext } from '../../src/effects/EffectsPipeline';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { createDefaultAsciiGhostGraph } from '../../src/services/operators/asciiEffectGraph';
import { effectOperatorCompileContext, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';

const context = (eventRevision: number, discontinuity?: EffectFrameHistoryContext['discontinuity']): EffectFrameHistoryContext =>
  ({ scopeId: 'glyph-feedback-probe', eventRevision, ownerRevision: 1, ...(discontinuity ? { discontinuity } : {}) });

/** Exercises the real EffectsPipeline history owner against explicit canonical graph history inputs. */
export async function checkGlyphFeedbackHistoryGpu(device: GPUDevice): Promise<number> {
  const pipeline = new EffectsPipeline(device), referenceRuntime = new ImageGraphPassRuntime(device);
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
  const source = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage });
  const history = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage });
  const ping = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage });
  const pong = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage });
  const pingView = ping.createView(), pongView = pong.createView();
  const reference = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage });
  const actualReadback = device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const referenceReadback = device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const operatorGraph = createDefaultAsciiGhostGraph(), decay = operatorGraph.nodes.find(node => node.id === 'ghost-decay');
  if (!decay) throw new Error('ASCII Ghost decay node is unavailable.');
  decay.constants = { ...decay.constants, value: .5 };
  const effect = { id: 'glyph-history', type: 'ascii-ghost', name: 'ASCII Ghost', enabled: true,
    params: { amount: 1, speed: 0, historyLoop: 'reset' }, operatorGraph };
  const plan = compileImageOperatorGraph(operatorGraph, effectOperatorParams(effect), effectOperatorCompileContext(effect));
  if (plan.frameHistoryResource !== 'effect-history' || !plan.externalResources?.some(resource => resource.kind === 'glyph-atlas')) {
    throw new Error('ASCII Ghost canonical plan must retain both history and glyph-atlas resources.');
  }
  const read = async (encoder: GPUCommandEncoder, texture: GPUTexture, buffer: GPUBuffer) => {
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: 256 }, [1, 1]);
    device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
    const value = new Uint8Array(buffer.getMappedRange()).slice(0, 4); buffer.unmap(); return value;
  };
  const renderReference = async (input: number[], committed: number[], time: number) => {
    device.queue.writeTexture({ texture: source }, new Uint8Array(input), {}, [1, 1]);
    device.queue.writeTexture({ texture: history }, new Uint8Array(committed), {}, [1, 1]);
    const resources = new Map(resolveImageGraphExternalResources(device, plan));
    resources.set('effect-history', { view: history.createView(), identity: `history:${committed.join(',')}` });
    const encoder = device.createCommandEncoder();
    if (!referenceRuntime.encode({ encoder, sampler, source: { kind: 'texture', view: source.createView() }, width: 1, height: 1,
      timelineTimeSeconds: time, plan, outputView: reference.createView(), instanceId: 'glyph-history-reference', externalResources: resources })) {
      throw new Error('ASCII Ghost reference did not use the resource-backed graph runtime.');
    }
    return read(encoder, reference, referenceReadback);
  };
  let checks = 0;
  const render = async (label: string, input: number[], time: number, metadata: EffectFrameHistoryContext, committed: number[]) => {
    const wanted = await renderReference(input, committed, time);
    device.queue.writeTexture({ texture: source }, new Uint8Array(input), {}, [1, 1]);
    const encoder = device.createCommandEncoder();
    pipeline.applyEffects(encoder, [effect], sampler, source.createView(), pingView, pingView, pongView,
      1, 1, ping, pong, undefined, time, metadata);
    const actual = await read(encoder, ping, actualReadback);
    if (actual.some((value, channel) => value !== wanted[channel])) {
      throw new Error(`${label}: actual=${Array.from(actual)}; expected=${Array.from(wanted)}`);
    }
    checks++;
    return Array.from(actual);
  };
  const clear = [0, 0, 0, 0], bright = [210, 120, 40, 190], dark = [20, 55, 90, 70];
  try {
    await render('initial reset', bright, 0, context(0), clear);
    await render('same-frame hold', bright, 0, context(0), clear);
    const held = await render('changed-source hold', dark, 0, context(0), clear);
    await render('advance latest held output', bright, 1, context(0), held);
    await render('seek reset', dark, 3, context(1, 'seek'), clear);
    const resetLoop = await render('loop reset', bright, 0, context(2, 'loop'), clear);
    effect.params.historyLoop = 'continuous';
    const seeded = await render('continuous seed', bright, 1, context(2, 'loop'), resetLoop);
    const looped = await render('continuous loop advance', dark, 0, context(3, 'loop'), seeded);
    if (looped.every((value, channel) => value === dark[channel])) throw new Error('ASCII Ghost did not retain continuous-loop history.');
    return checks;
  } finally {
    pipeline.destroy(); referenceRuntime.dispose(); releaseGlyphAtlasesForDevice(device);
    source.destroy(); history.destroy(); ping.destroy(); pong.destroy(); reference.destroy(); actualReadback.destroy(); referenceReadback.destroy();
  }
}
