import type { CSSProperties } from 'react';

export type AudioPanSliderStyle = CSSProperties & {
  '--pan-fill-start'?: string;
  '--pan-fill-end'?: string;
};

function clampPan(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export function getAudioPanSliderStyle(pan: number): AudioPanSliderStyle {
  const clamped = clampPan(pan);
  const position = 50 + clamped * 50;
  return {
    '--pan-fill-start': `${Math.min(50, position)}%`,
    '--pan-fill-end': `${Math.max(50, position)}%`,
  };
}
