import { renderHostPort } from '../../../../render/renderHostPort';

/** Bounded dev probe. Times synchronous CPU work, not GPU execution. */
export async function measureRenderPhaseCosts(args: Record<string, unknown>) {
  const durationMs = Math.max(500, Math.min(10000, Number(args.durationMs) || 3000));
  return renderHostPort.measureRenderPhaseCosts(durationMs);
}
