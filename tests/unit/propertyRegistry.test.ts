import { describe, expect, it } from 'vitest';
import type { ClipTransform, SerializableClip, TimelineClip } from '../../src/types';
import { createDefaultMotionLayerDefinition } from '../../src/types/motionDesign';
import { PropertyRegistry } from '../../src/services/properties/PropertyRegistry';
import { registerCoreProperties } from '../../src/services/properties/registerCoreProperties';

function makeTransform(overrides?: Partial<ClipTransform>): ClipTransform {
  return {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

function makeClip(overrides?: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'video-1',
    name: 'Clip',
    file: new File([], 'clip.dat'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video', naturalDuration: 5 },
    transform: makeTransform(),
    effects: [],
    isLoading: false,
    ...overrides,
  };
}

function createRegistry(): PropertyRegistry {
  return registerCoreProperties(new PropertyRegistry());
}

describe('PropertyRegistry', () => {
  it('describes and writes transform properties without mutating the source clip', () => {
    const registry = createRegistry();
    const clip = makeClip({ transform: makeTransform({ position: { x: 12, y: 0, z: 0 } }) });

    const descriptor = registry.getDescriptor('position.x', clip);
    expect(descriptor?.label).toBe('Position X');
    expect(registry.readValue(clip, 'position.x')).toBe(12);

    const updated = registry.writeValue<number>(clip, 'position.x', 42);
    expect(updated.transform.position.x).toBe(42);
    expect(clip.transform.position.x).toBe(12);
  });

  it('searches registered labels and aliases', () => {
    const registry = createRegistry();
    const matches = registry.search({ query: 'alpha' });

    expect(matches.some((descriptor) => descriptor.path === 'opacity')).toBe(true);
  });

  it('resolves effect instance parameters from the current clip', () => {
    const registry = createRegistry();
    const clip = makeClip({
      effects: [
        {
          id: 'fx-1',
          type: 'brightness',
          name: 'Brightness',
          enabled: true,
          params: { amount: 0.25 },
        },
      ],
    });

    const descriptor = registry.getDescriptor('effect.fx-1.amount', clip);
    expect(descriptor?.label).toBe('Amount');
    expect(descriptor?.group).toBe('Effects / Brightness');
    expect(registry.readValue(clip, 'effect.fx-1.amount')).toBe(0.25);

    const updated = registry.writeValue<number>(clip, 'effect.fx-1.amount', 0.75);
    expect(updated.effects[0].params.amount).toBe(0.75);
    expect(clip.effects[0].params.amount).toBe(0.25);
  });

  it('describes and writes motion shape and appearance properties', () => {
    const registry = createRegistry();
    const motion = createDefaultMotionLayerDefinition('shape', {
      size: { w: 200, h: 100 },
      fillColor: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
    });
    const fillId = motion.appearance?.items[0].id;
    const clip = makeClip({
      source: { type: 'motion-shape', naturalDuration: 5 },
      motion,
    });

    expect(registry.readValue(clip, 'shape.size.w')).toBe(200);
    const resized = registry.writeValue<number>(clip, 'shape.size.w', 640);
    expect(resized.motion?.shape?.size.w).toBe(640);
    expect(clip.motion?.shape?.size.w).toBe(200);

    expect(fillId).toBeDefined();
    const colorPath = `appearance.${fillId}.color.r`;
    expect(registry.getDescriptor(colorPath, clip)?.label).toBe('Fill R');
    const recolored = registry.writeValue<number>(clip, colorPath, 0.9);
    const recoloredFill = recolored.motion?.appearance?.items[0];
    expect(recoloredFill?.kind).toBe('color-fill');
    if (recoloredFill?.kind === 'color-fill') {
      expect(recoloredFill.color.r).toBe(0.9);
    }
  });

  it('keeps motion definitions JSON-serializable on clips', () => {
    const motion = createDefaultMotionLayerDefinition('shape', {
      primitive: 'ellipse',
      size: { w: 320, h: 240 },
    });
    const clip: SerializableClip = {
      id: 'motion-clip',
      trackId: 'video-1',
      name: 'Ellipse',
      mediaFileId: '',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      sourceType: 'motion-shape',
      transform: makeTransform(),
      effects: [],
      motion,
    };

    const restored: SerializableClip = JSON.parse(JSON.stringify(clip));
    expect(restored.motion?.version).toBe(1);
    expect(restored.motion?.kind).toBe('shape');
    expect(restored.motion?.shape?.primitive).toBe('ellipse');
    expect(restored.motion?.appearance?.items).toHaveLength(1);
  });
});
