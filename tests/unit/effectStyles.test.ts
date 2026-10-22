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

  it('rejects looks with other parameters and locked tracks', () => {
    setup();
    expect(() => changeEffectStyle('style-clip', 'fx', 'chroma-key')).toThrow(/not a style/);
    setup(true);
    expect(() => changeEffectStyle('style-clip', 'fx', 'riso')).toThrow(/locked/);
    expect(useTimelineStore.getState().clips[0].effects[0].type).toBe('halftone');
  });

  it('offers every look of the engine, also looks with their own controls', () => {
    const halftoneStyles = effectStyleOptions('halftone').map(option => option.value);
    expect(halftoneStyles).toEqual(expect.arrayContaining(['halftone', 'riso', 'pattern-halftone', 'dither-studio', 'tone-geometry', 'drift-lines']));
    // A moving look (Speed) and a look with a Shape list are styles of the still ones and back.
    expect(effectStyleOptions('drift-lines').map(option => option.value)).toContain('halftone');
    expect(effectStyleOptions('pattern-halftone').map(option => option.value)).toContain('riso');
    expect(effectStyleOptions('ascii').map(option => option.value)).toEqual(expect.arrayContaining(['matrix', 'glyph-matrix']));
    expect(effectStyleOptions('chroma-key')).toEqual([]);
  });

  it('starts controls only the new look has at their defaults and keeps the old look controls for a switch back', () => {
    setup();
    changeEffectStyle('style-clip', 'fx', 'pattern-halftone');
    let [effect] = useTimelineStore.getState().clips[0].effects;
    expect(effect.params).toMatchObject({ scale: 12, amount: 0.7, angle: 30, colorA: '#101010', shape: 'circle' });
    useTimelineStore.getState().updateClipEffect('style-clip', 'fx', { shape: 'diamond' });
    changeEffectStyle('style-clip', 'fx', 'drift-lines');
    [effect] = useTimelineStore.getState().clips[0].effects;
    // Drift Lines has no Shape: the stored choice stays for a switch back; its Speed starts at the default.
    expect(effect.params).toMatchObject({ shape: 'diamond', speed: 1, scale: 12 });
    changeEffectStyle('style-clip', 'fx', 'pattern-halftone');
    expect(useTimelineStore.getState().clips[0].effects[0].params.shape).toBe('diamond');
    // Tone Geometry's Shape list has no diamond: it starts at its own default shape.
    changeEffectStyle('style-clip', 'fx', 'tone-geometry');
    expect(useTimelineStore.getState().clips[0].effects[0].params.shape).toBe('square');
  });
});
