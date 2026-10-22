import { afterEach, describe, expect, it } from 'vitest';
import { changeEffectStyle, effectStyleGroups, effectStyleOptions, hideOtherStyleLanes } from '../../src/services/effects/effectStyles';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

afterEach(() => useTimelineStore.setState({ clips: [], tracks: [], isExporting: false, clipKeyframes: new Map() }));

const key = (id: string, param: string, time: number, value: number) => ({ id, clipId: 'style-clip', time, property: `effect.fx.${param}` as const, value, easing: 'linear' as const });
function setupLook(type: string, params: Record<string, unknown>, keyframes: ReturnType<typeof key>[] = []) {
  const clip = createMockClip({ id: 'style-clip', effects: [{ id: 'fx', type, name: type, enabled: true, params }] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], isExporting: false,
    clipKeyframes: new Map([['style-clip', keyframes]]) as never });
}
const fx = () => useTimelineStore.getState().clips[0].effects[0];
const keysOf = () => useTimelineStore.getState().clipKeyframes.get('style-clip') ?? [];

function setup(locked = false) {
  const clip = createMockClip({ id: 'style-clip', effects: [
    { id: 'fx', type: 'halftone', name: 'halftone', enabled: true, params: { scale: 12, amount: 0.7, angle: 30, colorA: '#101010', colorB: '#f0f0f0', operatorGraph: '{}' } },
  ] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId, locked })], isExporting: false });
}

describe('effect styles', () => {
  it('switches the look in place and keeps the ID, the values of controls with the same name and the position', () => {
    setup();
    changeEffectStyle('style-clip', 'fx', 'riso');
    const [effect] = useTimelineStore.getState().clips[0].effects;
    // Amount and Angle are the same controls; Riso's Registration, Dark Ink and Warm Ink are not Scale, Ink and Paper.
    expect(effect).toMatchObject({ id: 'fx', type: 'riso', name: 'riso', enabled: true,
      params: { amount: 0.7, angle: 30, scale: 8, colorA: '#2046b3', colorB: '#ef476f' } });
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
    // Drift Lines has no Shape: the stored choice stays for a switch back; its Speed starts at the default,
    // and its Band Size is another control than Scale, so it starts at its default too.
    expect(effect.params).toMatchObject({ shape: 'diamond', speed: 1, scale: 14, angle: 30 });
    changeEffectStyle('style-clip', 'fx', 'pattern-halftone');
    expect(useTimelineStore.getState().clips[0].effects[0].params.shape).toBe('diamond');
    // Tone Geometry's Shape list has no diamond: it starts at its own default shape.
    changeEffectStyle('style-clip', 'fx', 'tone-geometry');
    expect(useTimelineStore.getState().clips[0].effects[0].params.shape).toBe('square');
  });

  it('lists the own picker group first and every group alphabetically, under its label', () => {
    const groups = effectStyleGroups('halftone');
    expect(groups[0].label).toBe('Print & Halftone');
    expect(groups[0].options.map(option => option.label)).toEqual(['Dither Studio', 'Dithering', 'Halftone', 'Paper Print', 'Pattern Halftone', 'Riso', 'Riso Glow', 'Tone Geometry']);
    for (const group of groups) expect(group.options.map(option => option.label)).toEqual(group.options.map(option => option.label).toSorted((a, b) => a.localeCompare(b)));
    expect(groups.map(group => group.label)).toEqual(expect.arrayContaining(['Lines & Engraving', 'Analog & Glitch']));
    expect(effectStyleOptions('halftone').map(option => option.value)).toEqual(groups.flatMap(group => group.options.map(option => option.value)));
  });

  it('starts a control with another name at the new default, removes its keyframes and says so (Halftone Scale 60 -> CRT Screen)', () => {
    setupLook('halftone', { scale: 60, amount: 0.75, angle: 0, colorA: '#111827', colorB: '#f8fafc' }, [key('k1', 'scale', 0, 20), key('k2', 'scale', 1, 70)]);
    const notes = changeEffectStyle('style-clip', 'fx', 'crt-screen');
    // Mask Density (1-12) is not Scale (2-80), and CRT's Mix is not Halftone's Amount: both start at CRT Screen's defaults.
    expect(fx().params).toMatchObject({ scale: 3, amount: 1, angle: 0, colorA: '#111827' });
    expect(keysOf()).toEqual([]);
    expect(notes.join(' ')).toMatch(/Mask Density and Mix start at CRT Screen's defaults \(other controls than Scale and Amount\)\. Their keyframes were removed/);
  });

  it('starts Drift Lines Band Size 60 as Dithering Pixel Size at its default', () => {
    setupLook('drift-lines', { scale: 60, amount: 0.75, angle: 0, colorA: '#111827', colorB: '#f8fafc', speed: 1 });
    changeEffectStyle('style-clip', 'fx', 'dither');
    expect(fx().params.scale).toBe(3);
  });

  it('brings a carried value and its keyframes into the new range and names them', () => {
    // Speed 9 and its keyframe at 7 were kept from an earlier look; Drift Lines' Speed runs 0-5.
    setupLook('halftone', { scale: 14, amount: 0.75, angle: 0, colorA: '#111827', colorB: '#f8fafc', speed: 9 }, [key('k1', 'speed', 0, 7), key('k2', 'speed', 1, 2)]);
    const notes = changeEffectStyle('style-clip', 'fx', 'tone-geometry');
    expect(fx().params.speed).toBe(5);
    expect(keysOf().map(keyframe => keyframe.value)).toEqual([5, 2]);
    expect(notes).toEqual(['Speed 9 → 5 (Tone Geometry range).', 'Speed keyframes brought into 0–5.']);
  });

  it('keeps the keyframes of a control the new look lacks, says so, and hides their lane', () => {
    setupLook('drift-lines', { scale: 14, amount: 0.75, angle: 0, colorA: '#111827', colorB: '#f8fafc', speed: 2 }, [key('k1', 'speed', 0, 1), key('k2', 'speed', 1, 3)]);
    const notes = changeEffectStyle('style-clip', 'fx', 'halftone');
    expect(fx().params.speed).toBe(2);
    expect(keysOf()).toHaveLength(2);
    expect(notes).toContain('Speed keeps its keyframes for a switch back; Halftone has no Speed.');
    const lanes = new Set(['effect.fx.speed', 'effect.fx.amount', 'opacity']);
    hideOtherStyleLanes(lanes, [{ id: 'fx', type: 'halftone' }]);
    expect([...lanes]).toEqual(['effect.fx.amount', 'opacity']);
    // Back on Drift Lines the lane is shown again.
    const back = new Set(['effect.fx.speed']);
    hideOtherStyleLanes(back, [{ id: 'fx', type: 'drift-lines' }]);
    expect([...back]).toEqual(['effect.fx.speed']);
  });
});
