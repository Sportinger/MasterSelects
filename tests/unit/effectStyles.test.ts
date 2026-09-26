import { afterEach, describe, expect, it } from 'vitest';
import { changeEffectStyle } from '../../src/services/effects/effectStyles';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

afterEach(() => useTimelineStore.setState({ clips: [], tracks: [], isExporting: false }));

function setup(locked = false) {
  const clip = createMockClip({ id: 'style-clip', effects: [
    { id: 'fx', type: 'halftone', name: 'halftone', enabled: true, params: { scale: 12, amount: 0.7, angle: 30, colorA: '#101010', colorB: '#f0f0f0', operatorGraph: '{}' } },
  ] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId, locked })], isExporting: false });
}

describe('effect styles', () => {
  it('switches the look in place and keeps the ID, values and position', () => {
    setup();
    changeEffectStyle('style-clip', 'fx', 'riso');
    const [effect] = useTimelineStore.getState().clips[0].effects;
    expect(effect).toMatchObject({ id: 'fx', type: 'riso', name: 'riso', enabled: true,
      params: { scale: 12, amount: 0.7, angle: 30, colorA: '#101010', colorB: '#f0f0f0' } });
    // A saved node graph belongs to the previous look.
    expect(effect.params.operatorGraph).toBeUndefined();
    expect(effect.operatorGraph).toBeUndefined();
  });

  it('rejects looks with other parameters and locked tracks', () => {
    setup();
    expect(() => changeEffectStyle('style-clip', 'fx', 'chroma-key')).toThrow(/not a style/);
    setup(true);
    expect(() => changeEffectStyle('style-clip', 'fx', 'riso')).toThrow(/locked/);
    expect(useTimelineStore.getState().clips[0].effects[0].type).toBe('halftone');
  });
});
