import { describe, expect, it } from 'vitest';

import { swirl } from '../../src/transitions/swirl';
import { waterDrop } from '../../src/transitions/waterDrop';

describe('distortion transition definitions', () => {
  it('defines Water Drop through the shared distortion primitive', () => {
    expect(waterDrop).toMatchObject({
      id: 'water-drop',
      name: 'Water Drop',
      category: 'stylize',
      defaultDuration: 1.2,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Radial ripple distortion expands through the cut',
    });
    expect(waterDrop.params?.seed).toMatchObject({
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 1_000_000,
      step: 1,
    });
    expect(JSON.parse(JSON.stringify(waterDrop.recipe))).toEqual(waterDrop.recipe);
    expect(waterDrop.recipe).toContainEqual({
      kind: 'distortion',
      target: 'incoming',
      distortion: 'water-drop',
    });
  });

  it('defines Swirl through the shared distortion primitive', () => {
    expect(swirl).toMatchObject({
      id: 'swirl',
      name: 'Swirl',
      category: 'stylize',
      defaultDuration: 1.15,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Center-weighted swirl distortion twists the cut',
    });
    expect(swirl.params?.seed).toMatchObject({
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 1_000_000,
      step: 1,
    });
    expect(JSON.parse(JSON.stringify(swirl.recipe))).toEqual(swirl.recipe);
    expect(swirl.recipe).toContainEqual({
      kind: 'distortion',
      target: 'outgoing',
      distortion: 'swirl',
    });
  });
});
