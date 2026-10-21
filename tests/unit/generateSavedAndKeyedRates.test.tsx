// Generate effects saved before a parameter existed show what they render (legacyDefault), and keyed
// rates (Perspective Grid Speed, Color Wheel Spin) travel the same way on every render path: timeline,
// nested compositions, transition-mapped clips, node sources and tools.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultParams, getRenderedDefaultParams } from '../../src/effects';
import { colorWheel } from '../../src/effects/generate/colorWheel';
import { perspectiveGrid } from '../../src/effects/generate/perspectiveGrid';
import { toPrimitiveEffectParams } from '../../src/effects/_shared/effectUniformParams';
import { EffectsTab } from '../../src/components/panels/properties/EffectsTab';
import { evaluateCompositionClipEffects } from '../../src/services/compositionRender/keyframeEvaluation';
import { evaluateTransitionMappedAnimation } from '../../src/services/compositionRender/transitionMappedAnimation';
import { applyParameterSourcesToEffects } from '../../src/services/parameterSources/parameterSourceRendering';
import { executeAITool } from '../../src/services/aiTools';
import { useTimelineStore } from '../../src/stores/timeline';
import { getLegacyEffectKeyframeBaseValue } from '../../src/stores/timeline/keyframes/audioEffectKeyframeValues';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { createDefaultWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip, TransitionSourceMapV2 } from '../../src/types/timeline';

// Speed and Spin are not source targets today (no operator graph), so a binding would be rejected;
// the evaluator is stubbed to check the render guard for rates that become drivable.
vi.mock('../../src/services/parameterSources/parameterSourceEvaluation', async importOriginal => ({
  ...await importOriginal<object>(),
  createParameterSourceEvaluator: () => ({ resolve: () => ({ value: 3, kind: 'constant' }) }),
}));

type Params = Record<string, number | boolean | string>;
const SCROLL = 3;
const initial = useTimelineStore.getState();
afterEach(() => { cleanup(); vi.restoreAllMocks(); useTimelineStore.setState(initial); });

const key = (id: string, property: string, time: number, value: number) =>
  ({ id, clipId: 'gen', time, property, value, easing: 'linear' }) as Keyframe;
const grid = (params: Params = getDefaultParams('perspective-grid')): Effect =>
  ({ id: 'grid', name: 'Perspective Grid', type: 'perspective-grid', enabled: true, params });
const scrollOf = (effect: Effect, time: number) => perspectiveGrid.packUniforms(effect.params as Params, 1920, 1080, time)![SCROLL];
/** Shortest step between two wrapped scroll values (rows). */
const wrappedStep = (a: number, b: number) => { const step = (b - a + 1) % 1; return Math.min(step, 1 - step); };

