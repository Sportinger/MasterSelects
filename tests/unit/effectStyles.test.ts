import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { effectEngineMembers } from '../../src/effects/effectCatalogGroups';
import { changeEffectStyle, effectStyleGroups, effectStyleOptions, forgetEffectStyleOrigins, hideOtherStyleLanes } from '../../src/services/effects/effectStyles';
import { useTimelineStore } from '../../src/stores/timeline';
import { getHistoryStateView, initHistoryStoreRefs, setHistoryCallbacks } from '../../src/stores/historyStore';
import { createMockClip, createMockTrack } from '../helpers/mockData';

beforeEach(() => {
  setHistoryCallbacks({ flushPendingCapture: () => undefined, suppressCaptures: () => undefined });
  initHistoryStoreRefs({ timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
    media: { getState: () => ({ files: [], compositions: [], folders: [], selectedIds: [], expandedFolderIds: [], textItems: [], solidItems: [], mathSceneItems: [], motionShapeItems: [], signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [] }), setState: () => undefined },
    dock: { getState: () => ({ layout: null }), setState: () => undefined } });
  getHistoryStateView().clearHistory();
});
afterEach(() => {
  getHistoryStateView().clearHistory();
  forgetEffectStyleOrigins();
  useTimelineStore.setState({ clips: [], tracks: [], isExporting: false, clipKeyframes: new Map() });
});

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
  it('switches the look in place and keeps the ID, the values of controls in the same role and the position', () => {
    setup();
    changeEffectStyle('style-clip', 'fx', 'riso');
    const [effect] = useTimelineStore.getState().clips[0].effects;
    // Amount, Angle and the inks (Riso's Dark Ink and Warm Ink are Ink and Paper) carry; Registration is not a cell size.
    expect(effect).toMatchObject({ id: 'fx', type: 'riso', name: 'riso', enabled: true,
      params: { amount: 0.7, angle: 30, scale: 8, colorA: '#101010', colorB: '#f0f0f0' } });
    changeEffectStyle('style-clip', 'fx', 'halftone');
    expect(fx().params).toMatchObject({ colorA: '#101010', colorB: '#f0f0f0', scale: 14 });
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
    // and its Band Size is Scale under another name, so it keeps 12.
    expect(effect.params).toMatchObject({ shape: 'diamond', speed: 1, scale: 12, angle: 30 });
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

  it('starts a control in another role at the new default, removes its keyframes and says so (Halftone Scale 60 -> CRT Screen)', () => {
    setupLook('halftone', { scale: 60, amount: 0.75, angle: 0, colorA: '#111827', colorB: '#f8fafc' }, [key('k1', 'scale', 0, 20), key('k2', 'scale', 1, 70)]);
    const notes = changeEffectStyle('style-clip', 'fx', 'crt-screen');
    // Mask Density (a stripe width) is not Scale (a cell size); the untouched Amount opens at CRT Screen's Mix default.
    expect(fx().params).toMatchObject({ scale: 3, amount: 1, angle: 0, colorA: '#111827' });
    expect(keysOf()).toEqual([]);
    expect(notes[0]).toBe('CRT Screen has no Scale: Mask Density starts at its default (Undo brings back Scale and its keyframes).');
    // The note's promise holds: one undo step brings back the look, Scale 60 and both keyframes.
    getHistoryStateView().undo();
    expect(fx()).toMatchObject({ type: 'halftone', params: { scale: 60 } });
    expect(keysOf().map(keyframe => [keyframe.id, keyframe.value])).toEqual([['k1', 20], ['k2', 70]]);
  });

  it('says nothing about controls the user never touched (Halftone at its defaults -> Crystal Glass, CRT Screen and back)', () => {
    setupLook('halftone', { scale: 14, amount: 0.75, angle: 0, colorA: '#111827', colorB: '#f8fafc' });
    expect(changeEffectStyle('style-clip', 'fx', 'crystal')).toEqual([]);
    expect(fx().params).toMatchObject({ scale: 14, amount: 0.3 });
    setupLook('halftone', { scale: 14, amount: 0.75, angle: 0, colorA: '#111827', colorB: '#f8fafc' });
    expect(changeEffectStyle('style-clip', 'fx', 'crt-screen')).toEqual([]);
    expect(changeEffectStyle('style-clip', 'fx', 'halftone')).toEqual([]);
    expect(fx().params).toMatchObject({ scale: 14, amount: 0.75 });
  });

  it('names node graph edits it resets', () => {
    setup();
    expect(changeEffectStyle('style-clip', 'fx', 'riso')).toContain('Your node graph edits were reset (Undo brings them back).');
    expect(changeEffectStyle('style-clip', 'fx', 'halftone')).not.toContain('Your node graph edits were reset (Undo brings them back).');
  });

  it('gives Riso Glow the Registration of Riso, and Contour Map a band count instead of a cell size', () => {
    setupLook('riso', { scale: 20, amount: 0.75, colorA: '#2046b3', colorB: '#ef476f' }, [key('k1', 'scale', 0, 10), key('k2', 'scale', 1, 30)]);
    expect(changeEffectStyle('style-clip', 'fx', 'riso-glow')).toEqual([]);
    expect(fx().params.scale).toBe(20);
    expect(keysOf().map(keyframe => keyframe.id)).toEqual(['k1', 'k2']);
    for (const look of ['riso-glow', 'contour-map']) {
      setupLook('halftone', { scale: 60, amount: 0.75, angle: 0, colorA: '#111827', colorB: '#f8fafc' });
      const notes = changeEffectStyle('style-clip', 'fx', look);
      expect(fx().params.scale).toBe(14);
      expect(notes[0]).toMatch(/has no Scale: (Registration|Band Density) starts at its default/u);
    }
  });

  it('never gives two looks the same label for a key that means something else (the note would read "has no Scale: Scale")', () => {
    for (const engine of ['two-tone-pattern', 'glyph-mosaic', 'tracking-overlay']) {
      const members = effectEngineMembers(engine);
      for (const a of members) for (const b of members) for (const [key, param] of Object.entries(getEffect(a)?.params ?? {})) {
        const other = getEffect(b)?.params[key];
        if (other && other.styleRole !== param.styleRole) expect(`${b} ${key}: ${other.label}`).not.toBe(`${b} ${key}: ${param.label}`);
      }
    }
  });

  it('opens a value kept through looks without the control at the default of the look it comes to (Pattern Halftone -> Riso -> Tone Geometry)', () => {
    setupLook('pattern-halftone', { scale: 14, amount: 0.75, angle: 0, colorA: '#111827', colorB: '#f8fafc', shape: 'circle' });
    changeEffectStyle('style-clip', 'fx', 'riso');
    changeEffectStyle('style-clip', 'fx', 'tone-geometry');
    expect(fx().params.shape).toBe('square');
    // A Shape the user picked (circle is not Tone Geometry's default) comes back.
    useTimelineStore.getState().updateClipEffect('style-clip', 'fx', { shape: 'circle' });
    changeEffectStyle('style-clip', 'fx', 'riso');
    changeEffectStyle('style-clip', 'fx', 'tone-geometry');
    expect(fx().params.shape).toBe('circle');
    // Also through a look whose default it happens to be.
    changeEffectStyle('style-clip', 'fx', 'pattern-halftone');
    changeEffectStyle('style-clip', 'fx', 'tone-geometry');
    expect(fx().params.shape).toBe('circle');
  });

  it('keeps a value the user set on a round trip through a look whose default it equals', () => {
    setupLook('halftone', { scale: 14, amount: 0.3, angle: 0, colorA: '#111827', colorB: '#f8fafc' });
    changeEffectStyle('style-clip', 'fx', 'wave-lines');
    changeEffectStyle('style-clip', 'fx', 'halftone');
    expect(fx().params.amount).toBe(0.3);
    setupLook('ascii', { cellSize: 22, rampPreset: 'standard' });
    changeEffectStyle('style-clip', 'fx', 'word-mosaic');
    changeEffectStyle('style-clip', 'fx', 'ascii');
    expect(fx().params.cellSize).toBe(22);
  });

  it('opens an untouched control at the new look default and carries a changed one', () => {
    // ASCII at its defaults -> Matrix Rain: its own glyph set; the Cell Size of both is 14.
    setupLook('ascii', { cellSize: 14, rampPreset: 'standard' });
    changeEffectStyle('style-clip', 'fx', 'matrix');
    expect(fx().params).toMatchObject({ cellSize: 14, rampPreset: 'symbols' });
    setupLook('ascii', { cellSize: 14, rampPreset: 'standard' });
    changeEffectStyle('style-clip', 'fx', 'word-mosaic');
    expect(fx().params.cellSize).toBe(22);
    // Halftone at its defaults -> Wave Lines opens at Amount 0.3; a changed Amount (0.5) carries.
    setupLook('halftone', { scale: 14, amount: 0.75, angle: 0, colorA: '#111827', colorB: '#f8fafc' });
    changeEffectStyle('style-clip', 'fx', 'wave-lines');
    expect(fx().params.amount).toBe(0.3);
    setupLook('halftone', { scale: 14, amount: 0.5, angle: 0, colorA: '#111827', colorB: '#f8fafc' });
    changeEffectStyle('style-clip', 'fx', 'wave-lines');
    expect(fx().params.amount).toBe(0.5);
    // A keyed control at the old default keeps its value and keyframes.
    setupLook('halftone', { scale: 14, amount: 0.75, angle: 0, colorA: '#111827', colorB: '#f8fafc' }, [key('k1', 'amount', 0, 0.2)]);
    changeEffectStyle('style-clip', 'fx', 'wave-lines');
    expect(fx().params.amount).toBe(0.75);
    expect(keysOf()).toHaveLength(1);
  });

  it('carries Drift Lines Band Size with its keyframes into another look, but not Drift, which is a distance there and a mix elsewhere', () => {
    setupLook('drift-lines', { scale: 30, amount: 0.4, angle: 0, colorA: '#111827', colorB: '#f8fafc', speed: 1 },
      [key('k1', 'scale', 0, 20), key('k2', 'amount', 1, 0.6)]);
    const notes = changeEffectStyle('style-clip', 'fx', 'glitch-grid');
    expect(fx().params).toMatchObject({ scale: 30, amount: 0.75 });
    expect(keysOf().map(keyframe => keyframe.id)).toEqual(['k1']);
    expect(notes).toEqual(['Glitch Grid has no Drift: Amount starts at its default (Undo brings back Drift and its keyframes).']);
  });

  it('opens Halftone at its own Amount after the Heat Haze preset of Drift Lines and names it', () => {
    setupLook('drift-lines', { scale: 3, amount: 0.05, angle: 0, colorA: '#111827', colorB: '#f8fafc', speed: 0.6 });
    const notes = changeEffectStyle('style-clip', 'fx', 'halftone');
    expect(fx().params).toMatchObject({ scale: 3, amount: 0.75 });
    expect(notes).toContain('Halftone has no Drift: Amount starts at its default (Undo brings back Drift).');
  });

  it('judges a value kept from an earlier look by its role: Drift Lines -> Halftone -> Crystal is Drift Lines -> Crystal', () => {
    const run = (path: string[]) => {
      setupLook('drift-lines', { scale: 30, amount: 0.4, angle: 0, colorA: '#111827', colorB: '#f8fafc', speed: 2 },
        [key('k1', 'speed', 0, 1), key('k2', 'speed', 1, 3)]);
      for (const type of path) changeEffectStyle('style-clip', 'fx', type);
      return { params: fx().params, keys: keysOf().map(keyframe => keyframe.id) };
    };
    const direct = run(['crystal']);
    expect(run(['halftone', 'crystal'])).toEqual(direct);
    // Shimmer Speed is Speed; Facets count the facets and Refraction is not Amount.
    expect(direct.params).toMatchObject({ speed: 2, scale: 14, amount: 0.3 });
    expect(direct.keys).toEqual(['k1', 'k2']);
  });

  it('names a control a node drives and leaves its value to the node', () => {
    setupLook('halftone', { scale: 14, amount: 0.75, angle: 0, colorA: '#111827', colorB: '#f8fafc' });
    const clip = useTimelineStore.getState().clips[0];
    useTimelineStore.setState({ clips: [{ ...clip, nodeGraph: { version: 1, nodes: [], parameterSources: { version: 1, clipTimeOffset: 0,
      graph: { version: 1, nodes: [], edges: [], layout: {} }, targets: { 'effect.fx.amount': { source: { nodeId: 'lfo', portId: 'value' } } } } } } as never] });
    const notes = changeEffectStyle('style-clip', 'fx', 'wave-lines');
    expect(fx().params.amount).toBe(0.75);
    expect(notes).toContain('Amount stays driven by its node.');
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
