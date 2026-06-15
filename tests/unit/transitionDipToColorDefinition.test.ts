import { describe, expect, it } from 'vitest';

import { dipToColor } from '../../src/transitions/dipToColor';

describe('dipToColor transition definition', () => {
  it('defines a serializable parametric dip-to-color recipe', () => {
    expect(dipToColor).toMatchObject({
      id: 'dip-to-color',
      name: 'Dip to Color',
      category: 'dissolve',
      defaultDuration: 2,
      minDuration: 0.1,
      maxDuration: 5.0,
      description: 'Fade out to a custom color, then fade the incoming clip up',
    });
    expect(dipToColor.params?.color).toEqual({
      type: 'color',
      label: 'Color',
      defaultValue: '#000000',
    });

    const serializedRecipe = JSON.parse(JSON.stringify(dipToColor.recipe));

    expect(serializedRecipe).toEqual([
      {
        kind: 'solid',
        color: '#000000',
        colorParam: 'color',
      },
      {
        kind: 'opacity',
        target: 'outgoing',
        from: 1,
        to: 0,
        startProgress: 0,
        endProgress: 0.5,
        curve: 'linear',
      },
      {
        kind: 'opacity',
        target: 'incoming',
        from: 0,
        to: 1,
        startProgress: 0.5,
        endProgress: 1,
        curve: 'linear',
      },
    ]);
  });
});
