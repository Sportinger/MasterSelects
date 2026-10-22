// Stick Figure review (2026-10-22): action travel and jump height that grow with the figure, the
// hairline note and the presets. Older action lanes keep their authored pixels
// (tests/unit/stickFigureRig.test.ts 'accumulates travel').
import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { stickFigure } from '../../src/effects/generate/stickFigure';
import { stickFigureWarnings } from '../../src/effects/generate/stickFigure/layout';
import { STICK_FIGURE_PARAMS } from '../../src/effects/generate/stickFigure/params';
import { STICK_FIGURE_PRESETS } from '../../src/effects/generate/stickFigure/presets';
import {
  applySkeletonActions,
  parseSkeletonActions,
  serializeSkeletonActions,
  skeletonActionTravel,
  type SkeletonActionInstance,
} from '../../src/services/rig/skeletonActions';
import { addStickFigureAction } from '../../src/services/rig/stickFigureActions';
import { applyStickFigureActions, stickFigureBodyScale } from '../../src/services/rig/stickFigureActionRuntime';
import { useTimelineStore } from '../../src/stores/timeline';
import { produceNodePreview } from '../../src/services/nodePreview/previewSources';
import { createControlNode } from '../../src/services/parameterSources/controlOperators';
import { projectParameterSources } from '../../src/services/parameterSources/parameterSourceProjection';
import { gaitPose } from '../../src/services/rig/skeletonRig';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import { resolveEffectPreset } from '../../src/services/effects/effectPresets';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const BASE = { spine: 4, head: -4, shoulderL: 30, elbowL: 35, shoulderR: -25, elbowR: 20, hipL: 16, kneeL: 18, hipR: -12, kneeR: 6 };
const walk = (extra: Partial<SkeletonActionInstance> = {}): SkeletonActionInstance =>
  ({ id: 'w', action: 'walk', start: 0, duration: 2, ...extra });
const jump = (extra: Partial<SkeletonActionInstance> = {}): SkeletonActionInstance =>
  ({ id: 'j', action: 'jump', start: 0, duration: 1.1, ...extra });

