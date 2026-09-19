import { describe, expect, it } from 'vitest';
import type { Keyframe } from '../../src/types/keyframes';
import type { FlockDefinition } from '../../src/types/flock';
import { createFlockProperty } from '../../src/types/flock';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import { moveFlockNode, setFlockNodeParam } from '../../src/services/flock/mutations/flockGraphMutations';
import {
  FLOCK_THUMBNAIL_PARTICLE_CAP,
  getFlockThumbnailKey,
  renderFlockThumbnailFrames,
  type FlockThumbnailClip,
} from '../../src/services/flock/flockThumbnail';

const OPTIONS = { frameCount: 2, width: 48, height: 27, particleCap: 250 };

function clipFor(definition: FlockDefinition, overrides: Partial<FlockThumbnailClip> = {}): FlockThumbnailClip {
  return { id: 'clip-flock-test', flock: definition, inPoint: 0, outPoint: 0.6, duration: 0.6, ...overrides };
}

function nodeId(definition: FlockDefinition, operator: string): string {
  const node = definition.nodes.find((candidate) => candidate.operator === operator);
  if (!node) throw new Error(`missing ${operator}`);
  return node.id;
}

function nonBackgroundPixels(rgba: Uint8ClampedArray): number {
  let count = 0;
  for (let index = 0; index < rgba.length; index += 4) {
    if (rgba[index] !== 10 || rgba[index + 1] !== 13 || rgba[index + 2] !== 19) count += 1;
  }
  return count;
}

describe('flock thumbnails', () => {
  it('renders deterministic frames for a definition', async () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const first = await renderFlockThumbnailFrames(clipFor(definition), [], OPTIONS);
    const second = await renderFlockThumbnailFrames(clipFor(definition), [], OPTIONS);
    expect(first).not.toBeNull();
    expect(first!.frames).toHaveLength(2);
    expect(first!.frames[0].rgba.length).toBe(48 * 27 * 4);
    expect(nonBackgroundPixels(first!.frames[1].rgba)).toBeGreaterThan(0);
    first!.frames.forEach((frame, index) => {
      expect(Array.from(frame.rgba)).toEqual(Array.from(second!.frames[index].rgba));
    });
    expect(first!.frames[0].sourceTime).toBeLessThan(first!.frames[1].sourceTime);
  });

  it('caps the simulated population and labels the result as limited', async () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const capped = await renderFlockThumbnailFrames(clipFor(definition), [], OPTIONS);
    expect(capped!.requestedParticles).toBe(4000);
    expect(capped!.simulatedParticles).toBeLessThanOrEqual(250);
    expect(capped!.limited).toBe(true);
    expect(FLOCK_THUMBNAIL_PARTICLE_CAP).toBeLessThanOrEqual(1500);
  });

  it('invalidates on behavior and keyframe changes but not on layout-only changes', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const rules = nodeId(definition, 'flock.rules');
    const baseKey = getFlockThumbnailKey(clipFor(definition), [], OPTIONS);
    expect(baseKey).toBeTruthy();

    const moved = moveFlockNode(definition, rules, { x: 1234, y: -99 });
    if (!moved.ok) throw new Error('move failed');
    expect(getFlockThumbnailKey(clipFor(moved.definition), [], OPTIONS)).toBe(baseKey);

    const changed = setFlockNodeParam(definition, rules, 'cohesion', 3.5);
    if (!changed.ok) throw new Error('param failed');
    expect(getFlockThumbnailKey(clipFor(changed.definition), [], OPTIONS)).not.toBe(baseKey);

    const keyframes: Keyframe[] = [{
      id: 'kf-1',
      clipId: 'clip-flock-test',
      time: 0.2,
      property: createFlockProperty(rules, 'cohesion'),
      value: 2,
      easing: 'linear',
    }];
    expect(getFlockThumbnailKey(clipFor(definition), keyframes, OPTIONS)).not.toBe(baseKey);
    expect(getFlockThumbnailKey(clipFor(definition, { outPoint: 0.9, duration: 0.9 }), [], OPTIONS)).not.toBe(baseKey);
  });

  it('returns null for invalid graphs and honours cancellation', async () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const broken = structuredClone(definition);
    broken.edges = broken.edges.filter((edge) => edge.to.port !== 'spawn');
    expect(getFlockThumbnailKey(clipFor(broken), [], OPTIONS)).toBeNull();
    expect(await renderFlockThumbnailFrames(clipFor(broken), [], OPTIONS)).toBeNull();
    expect(await renderFlockThumbnailFrames(clipFor(definition), [], OPTIONS, { shouldCancel: () => true })).toBeNull();
  });
});
