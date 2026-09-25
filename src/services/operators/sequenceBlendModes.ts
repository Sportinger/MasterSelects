import { BLEND_MODES, type BlendMode } from '../../types/blendMode';

// Keep the first five numeric values stable for saved Sequence Blend nodes.
const original = ['darken', 'lighten', 'multiply', 'screen', 'normal'] as const;
export const SEQUENCE_BLEND_MODES: readonly BlendMode[] = [...original, ...BLEND_MODES.filter(mode => !(original as readonly string[]).includes(mode))];
