import { afterEach, describe, expect, it } from 'vitest';
import { changeEffectStyle, effectStyleOptions } from '../../src/services/effects/effectStyles';
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

  it('matches looks apart from a look\'s own controls, which start at their defaults and survive a switch back', () => {
    const clip = createMockClip({ id: 'style-clip', effects: [{ id: 'fx', type: 'glyph-matrix', name: 'glyph-matrix', enabled: true, params: { cellSize: 20, roll: .2 } }] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], isExporting: false });
    expect(effectStyleOptions('glyph-matrix').map(option => option.value)).toContain('retro-matrix');
    expect(effectStyleOptions('retro-matrix').map(option => option.value)).toContain('glyph-matrix');
    changeEffectStyle('style-clip', 'fx', 'retro-matrix');
    expect(useTimelineStore.getState().clips[0].effects[0].params).toMatchObject({ cellSize: 20, roll: .2, phosphor: '#ff8514', scanlines: .5 });
    changeEffectStyle('style-clip', 'fx', 'glyph-matrix');
    useTimelineStore.getState().updateClip('style-clip', { effects: useTimelineStore.getState().clips[0].effects.map(effect => ({ ...effect, params: { ...effect.params, phosphor: '#33ff66' } })) });
    changeEffectStyle('style-clip', 'fx', 'retro-matrix');
    expect(useTimelineStore.getState().clips[0].effects[0].params).toMatchObject({ cellSize: 20, phosphor: '#33ff66', scanlines: .5 });
  });

  it('rejects looks with other parameters and locked tracks', () => {
    setup();
    expect(() => changeEffectStyle('style-clip', 'fx', 'chroma-key')).toThrow(/not a style/);
    setup(true);
    expect(() => changeEffectStyle('style-clip', 'fx', 'riso')).toThrow(/locked/);
    expect(useTimelineStore.getState().clips[0].effects[0].type).toBe('halftone');
  });
});
