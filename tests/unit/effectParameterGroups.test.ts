import { describe, expect, it } from 'vitest';
import { groupEffectParameters } from '../../src/effects/parameterGroups';

describe('groupEffectParameters', () => {
  it('keeps declaration order while collecting named and quality sections', () => {
    const groups = groupEffectParameters({
      amount: { type: 'number', label: 'Amount', default: 1, group: 'Style' },
      scale: { type: 'number', label: 'Scale', default: 2, group: 'Style' },
      tint: { type: 'color', label: 'Tint', default: '#fff', group: 'Color' },
      samples: { type: 'number', label: 'Samples', default: 4, group: 'Ignored', quality: true },
    });

    expect(groups.map((group) => group.label)).toEqual(['Style', 'Color', 'Quality']);
    expect(groups[0].params.map(([key]) => key)).toEqual(['amount', 'scale']);
    expect(groups[2].quality).toBe(true);
  });
});
