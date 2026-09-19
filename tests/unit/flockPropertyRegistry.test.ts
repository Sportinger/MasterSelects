import { describe, expect, it } from 'vitest';
import type { ClipTransform, TimelineClip } from '../../src/types';
import type { FlockDefinition } from '../../src/types/flock';
import { PropertyRegistry } from '../../src/services/properties/PropertyRegistry';
import { registerCoreProperties } from '../../src/services/properties/registerCoreProperties';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import { createFlockGroupFromNodes } from '../../src/services/flock/mutations/flockGraphMutations';

function makeTransform(): ClipTransform {
  return {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

function makeFlockClip(flock: FlockDefinition): TimelineClip {
  return {
    id: 'clip-flock-1',
    trackId: 'video-1',
    name: 'Flock',
    file: new File([], 'flock.json'),
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    source: { type: 'flock', naturalDuration: 10 },
    flock,
    transform: makeTransform(),
    effects: [],
    isLoading: false,
    is3D: true,
  };
}

function nodeId(definition: FlockDefinition, operator: string): string {
  const node = definition.nodes.find((candidate) => candidate.operator === operator);
  if (!node) throw new Error(`missing ${operator}`);
  return node.id;
}

const registry = registerCoreProperties(new PropertyRegistry());

describe('flock property registry', () => {
  it('describes, reads and writes numeric node parameters without mutating the clip', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const clip = makeFlockClip(definition);
    const rulesId = nodeId(definition, 'flock.rules');
    const path = `flock.node.${rulesId}.cohesion`;

    const descriptor = registry.getDescriptor(path, clip);
    expect(descriptor).toMatchObject({
      label: 'Cohesion',
      group: 'Flock / Flock Rules',
      valueType: 'number',
      animatable: true,
      ui: { min: 0, max: 10 },
    });
    expect(registry.readValue(clip, path)).toBe(1);

    const updated = registry.writeValue<number>(clip, path, 2.5);
    expect(updated.flock?.nodes.find((node) => node.id === rulesId)?.params.cohesion).toBe(2.5);
    expect(clip.flock?.nodes.find((node) => node.id === rulesId)?.params.cohesion).toBe(1);
  });

  it('exposes vector components and 0..255 color channels', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const clip = makeFlockClip(definition);
    const emitterId = nodeId(definition, 'flock.emitter');
    const pointsId = nodeId(definition, 'flock.render-points');

    const centerX = `flock.node.${emitterId}.center.x`;
    expect(registry.getDescriptor(centerX, clip)?.label).toBe('Center X');
    const moved = registry.writeValue<number>(clip, centerX, 12);
    expect(moved.flock?.nodes.find((node) => node.id === emitterId)?.params.center).toEqual([12, 0, 0]);

    const red = `flock.node.${pointsId}.color.r`;
    expect(registry.getDescriptor(red, clip)?.ui).toMatchObject({ min: 0, max: 255, step: 1 });
    expect(registry.readValue(clip, red)).toBe(0x9f);
    const recolored = registry.writeValue<number>(clip, red, 255);
    expect(recolored.flock?.nodes.find((node) => node.id === pointsId)?.params.color).toBe('#ffd8ff');
  });

  it('keeps structural integers non-animatable and rejects unsupported paths', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const clip = makeFlockClip(definition);
    const emitterId = nodeId(definition, 'flock.emitter');
    const pointsId = nodeId(definition, 'flock.render-points');

    expect(registry.getDescriptor(`flock.node.${emitterId}.count`, clip)?.animatable).toBe(false);
    expect(registry.getDescriptor(`flock.node.${emitterId}.missing`, clip)).toBeUndefined();
    expect(registry.getDescriptor(`flock.node.${emitterId}.center`, clip)).toBeUndefined();
    expect(registry.getDescriptor(`flock.node.${pointsId}.shape`, clip)).toBeUndefined();
    expect(registry.getDescriptor(`flock.node.${emitterId}.count`, {
      ...clip,
      source: { type: 'video', naturalDuration: 10 },
    })).toBeUndefined();
  });

  it('enumerates all numeric flock paths and finds them by search', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const clip = makeFlockClip(definition);
    const rulesId = nodeId(definition, 'flock.rules');
    const emitterId = nodeId(definition, 'flock.emitter');
    const pointsId = nodeId(definition, 'flock.render-points');

    const paths = registry.getAllDescriptors(clip).map((descriptor) => descriptor.path).filter((path) => path.startsWith('flock.'));
    expect(paths).toEqual(expect.arrayContaining([
      `flock.node.${rulesId}.cohesion`,
      `flock.node.${emitterId}.count`,
      `flock.node.${emitterId}.center.x`,
      `flock.node.${emitterId}.center.z`,
      `flock.node.${pointsId}.color.g`,
    ]));
    expect(paths).not.toContain(`flock.node.${pointsId}.shape`);
    expect(new Set(paths).size).toBe(paths.length);

    const matches = registry.search({ clip, query: 'cohesion' }).map((descriptor) => descriptor.path);
    expect(matches).toContain(`flock.node.${rulesId}.cohesion`);
  });

  it('resolves group-instance override parameters on the group node', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const turbulenceId = nodeId(definition, 'flock.turbulence');
    const grouped = createFlockGroupFromNodes(definition, [turbulenceId], 'Swirl');
    if (!grouped.ok) throw new Error('group failed');
    const clip = makeFlockClip(grouped.definition);
    const path = `flock.node.${grouped.groupNodeId}.${turbulenceId}__strength`;

    const descriptor = registry.getDescriptor(path, clip);
    expect(descriptor?.group).toBe('Flock / Swirl');
    expect(registry.readValue(clip, path)).toBe(18);
    const updated = registry.writeValue<number>(clip, path, 7);
    expect(updated.flock?.nodes.find((node) => node.id === grouped.groupNodeId)?.params[`${turbulenceId}__strength`]).toBe(7);
    expect(registry.getAllDescriptors(clip).some((candidate) => candidate.path === path)).toBe(true);
  });
});