describe('body-scaled stick figure actions', () => {
  it('travels and jumps with the legs and Scale, so a large figure keeps its step and a small one its hop', () => {
    expect(skeletonActionTravel(walk({ bodyScaled: true }), 2)).toBe(440);
    expect(applySkeletonActions(BASE, 0, [walk({ bodyScaled: true })], 1, 0.5).advance).toBeCloseTo(55);
    const small = applySkeletonActions(BASE, 0, [jump({ bodyScaled: true })], 0.55, 1);
    const large = applySkeletonActions(BASE, 0, [jump({ bodyScaled: true })], 0.55, 2);
    expect(large.lift).toBeCloseTo(small.lift * 2);
    expect(stickFigureBodyScale({ scale: 1.5 })).toBeCloseTo(1.5);
    expect(stickFigureBodyScale({ thigh: 100, shin: 98 })).toBeCloseTo(198 / 144);
    expect(stickFigureBodyScale({ thigh: 0, shin: 0 })).toBe(0);
  });

  it('keeps older lanes at their authored pixels and an explicit distance as given', () => {
    expect(skeletonActionTravel(walk(), 2)).toBe(220);
    expect(applySkeletonActions(BASE, 0, [walk()], 1, 2).advance).toBeCloseTo(110);
    expect(applySkeletonActions(BASE, 0, [jump()], 0.55, 2).lift).toBeCloseTo(applySkeletonActions(BASE, 0, [jump()], 0.55, 1).lift);
    expect(skeletonActionTravel(walk({ bodyScaled: true, distance: 90 }), 2)).toBe(90);
  });

  it('applies the figure size in the timeline runtime and keeps the flag through the lane round trip', () => {
    const effect = (scale: number, actions: SkeletonActionInstance[]) => ({ id: 'fx', name: 'Stick Figure', type: 'stick-figure', enabled: true,
      params: { ...getDefaultParams('stick-figure'), scale, actions: serializeSkeletonActions(actions) } } as Effect);
    const rootX = (scale: number, actions: SkeletonActionInstance[]) => applyStickFigureActions(undefined, [effect(scale, actions)], 2)[0].params.rootX as number;
    expect(rootX(2, [walk({ bodyScaled: true })])).toBeCloseTo(440);
    expect(rootX(2, [walk()])).toBeCloseTo(220);
    expect(parseSkeletonActions(serializeSkeletonActions([walk({ bodyScaled: true })]))[0].bodyScaled).toBe(true);
    expect(parseSkeletonActions(JSON.stringify([walk(), { ...walk({ id: 'x' }), bodyScaled: 'yes' }])).every(item => item.bodyScaled === undefined)).toBe(true);
  });

  it('keeps a finished walk where it ended when Scale is keyframed later: each action uses the size at its own start', () => {
    const key = (time: number, value: number) => ({ id: `s${time}`, clipId: 'c', time, property: 'effect.fx.scale', value, easing: 'linear' }) as Keyframe;
    const keys = [key(2.5, 1), key(3.5, 2)];
    const at = (time: number) => {
      // The runtime sees the keyframed Scale of `time` (as after keyframe evaluation).
      const scale = time <= 2.5 ? 1 : time >= 3.5 ? 2 : 1 + (time - 2.5);
      const effect = { id: 'fx', name: 'Stick Figure', type: 'stick-figure', enabled: true,
        params: { ...getDefaultParams('stick-figure'), scale, actions: serializeSkeletonActions([walk({ bodyScaled: true })]) } } as Effect;
      return applyStickFigureActions({ id: 'c', startTime: 0 }, [effect], time, keys)[0].params.rootX as number;
    };
    expect(at(2.2)).toBeCloseTo(220);
    expect(at(3)).toBeCloseTo(220);
    expect(at(4)).toBeCloseTo(220);
    // A walk that starts at Scale 2 travels twice as far.
    const late = { id: 'fx', name: 'Stick Figure', type: 'stick-figure', enabled: true,
      params: { ...getDefaultParams('stick-figure'), scale: 2, actions: serializeSkeletonActions([walk({ bodyScaled: true, start: 4 })]) } } as Effect;
    expect(applyStickFigureActions({ id: 'c', startTime: 0 }, [late], 6, keys)[0].params.rootX).toBeCloseTo(440);
  });
});

describe('stick figure card actions', () => {
  const initial = useTimelineStore.getState();
  afterEach(() => useTimelineStore.setState(initial));

  it('adds a body-scaled action from the card and tool path', () => {
    const clip = createMockClip({ id: 'fig', startTime: 0, duration: 4, trackId: 'track-a',
      effects: [{ id: 'fig-fx', name: 'Stick Figure', type: 'stick-figure', enabled: true, params: getDefaultParams('stick-figure') } as Effect] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'track-a' })], clipKeyframes: new Map() });
    addStickFigureAction('fig', 'fig-fx', 'run', 0.5);
    const stored = useTimelineStore.getState().clips[0].effects[0].params.actions;
    expect(parseSkeletonActions(stored)[0]).toMatchObject({ action: 'run', start: 0.5, bodyScaled: true });
  });
});

