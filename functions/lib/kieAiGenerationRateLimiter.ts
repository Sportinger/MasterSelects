import type { Env } from './env';

const GLOBAL_KIEAI_RATE_LIMITER_ID = 'global-kieai-generation-starts';

function getDelayMs(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('delayMs' in value)) {
    return null;
  }

  const delayMs = value.delayMs;
  return typeof delayMs === 'number' && Number.isFinite(delayMs) && delayMs >= 0
    ? Math.ceil(delayMs)
    : null;
}

/**
 * Reserves one globally paced Kie.ai task start. The Durable Object owns the
 * schedule; Pages only waits for its assigned slot before creating a task.
 */
export async function waitForHostedKieAiGenerationStart(env: Env): Promise<void> {
  const namespace = env.KIEAI_GENERATION_RATE_LIMITER;

  // Local Pages development has no remote Durable Object binding.
  if (!namespace) return;

  const limiter = namespace.get(namespace.idFromName(GLOBAL_KIEAI_RATE_LIMITER_ID));
  const response = await limiter.fetch('https://kieai-rate-limiter/reserve', { method: 'POST' });
  const payload: unknown = await response.json().catch(() => null);
  const delayMs = getDelayMs(payload);

  if (!response.ok || delayMs === null) {
    throw new Error('The hosted Kie.ai start scheduler is unavailable. Please retry.');
  }

  if (delayMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
}
