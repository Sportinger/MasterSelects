// Entrance for nodes added one at a time (by the user or the AI agent): a
// damped spring scales the card up from its centre with a slight overshoot,
// width and height wobble out of phase, and a soft ring breathes outward once.
// Pure math per frame, so it runs in the canvas worker without allocations
// beyond the returned frame.
export const NODE_POP_MS = 540;
/** Larger simultaneous additions keep the cheaper build-up wave. */
export const MAX_POP_NODES = 6;

export interface NodePopFrame { scaleX: number; scaleY: number; alpha: number; ringAlpha: number; ringSpread: number }

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** t: linear entrance progress 0..1. */
export function nodePopFrame(t: number): NodePopFrame {
  const decay = Math.exp(-5.5 * t), wave = 2.4 * Math.PI * t;
  // Starts at 38%, overshoots ~6% near t=0.42 and settles within a hair of 1.
  const scale = 1 - 0.62 * decay * Math.cos(wave);
  // Stretches wide first, then briefly tall, like a drop settling.
  const squash = 0.08 * decay * Math.sin(wave * 1.35);
  const fade = clamp01(t / 0.3);
  const ring = clamp01((t - 0.12) / 0.62);
  return {
    scaleX: scale * (1 + squash), scaleY: scale * (1 - squash),
    alpha: 1 - (1 - fade) ** 2,
    ringAlpha: ring > 0 && ring < 1 ? 0.5 * (1 - ring) ** 2 : 0,
    ringSpread: 2 + 14 * (1 - (1 - ring) ** 3),
  };
}