describe('Saved generators in the inspector', () => {
  // As stored before Shape, Direction, Radius and Lines existed.
  const savedWheel: Effect = { id: 'old-wheel', type: 'color-wheel', name: 'Color Wheel', enabled: true,
    params: { rotation: 0, spin: 0, saturation: 1.2, value: 1, mix: 1 } };
  const savedGrid = grid({ horizon: 0.66, columns: 14, rows: 6, lineWidth: 0, speed: 1.5, offset: 0, color: '#2ee6ff', opacity: 0.16, fade: 1.4, blend: 'add' });

  it('fills missing parameters with the values they render', () => {
    const wheel = { ...getRenderedDefaultParams('color-wheel'), ...savedWheel.params };
    expect([wheel.shape, wheel.direction, wheel.radius]).toEqual(['fill', 'cw', 0.5]);
    const packed = colorWheel.packUniforms(savedWheel.params as Params, 1920, 1080, 0)!;
    expect([packed[5], packed[7], packed[10]]).toEqual([0, 0.5, 0]);
    // A saved grid with Line Width 0 draws even hairlines: no "draws no lines" note.
    const shown = { ...getRenderedDefaultParams('perspective-grid'), ...savedGrid.params };
    expect(shown.widthMode).toBe('screen');
    expect(perspectiveGrid.paramWarnings!(shown, 1920, 1080)).toEqual([]);
    expect(perspectiveGrid.paramWarnings!({ ...getDefaultParams('perspective-grid'), ...savedGrid.params }, 1920, 1080)).toHaveLength(1);
  });

  it('shows a saved wheel as Fill layer, Clockwise and 50 % and switches it to Disc in one pick', () => {
    const patch = vi.spyOn(useTimelineStore.getState(), 'updateClipEffect').mockImplementation(() => {});
    render(<EffectsTab clipId="clip:saved-wheel" effects={[savedWheel]} />);
    expect(screen.getByRole('combobox', { name: 'Shape' })).toHaveTextContent('Fill layer');
    expect(screen.getByRole('combobox', { name: 'Direction' })).toHaveTextContent('Clockwise');
    expect(screen.getByLabelText('Radius slider')).toHaveAttribute('aria-valuenow', '50');
    fireEvent.click(screen.getByRole('combobox', { name: 'Shape' }));
    const disc = screen.getByRole('option', { name: 'Disc' });
    fireEvent.pointerDown(disc, { button: 0, isPrimary: true, pointerType: 'mouse' });
    fireEvent.click(disc, { button: 0, detail: 1 });
    expect(patch).toHaveBeenCalledWith('clip:saved-wheel', 'old-wheel', { shape: 'disc' });
  });

  it('shows a saved grid as Even width without a Line Width 0 warning', () => {
    render(<EffectsTab clipId="clip:saved-grid" effects={[savedGrid]} />);
    expect(screen.getByRole('combobox', { name: 'Lines' })).toHaveTextContent('Even width');
    expect(screen.queryByText(/draws no lines/)).toBeNull();
  });

  it('animates a keyed parameter the saved instance does not store from the value it renders', () => {
    expect(getLegacyEffectKeyframeBaseValue(savedWheel, 'radius')).toBe(0.5);
    expect(getLegacyEffectKeyframeBaseValue({ ...savedWheel, params: { ...savedWheel.params, centerX: null as never } }, 'centerX')).toBe(0.5);
  });

  it('still draws the default disc when every number of a new wheel is NaN, null or infinite', () => {
    for (const bad of [Number.NaN, null, 'NaN', Number.POSITIVE_INFINITY]) {
      const params = { ...getDefaultParams('color-wheel'), ...Object.fromEntries(
        ['radius', 'centerX', 'centerY', 'rotation', 'spin', 'saturation', 'value', 'mix'].map(name => [name, bad])) };
      // As EffectsPipeline.createEffectUniformData reads them.
      const packed = colorWheel.packUniforms(toPrimitiveEffectParams(params), 1920, 1080, 3)!;
      expect(packed[5]).toBe(1); // disc
      expect(packed[7]).toBeCloseTo(bad === null ? 0.5 : 0.45, 6); // default, or the legacy 0.5 for a dropped null
      expect([packed[1], packed[2], packed[3], packed[8], packed[9]]).toEqual([1, 1, 1, 0.5, 0.5]);
    }
  });
});

describe('Weave default', () => {
  it('starts new Weaves as a smaller grey sheet, and saving pins a Weave to its graph', () => {
    const graph = createDefaultWeaveGraph();
    const constants = (id: string) => graph.nodes.find(node => node.id === id)!.constants!;
    expect(constants('pattern')).toMatchObject({ warps: 16, wefts: 10, width: 1.6, height: 0.96 });
    expect(constants('cloth')).toMatchObject({ width: 1.6, height: 0.96 });
    expect(constants('fiber')).toMatchObject({ preset: 'custom', color: '#8a857c' });
    // Project and timeline serialization run this: a graphless Weave is saved with the graph it renders.
    const saved = migratePersistedEffectOperatorGraph({ id: 'w', type: 'weave', name: 'Weave', enabled: true, params: {} });
    expect(saved.operatorGraph?.nodes.find(node => node.id === 'pattern')?.constants).toMatchObject({ warps: 16, wefts: 10 });
  });
});

