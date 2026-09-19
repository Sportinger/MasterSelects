import { describe, expect, it } from 'vitest';
import { faceCableDescriptors } from '../../src/services/properties/faceCableProperties';
import { defaultFaceCable } from '../../src/services/faceCables/cableData';
import type { TimelineClip } from '../../src/types/timeline';
import type { Effect } from '../../src/types/effects';

it('discovers independent cable properties and writes only the selected cable', () => {
  const a = { ...defaultFaceCable(), id: 'a' }, b = { ...defaultFaceCable(), id: 'b' };
  const effect: Effect = { id: 'fx', type: 'face-cables', name: 'Face Cables', enabled: true, params: { settings: JSON.stringify([a, b]) } };
  const clip = { effects: [effect] } as TimelineClip;
  const descriptors = faceCableDescriptors(effect);
  expect(descriptors).toHaveLength(16);
  const slack = descriptors.find(d => d.path === 'effect.fx.cable_b_slack')!;
  expect(slack.animatable).toBe(true);
  const next = slack.write!(clip, 3, slack.path);
  expect(slack.read!(next, slack.path)).toBe(3);
  expect(JSON.parse(String(next.effects[0].params.settings))[0]).toEqual(a);
  expect(slack.read!(clip, slack.path)).toBe(b.slack);
});
describe('invalid cable settings', () => {
  it('does not expose properties for missing cables or malformed project data', () => {
    expect(faceCableDescriptors({ type: 'face-cables', params: { settings: '{' } } as Effect)).toEqual([]);
    expect(faceCableDescriptors({ type: 'face-cables', params: { settings: '[{}]' } } as Effect)).toEqual([]);
  });
});
