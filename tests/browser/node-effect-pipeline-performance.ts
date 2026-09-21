import { EffectsPipeline } from '../../src/effects/EffectsPipeline';
import { EFFECT_REGISTRY } from '../../src/effects';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import type { Effect } from '../../src/types/effects';

/** Exercise the real fullscreen EffectsPipeline with warmed pipelines and no
 * node preview requests. The alias selects its original registered-shader path
 * only in this isolated page; no editor registry or project is touched. */
export async function measureEffectPipelineCpu(device: GPUDevice, definition: FullscreenEffectDefinition,
  params: Record<string, number | boolean | string>, summarize: (values: number[]) => unknown) {
  const width = 1920, height = 1080, alias = `benchmark-original-${definition.id}`;
  if (EFFECT_REGISTRY.has(alias)) throw new Error(`Benchmark alias already exists: ${alias}`);
  const oldDefinition = { ...definition, id: alias, packUniforms: (values: Record<string, number | boolean | string>, w: number, h: number) => {
    const uniforms = definition.packUniforms(values, w, h, 2.125);
    if (definition.id === 'holo' && uniforms) uniforms[5] = 2.125;
    return uniforms;
  } };
  EFFECT_REGISTRY.set(alias, oldDefinition);
  const textures = Array.from({ length: 3 }, () => device.createTexture({ size: [width, height], format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST }));
  const [input, ping, pong] = textures.map(texture => texture.createView());
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const effect: Effect = { id: `benchmark-${definition.id}`, type: definition.id as Effect['type'], name: definition.name, enabled: true, params,
    operatorGraph: effectOperatorGraph({ type: definition.id, params }) };
  const variants = [
    // This deliberately registered test-only alias is outside the product EffectType union.
    { name: 'legacy', effect: { ...effect, type: alias as Effect['type'], operatorGraph: undefined }, runtime: new EffectsPipeline(device), samples: [] as number[] },
    { name: 'nodes', effect, runtime: new EffectsPipeline(device), samples: [] as number[] },
  ];
  try {
    for (const variant of variants) await variant.runtime.createPipelines();
    const encode = (variant: typeof variants[number], record: boolean) => {
      const encoder = device.createCommandEncoder();
      const start = performance.now();
      const result = variant.runtime.applyEffects(encoder, [variant.effect], sampler, input, ping, ping, pong,
        width, height, textures[1], textures[2], undefined, 2.125);
      const elapsed = performance.now() - start;
      if (!result.swapped || result.finalView === input) throw new Error(`${definition.id}/${variant.name} skipped its effect`);
      if (record) variant.samples.push(elapsed);
      device.queue.submit([encoder.finish()]);
    };
    for (let warm = 0; warm < 10; warm++) { for (const variant of variants) encode(variant, false); await device.queue.onSubmittedWorkDone(); }
    for (let round = 0; round < 60; round++) {
      for (const variant of round % 2 ? variants.toReversed() : variants) encode(variant, true);
      await device.queue.onSubmittedWorkDone();
    }
    return { effect: definition.id, width, height, path: 'Actual fullscreen EffectsPipeline.applyEffects, stable graph and params, no node previews',
      variants: variants.map(variant => ({ name: variant.name, cpuMsPerFrame: summarize(variant.samples), pipelines: variant.runtime.getPipelineCount() })) };
  } finally { variants.forEach(variant => variant.runtime.destroy()); textures.forEach(texture => texture.destroy()); EFFECT_REGISTRY.delete(alias); }
}