describe('stick figure notes and presets', () => {
  const defaults = () => getDefaultParams('stick-figure') as Record<string, number | string>;

  it('names lines thinner than a pixel instead of drawing a hairline silently', () => {
    expect(stickFigureWarnings({ ...defaults(), thickness: 0 }).join(' ')).toMatch(/thickness: 0 px is thinner than one pixel/);
    expect(stickFigureWarnings({ ...defaults(), thickness: 3, scale: 0.25 }).join(' ')).toMatch(/times Scale 0.25/);
    expect(stickFigureWarnings({ ...defaults(), thickness: 2 }, 1920, 1080)).toEqual([]);
    expect(stickFigureWarnings(defaults())).toEqual([]);
  });

  it('says that Pelvis Y cannot move a planted figure, and stays quiet when Ground lets it', () => {
    expect(stickFigureWarnings({ ...defaults(), rootY: -120 }).join(' ')).toMatch(/rootY: Ground "Plant lowest point" .* Pelvis Y -120 px does not move it/);
    const planted = stickFigure.packUniforms({ ...defaults(), rootY: -120 }, 1920, 1080)!, standing = stickFigure.packUniforms(defaults(), 1920, 1080)!;
    expect(planted[13]).toBeCloseTo(standing[13]);
    expect(stickFigureWarnings({ ...defaults(), rootY: -120, groundMode: 'off' })).toEqual([]);
    expect(stickFigureWarnings({ ...defaults(), rootY: -120, groundMode: 'floor' })).toEqual([]);
  });

  it('declares four named presets of visible controls, each a whole figure inside the frame', () => {
    expect(stickFigure.presets?.map(preset => preset.name)).toEqual(['Arabesque', 'Curtain Call', 'Walking Man', 'Pictogram']);
    for (const preset of STICK_FIGURE_PRESETS) {
      for (const key of Object.keys(preset.params)) {
        const definition = (STICK_FIGURE_PARAMS as Record<string, { hidden?: boolean }>)[key];
        expect(definition && !definition.hidden, `${preset.id}.${key}`).toBe(true);
      }
      expect(stickFigureWarnings({ ...defaults(), ...preset.params }), preset.id).toEqual([]);
      const uniforms = stickFigure.packUniforms({ ...defaults(), ...preset.params }, 1920, 1080)!;
      for (let index = 12; index < 36; index += 2) {
        expect(uniforms[index]).toBeGreaterThan(0);
        expect(uniforms[index + 1]).toBeGreaterThan(0);
        expect(uniforms[index + 1]).toBeLessThan(1080);
      }
    }
  });
});

describe('stick figure presets and placement', () => {
  it('keeps where the figure stands, its Scale and Facing (presetKeeps), and resets the rest it does not name', () => {
    // Pinned with the Presets paragraph of stick-figure.md: placement stays, look and ground return to their defaults.
    const placed = { type: 'stick-figure', params: { ...getDefaultParams('stick-figure') as Record<string, number | string>, rootX: 600, rootY: -40, groundY: 430, scale: 1.6, facing: 'left', opacity: 0.5, groundMode: 'off' } };
    const values = resolveEffectPreset(placed, STICK_FIGURE_PRESETS[1]);
    expect(values).toMatchObject({ groundY: 144, opacity: 1, groundMode: 'plant' });
    for (const key of ['rootX', 'rootY', 'scale', 'facing']) expect(values).not.toHaveProperty(key);
  });
});

describe('Gait Cycle node viewer', () => {
  const initial = useTimelineStore.getState();
  afterEach(() => useTimelineStore.setState(initial));

  it('shows its first output (Spine) instead of "Unknown control output", and a chosen output port', () => {
    const gait = createControlNode('rig.gait-cycle', 'gait');
    const clip = createMockClip({ id: 'walker', startTime: 0, duration: 4, trackId: 'track-a',
      effects: [{ id: 'walker-fx', name: 'Stick Figure', type: 'stick-figure', enabled: true, params: getDefaultParams('stick-figure') } as Effect],
      nodeGraph: { version: 1, nodes: [], parameterSources: { version: 1, clipTimeOffset: 0,
        graph: { version: 1, nodes: [gait], edges: [], layout: {} }, targets: {} } } } as never);
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'track-a' })], clipKeyframes: new Map() });
    const node = projectParameterSources({ version: 1, nodes: [], edges: [] } as never, clip).nodes.find(item => item.id === 'gait')!;
    const request = { key: 'gait', revision: '1', time: 0.3, clipId: 'walker', node, width: 164, height: 100, interval: 16, priority: 1 };
    const spine = produceNodePreview(request) as { status: string; label: string };
    expect(spine.status).toBe('live');
    expect(Number(spine.label)).toBeCloseTo(gaitPose('walk', 0.3).spine);
    const hip = produceNodePreview({ ...request, port: node.outputs.find(port => port.id === 'hipL') }) as { label: string };
    expect(Number(hip.label)).toBeCloseTo(gaitPose('walk', 0.3).hipL);
  });
});
