import { EffectsPipeline, type EffectFrameHistoryContext } from '../../src/effects/EffectsPipeline';
import { createDefaultAcuarelaGraph } from '../../src/services/operators/acuarelaEffectGraph';
import { effectOperatorCompileContext, effectOperatorParams, isImageGraphEffectType } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';

/** Real GPU history owner, checked against the zero-warp Acuarela recurrence. */
export async function checkFeedbackHistoryGpu(device: GPUDevice): Promise<number> {
  const pipeline = new EffectsPipeline(device);
  pipeline.prewarmEffect('acuarela');
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
    | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
  const source = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage });
  const ping = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage });
  const pong = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage });
  const pingView = ping.createView(), pongView = pong.createView();
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const readback = device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const operatorGraph = createDefaultAcuarelaGraph(), decay = .5;
  const decayNode = operatorGraph.nodes.find(node => node.id === 'feedback-decay');
  if (!decayNode) throw new Error('Canonical Acuarela feedback-decay node is unavailable.');
  decayNode.constants = { ...decayNode.constants, value: decay };
  const effect = { id: 'history-probe', type: 'acuarela', enabled: true,
    params: { opacity: 1, strength: 0, gain: 0, speed: 0, historyLoop: 'reset' }, operatorGraph };
  if (!isImageGraphEffectType(effect.type)) throw new Error('Acuarela is not registered as a canonical image graph owner.');
  const plan = compileImageOperatorGraph(operatorGraph, effectOperatorParams(effect), effectOperatorCompileContext(effect));
  if (plan.frameHistoryResource !== 'effect-history') throw new Error('Canonical Acuarela plan did not retain effect-history.');
  const context = (eventRevision: number, discontinuity?: EffectFrameHistoryContext['discontinuity'], ownerRevision = 1): EffectFrameHistoryContext =>
    ({ scopeId: 'feedback-probe', eventRevision, ownerRevision, ...(discontinuity ? { discontinuity } : {}) });
  const expected = (input: number[], history: number[]) => input.map((value, channel) => Math.round(channel === 3
    ? Math.max(value, history[channel] * decay)
    : value * .96 + history[channel] * decay * .04));
  let checks = 0;
  const render = async (label: string, input: number[], time: number, metadata: EffectFrameHistoryContext, history: number[]) => {
    device.queue.writeTexture({ texture: source }, new Uint8Array(input), {}, [1, 1]);
    const encoder = device.createCommandEncoder();
    pipeline.applyEffects(encoder, [effect], sampler, source.createView(), pingView, pingView, pongView,
      1, 1, ping, pong, undefined, time, metadata);
    encoder.copyTextureToBuffer({ texture: ping }, { buffer: readback, bytesPerRow: 256 }, [1, 1]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const actual = Array.from(new Uint8Array(readback.getMappedRange()).slice(0, 4));
    readback.unmap();
    const wanted = expected(input, history);
    if (actual.some((value, channel) => value !== wanted[channel])) {
      throw new Error(`${label}: actual=${actual}; expected=${wanted}`);
    }
    checks++;
    return actual;
  };
  const clear = [0, 0, 0, 0], bright = [180, 120, 60, 200], dark = [30, 40, 50, 80];
  try {
    await render('initial', bright, 0, context(0), clear);
    await render('held frame', bright, 0, context(0), clear);
    const edited = await render('changed source at held time', dark, 0, context(0), clear);
    const advanced = await render('advance latest held output', bright, 1, context(0), edited);
    await render('repeat advanced frame', bright, 1, context(0), edited);
    await render('forward seek', bright, 3, context(1, 'seek'), clear);
    await render('seek event consumed once', bright, 3, context(1, 'seek'), clear);
    await render('reset loop', bright, 0, context(2, 'loop'), clear);
    effect.params.historyLoop = 'continuous';
    const beforeLoop = await render('continuous seed', bright, 1, context(2, 'loop'), expected(bright, clear));
    const looped = await render('continuous loop', dark, 0, context(3, 'loop'), beforeLoop);
    await render('continuous loop held', dark, 0, context(3, 'loop'), beforeLoop);
    if (looped.every((value, channel) => value === expected(dark, clear)[channel]) || advanced[3] !== 200) {
      throw new Error('Feedback fixture did not exercise retained history.');
    }
    await render('owner edit', dark, 0, context(3, 'loop', 2), clear);
    await render('export begins empty', bright, 4, context(4, 'export-start', 2), clear);
    return checks;
  } finally {
    pipeline.destroy(); source.destroy(); ping.destroy(); pong.destroy(); readback.destroy();
  }
}
