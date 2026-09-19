import type { EngineResourceSet } from '../../engine/engineCore/engineResources';
import type { RenderPhaseCostProbeResult } from './renderHostTypes';

/** Temporarily instruments main-thread render resources for a bounded dev probe. */
export async function measureRenderPhaseCostsForResources(
  resources: EngineResourceSet | null,
  durationMs: number,
): Promise<RenderPhaseCostProbeResult> {
  if (!resources) return { success: false, error: 'Engine resources unavailable' };
  const entries: Array<{ name: string; calls: number; totalMs: number; maxMs: number }> = [];
  const restore: Array<() => void> = [];
  const instrument = (target: object | null, method: string, name: string) => {
    if (!target) return;
    const owner = target as Record<string, unknown>;
    const original = owner[method];
    if (typeof original !== 'function') return;
    const entry = { name, calls: 0, totalMs: 0, maxMs: 0 };
    entries.push(entry);
    const wrapped = function (...values: unknown[]) {
      const start = performance.now();
      try {
        return original.apply(target, values);
      } finally {
        const elapsed = performance.now() - start;
        entry.calls += 1;
        entry.totalMs += elapsed;
        entry.maxMs = Math.max(entry.maxMs, elapsed);
      }
    };
    owner[method] = wrapped;
    restore.push(() => {
      if (owner[method] === wrapped) owner[method] = original;
    });
  };

  instrument(resources.nestedCompRenderer, 'preRender', 'nested.preRender');
  instrument(resources.compositor, 'composite', 'compositor.composite');
  instrument(resources.effectsPipeline, 'applyEffects', 'effects.applyEffects');
  instrument(resources.maskTextureManager, 'updateMaskTexture', 'mask.upload');
  instrument(resources.motionRenderer, 'render', 'motion.render');
  instrument(resources.outputPipeline, 'updateResolution', 'output.resolution');
  const start = performance.now();
  try {
    await new Promise(resolve => setTimeout(resolve, durationMs));
  } finally {
    for (const reset of restore.toReversed()) reset();
  }
  return {
    success: true,
    data: {
      elapsedMs: performance.now() - start,
      note: 'Inclusive synchronous CPU times; nested rows overlap. No GPU timing.',
      entries: entries.toSorted((a, b) => b.totalMs - a.totalMs),
    },
  };
}
