import { describe, expect, it } from 'vitest';

import {
  applyMotionAppearancePreset,
  createMotionAppearancePreset,
  parseMotionAppearancePreset,
  serializeMotionAppearancePreset,
} from '../../src/services/motionDesign/appearancePresets';
import {
  createDefaultMotionLayerDefinition,
  createLinearGradientAppearance,
  createStrokeAppearance,
  type TextureFillAppearance,
} from '../../src/types/motionDesign';

describe('Motion appearance presets', () => {
  it('serializes media-free stacks and applies them with collision-free stable ids', () => {
    const motion = createDefaultMotionLayerDefinition('shape');
    const gradient = createLinearGradientAppearance();
    const stroke = {
      ...createStrokeAppearance(),
      visible: true,
      width: 8,
      alignment: 'outside' as const,
    };
    const sourceAppearance = {
      version: 1 as const,
      items: [gradient, stroke],
      selectedItemId: stroke.id,
    };
    const preset = createMotionAppearancePreset(
      sourceAppearance,
      'Brand Plate',
      'preset-brand-plate',
    );
    const parsed = parseMotionAppearancePreset(
      serializeMotionAppearancePreset(preset),
    );
    const applied = applyMotionAppearancePreset(motion, parsed);

    expect(parsed).toEqual(preset);
    expect(applied.motion.appearance?.items.map((item) => item.kind)).toEqual([
      'linear-gradient',
      'stroke',
    ]);
    expect(applied.appearanceIdMap[gradient.id]).toBeTruthy();
    expect(applied.appearanceIdMap[gradient.id]).not.toBe(gradient.id);
    expect(Object.keys(applied.gradientStopIdMap)).toHaveLength(2);
    expect(applied.motion.appearance?.items[0].id).not.toBe(gradient.id);
    const appliedGradient = applied.motion.appearance?.items[0];
    if (appliedGradient?.kind === 'linear-gradient') {
      expect(appliedGradient.stops.map((stop) => stop.id))
        .not.toEqual(gradient.stops.map((stop) => stop.id));
    }
  });

  it('rejects media-backed texture fills', () => {
    const texture: TextureFillAppearance = {
      id: 'texture-1',
      kind: 'texture-fill',
      name: 'Embedded Media',
      visible: true,
      opacity: 1,
      mediaFileId: 'media-1',
      fit: 'cover',
      transform: {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      },
    };

    expect(() => createMotionAppearancePreset({
      version: 1,
      items: [texture],
    }, 'Unsafe')).toThrow('cannot embed texture or media fills');
  });
});
