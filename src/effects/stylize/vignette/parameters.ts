import type { EffectParam } from '../../types';

const number = (label: string, defaultValue: number, min: number, max: number, extra: Partial<EffectParam> = {}): EffectParam => ({
  type: 'number', label, default: defaultValue, min, max, step: 0.01, animatable: true, ...extra,
} as EffectParam);

/** Shared by the fullscreen effect definition and its canonical graph (see vignetteModel.ts). */
export const VIGNETTE_PARAMS = {
  amount: number('Amount', 0.5, 0, 1),
  // Every corner sits at distance 1, so the slider ends there. The number field still takes up to
  // 1.5 (renderMax) for Vignettes saved before 2026-10-21, whose corners sit at about 1.41.
  size: number('Size', 0.5, 0, 1, { renderMax: 1.5 }),
  softness: number('Softness', 0.5, 0, 1),
  // 1 = circle, 0 = the frame's shape. Vignettes saved before 2026-10-21 keep their earlier
  // graph, where Roundness (0.5–2) stretched the frame-shaped ellipse vertically.
  roundness: number('Roundness', 1, 0, 1),
} satisfies Record<string, EffectParam>;
