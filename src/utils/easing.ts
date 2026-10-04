import type { EasingType } from '../types';

const EASING_ALIASES: Record<string, EasingType> = {
  linear: 'linear',
  easein: 'ease-in',
  easeout: 'ease-out',
  easeinout: 'ease-in-out',
  easeinelastic: 'ease-in',
  easeoutelastic: 'ease-out',
  easeinoutelastic: 'ease-in-out',
  bezier: 'bezier',
};

/** 'hold' (also 'step' or 'constant') keeps a keyframe's value until the next key: stored as `hold: true`. */
export function isHoldEasing(easing: string | null | undefined): boolean {
  return typeof easing === 'string' && /^(hold|step|constant)$/i.test(easing.trim());
}

export function normalizeEasingType(
  easing: string | null | undefined,
  fallback: EasingType = 'linear'
): EasingType {
  if (!easing) return fallback;

  const compact = easing
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

  return EASING_ALIASES[compact] ?? fallback;
}