describe('Keyed rates on every render path', () => {
  const ramp = [key('a', 'effect.grid.speed', 0, 0), key('b', 'effect.grid.speed', 2, 10)];

  it('integrates a keyed ramp inside a nested composition and keeps the scroll continuous', () => {
    // The clip starts at 100 s of its composition, which is the clock its effects are rendered with.
    const frame = 1 / 30;
    let previous: number | undefined;
    for (let t = 0; t <= 2.5; t += frame) {
      const [effect] = evaluateCompositionClipEffects([grid()], ramp, t, { startTime: 100 } as never);
      expect(effect.params.speedTravel).toBeCloseTo(t <= 2 ? 2.5 * t * t : 10 + 10 * (t - 2), 2);
      const scroll = scrollOf(effect, 100 + t);
      if (previous !== undefined) expect(wrappedStep(previous, scroll)).toBeLessThanOrEqual(10 * frame + 1e-4);
      previous = scroll;
    }
  });

  it('keeps the scroll unchanged when the first key is added at the current rate', () => {
    for (const startTime of [0, 7.25, 100]) {
      useTimelineStore.setState({
        clips: [createMockClip({ id: 'gen', startTime, duration: 4, trackId: 'v0', effects: [grid({ ...getDefaultParams('perspective-grid'), speed: 1.7 })] })],
        tracks: [createMockTrack({ id: 'v0', type: 'video' })],
        clipKeyframes: new Map(),
      });
      const before = scrollOf(useTimelineStore.getState().getInterpolatedEffects('gen', 1.3)[0], startTime + 1.3);
      useTimelineStore.setState({ clipKeyframes: new Map([['gen', [key('k', 'effect.grid.speed', 0.5, 1.7)]]]) });
      const keyed = useTimelineStore.getState().getInterpolatedEffects('gen', 1.3)[0];
      expect(keyed.params.speedTravel).toBeDefined();
      expect(scrollOf(keyed, startTime + 1.3)).toBeCloseTo(before, 6);
      // The composition evaluator agrees with the timeline.
      const nested = evaluateCompositionClipEffects([grid({ ...getDefaultParams('perspective-grid'), speed: 1.7 })],
        [key('k', 'effect.grid.speed', 0.5, 1.7)], 1.3, { startTime } as never)[0];
      expect(nested.params.speedTravel).toBeCloseTo(keyed.params.speedTravel as number, 9);
    }
  });

  it('runs the parent clip\'s keyed ramp on its own clock inside a transition', () => {
    const parentStart = 40;
    const sourceMap: TransitionSourceMapV2 = {
      version: 2, mediaDuration: 10,
      parent: { duration: 4, inPoint: 0, outPoint: 4, defaultSpeed: 1,
        animation: { baseTransform: createMockClip({ id: 'p' }).transform, parameterTimelineStart: parentStart,
          keyframes: ramp, sourceEffectIds: ['grid'], sourceMaskIds: [] } },
      segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart: 1, parentEnd: 2 }],
    };
    const clip = { ...createMockClip({ id: 'mapped', startTime: 0, effects: [grid()] }), transitionSourceMap: sourceMap } as TimelineClip;
    const mapped = evaluateTransitionMappedAnimation(clip, [], 0.5)!;
    // Parent-local 1.5 s: the same travel as the parent clip on its timeline at that moment.
    const onParent = evaluateCompositionClipEffects([grid()], ramp, 1.5, { startTime: parentStart } as never)[0];
    expect(mapped.effects[0].params.speedTravel).toBeCloseTo(onParent.params.speedTravel as number, 9);
  });

  it('drops travel stored on an instance: it is runtime-only and would freeze the pattern', () => {
    const stored = grid({ ...getDefaultParams('perspective-grid'), speed: 2, speedTravel: 0.4 });
    useTimelineStore.setState({
      clips: [createMockClip({ id: 'gen', startTime: 3, duration: 4, trackId: 'v0', effects: [stored] })],
      tracks: [createMockTrack({ id: 'v0', type: 'video' })], clipKeyframes: new Map(),
    });
    const [timeline] = useTimelineStore.getState().getInterpolatedEffects('gen', 1);
    const [nested] = evaluateCompositionClipEffects([stored], [], 1, { startTime: 3 } as never);
    for (const effect of [timeline, nested]) {
      expect(effect.params.speedTravel).toBeUndefined();
      expect(scrollOf(effect, 4)).toBeCloseTo(0, 6); // 2 rows/s × 4 s
    }
  });

  it('lets a node source drive a keyed rate (at rate × time) instead of silently ignoring it', () => {
    const keyed = { ...grid(), params: { ...getDefaultParams('perspective-grid'), speedTravel: 12.5 } };
    const clip = { effects: [keyed], startTime: 0, nodeGraph: { parameterSources: { targets: {
      'effect.grid.speed': { localMode: 'constant' } } } } } as never;
    const [driven] = applyParameterSourcesToEffects(clip, [], 1, [keyed]);
    expect(driven.params.speedTravel).toBeUndefined();
    expect(scrollOf(driven, 2.25)).toBeCloseTo(0.75, 6); // 3 rows/s × 2.25 s
  });

  it('never stores travel given to the effect tools and says so', async () => {
    useTimelineStore.setState({
      clips: [createMockClip({ id: 'gen', startTime: 0, duration: 4, trackId: 'v0', effects: [] })],
      tracks: [createMockTrack({ id: 'v0', type: 'video' })], clipKeyframes: new Map(),
    });
    const added = await executeAITool('addEffect', { clipId: 'gen', effectType: 'perspective-grid', params: { speed: 2, speedTravel: 5 } });
    expect(added.success).toBe(true);
    const data = added.data as { effectId: string; warnings?: string[] };
    expect(data.warnings?.some(note => note.startsWith('speedTravel:'))).toBe(true);
    const stored = () => useTimelineStore.getState().clips[0].effects.find(effect => effect.id === data.effectId)!;
    expect(stored().params.speedTravel).toBeUndefined();
    expect(stored().params.speed).toBe(2);
    const updated = await executeAITool('updateEffect', { clipId: 'gen', effectId: data.effectId, params: { speedTravel: 9 } });
    expect(updated.success).toBe(true);
    expect((updated.data as { warnings?: string[] }).warnings?.[0]).toMatch(/^speedTravel: computed while rendering/);
    expect(stored().params.speedTravel).toBeUndefined();
  });
});
