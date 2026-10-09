import { describe, expect, it } from 'vitest';
import type { ClipTransform, SerializableClip, TimelineClip } from '../../src/types';
import { createDefaultMotionLayerDefinition } from '../../src/types/motionDesign';
import { PropertyRegistry } from '../../src/services/properties/PropertyRegistry';
import { registerCoreProperties } from '../../src/services/properties/registerCoreProperties';
import { getEffectiveScale } from '../../src/utils/transformScale';

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
  it('discovers, resolves and writes saved instance-owned graph controls without leaking across effects', () => {
    const registry = createRegistry();
    const clip = makeClip({ effects: [{ id: 'weave-one', type: 'weave', name: 'Yarn', enabled: true,
      params: { unfold_value: 0.25 }, operatorGraph: { version: 1, domain: 'geometry', edges: [], layout: {},
        nodes: [{ id: 'unfold', operator: 'values.number', operatorVersion: 1,
          bindings: { value: 'unfold_value' }, constants: { value: 0 },
          exposed: { label: 'Unfold', min: 0, max: 1, step: 0.001 } }] } }] });
    const saved = JSON.parse(JSON.stringify(clip)) as TimelineClip;
    const path = 'effect.weave-one.unfold_value';
    const listed = registry.getAllDescriptors(saved).find(descriptor => descriptor.path === path);
    expect(listed).toMatchObject({ label: 'Unfold', animatable: true, valueType: 'number', defaultValue: 0,
      ui: { min: 0, max: 1, step: 0.001 } });
    expect(registry.getDescriptor(path, saved)?.path).toBe(listed?.path);
    expect(registry.readValue(saved, path)).toBe(0.25);
    const updated = registry.writeValue(saved, path, 0.8);
    expect(updated.effects[0].params.unfold_value).toBe(0.8);
    expect(saved.effects[0].params.unfold_value).toBe(0.25);
    expect(registry.getDescriptor('effect.weave-two.unfold_value', saved)).toBeUndefined();
    delete saved.effects[0].operatorGraph!.nodes[0].exposed;
    expect(registry.getDescriptor(path, saved)).toBeUndefined();
    expect(registry.getAllDescriptors(saved).some(descriptor => descriptor.path === path)).toBe(false);
  });

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

  it('writes scale.all as the uniform multiplier without overwriting axis scale', () => {
    const registry = createRegistry();
    const clip = makeClip({ transform: makeTransform({ scale: { x: 1, y: 1 } }) });

    const updated = registry.writeValue<number>(clip, 'scale.all', 2);

    expect(updated.transform.scale).toEqual({ x: 1, y: 1, all: 2 });
    expect(getEffectiveScale(updated.transform.scale)).toEqual({ x: 2, y: 2, z: 2 });
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
