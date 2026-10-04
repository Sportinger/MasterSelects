import { afterEach, describe, expect, it } from 'vitest';
import {
  createDefaultSkeletonShape,
  facingX,
  gaitPose,
  normalizeSkeleton,
  SKELETON_JOINTS,
  skeletonFromParams,
  solveSkeleton,
  solveSkeletonLimb,
} from '../../src/services/rig/skeletonRig';
import {
  applySkeletonActions,
  parseSkeletonActions,
  sampleSkeletonAction,
  serializeSkeletonActions,
  skeletonActionContact,
  skeletonActionWeight,
  type SkeletonActionInstance,
} from '../../src/services/rig/skeletonActions';
import { ballisticState } from '../../src/services/parameterSources/controlSignalMath';
import { mapCompositionPointToLayer, mapLayerPointToComposition } from '../../src/services/rig/stickFigureJointRuntime';
import { stickFigureParameterTargets } from '../../src/services/parameterSources/stickFigureParameterTargets';
import { STICK_FIGURE_PARAMS } from '../../src/effects/generate/stickFigure/params';
import { stickFigure } from '../../src/effects/generate/stickFigure';
import { createControlNode } from '../../src/services/parameterSources/controlOperators';
import { createParameterSourceEvaluator } from '../../src/services/parameterSources/parameterSourceEvaluation';
import { fillSeededNoise, noiseStartOffset, pitchEnvelopeCents } from '../../src/engine/audio/synth/synthVoiceMath';
import { SIMPLE_SYNTH_PRESETS } from '../../src/engine/audio/synth/simpleSynthPresets';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { validateChoreography } from '../../src/services/rig/choreographyValidation';
import type { Effect } from '../../src/types/effects';
import type { ClipTransform } from '../../src/types/timelineCore';

const STAND = { spine: 0, head: 0, shoulderL: 8, elbowL: 10, shoulderR: -8, elbowR: 10, hipL: 4, kneeL: 0, hipR: -4, kneeR: 0 };
const action = (overrides: Partial<SkeletonActionInstance> & Pick<SkeletonActionInstance, 'action'>): SkeletonActionInstance =>
  ({ id: `a-${overrides.action}`, start: 0, duration: 1, ...overrides });

describe('stick figure rig', () => {
  it('stands its lowest point on the ground and lifts after snapping', () => {
    const { joints, groundShift } = solveSkeleton(createDefaultSkeletonShape());
    const shape = createDefaultSkeletonShape();
    const lowest = Math.max(...SKELETON_JOINTS.filter(joint => joint !== 'head').map(joint => joints[joint].y)) + shape.thickness / 2;
    expect(lowest).toBeCloseTo(shape.groundY);
    expect(joints.head.y).toBeLessThan(joints.neck.y);
    const lifted = solveSkeleton({ ...shape, lift: -100 });
    expect(lifted.joints.footL.y).toBeCloseTo(joints.footL.y - 100);
    expect(lifted.groundShift).toBeCloseTo(groundShift);
    // Crouching with Plant lowers the body; Keep above ground leaves it hanging.
    const crouch = { ...shape, hipL: 70, kneeL: 120, hipR: 70, kneeR: 120 };
    expect(solveSkeleton(crouch).joints.pelvis.y).toBeGreaterThan(joints.pelvis.y + 20);
    expect(solveSkeleton({ ...crouch, groundMode: 'floor' }).joints.pelvis.y).toBeCloseTo(0);
  });

  it('swings limbs forward for positive angles and flexes knees backward', () => {
    const { joints } = solveSkeleton({ ...createDefaultSkeletonShape(), groundMode: 'off', hipL: 45, kneeL: 60, shoulderR: 90, elbowR: 0 });
    expect(joints.kneeL.x).toBeGreaterThan(joints.pelvis.x);
    expect(joints.footL.x).toBeLessThan(joints.kneeL.x);
    expect(joints.handR.x - joints.neck.x).toBeCloseTo(62 + 58);
  });

  it('mirrors around the pelvis and normalizes bad input', () => {
    expect(facingX(150 + 40, 150, -1)).toBe(110);
    expect(facingX(facingX(70, 150, -1), 150, -1)).toBe(70);
    const normalized = normalizeSkeleton({ thigh: -5, spine: Number.NaN, groundMode: 'sideways' as never });
    expect(normalized.thigh).toBe(0);
    expect(normalized.spine).toBe(0);
    expect(normalized.groundMode).toBe('plant');
    expect(skeletonFromParams({ hipL: 30, groundMode: 'off', unrelated: 'x' })).toMatchObject({ hipL: 30, groundMode: 'off' });
  });

  it('solves limb IK in the figure convention', () => {
    const shape = createDefaultSkeletonShape();
    const straight = solveSkeletonLimb(shape, 'legL', 0, shape.thigh + shape.shin);
    expect(straight.upper).toBeCloseTo(0);
    expect(straight.lower).toBeCloseTo(0);
    expect(straight.reach).toBeCloseTo(1);
    const bent = solveSkeletonLimb(shape, 'legL', 30, 110);
    expect(bent.lower).toBeGreaterThan(0);
    const { joints } = solveSkeleton({ ...shape, groundMode: 'off', hipL: bent.upper, kneeL: bent.lower });
    expect(joints.footL.x - joints.pelvis.x).toBeCloseTo(30);
    expect(joints.footL.y - joints.pelvis.y).toBeCloseTo(110);
    const arm = solveSkeletonLimb({ ...shape, spine: 20 }, 'armR', 60, 60);
    const armJoints = solveSkeleton({ ...shape, spine: 20, groundMode: 'off', shoulderR: arm.upper, elbowR: arm.lower }).joints;
    expect(armJoints.handR.x - armJoints.neck.x).toBeCloseTo(60);
    expect(armJoints.handR.y - armJoints.neck.y).toBeCloseTo(60);
  });

  it('cycles gaits deterministically with alternating feet', () => {
    const once = gaitPose('walk', 0.3), again = gaitPose('walk', 1.3);
    for (const key of Object.keys(once) as (keyof typeof once)[]) expect(again[key]).toBeCloseTo(once[key]);
    const halves = [0.25, 0.75].map(phase => gaitPose('walk', phase));
    expect(halves[0].hipL).toBeCloseTo(-halves[1].hipL);
    // Walking has double support around the passing points; at 0 and 0.5 exactly one foot swings.
    expect(gaitPose('walk', 0).contactL + gaitPose('walk', 0.5).contactL).toBe(1);
    expect(gaitPose('idle', 0.4)).toMatchObject({ contactL: 1, contactR: 1 });
  });
});

describe('stick figure actions', () => {
  it('blends in and out, holds a fall and scales contacts with duration', () => {
    const punch = action({ action: 'punch', start: 1, duration: 0.55 });
    expect(skeletonActionWeight(punch, 0.99)).toBe(0);
    expect(skeletonActionWeight(punch, 1.3)).toBe(1);
    expect(skeletonActionWeight(punch, 1.56)).toBe(0);
    expect(skeletonActionContact(punch)).toBeCloseTo(1.2);
    expect(skeletonActionContact({ ...punch, duration: 1.1 })).toBeCloseTo(1.4);
    const fall = action({ action: 'fall', start: 0, duration: 1 });
    expect(skeletonActionWeight(fall, 5)).toBe(1);
    expect(sampleSkeletonAction(fall, 5).pose.spine).toBe(-90);
  });

  it('accumulates travel, lifts jumps and keeps strength relative to standing', () => {
    const actions = [action({ action: 'walk', start: 0, duration: 2 }), action({ action: 'jump', start: 3, duration: 1.1 })];
    expect(applySkeletonActions(STAND, 0, actions, 1).advance).toBeCloseTo(110);
    expect(applySkeletonActions(STAND, 0, actions, 10).advance).toBeCloseTo(280);
    expect(applySkeletonActions(STAND, 0, actions, 3.55).lift).toBeLessThan(-100);
    const half = sampleSkeletonAction(action({ action: 'duck', strength: 0.5 }), 0.3).pose;
    const full = sampleSkeletonAction(action({ action: 'duck' }), 0.3).pose;
    expect(half.kneeL - STAND.kneeL).toBeCloseTo((full.kneeL - STAND.kneeL) / 2);
  });

  it('blends angles the short way, so an overhand throw never spins back', () => {
    const throwAction = action({ action: 'throw', start: 0, duration: 0.8 });
    let previous = applySkeletonActions(STAND, 0, [throwAction], 0).pose.shoulderL;
    for (let frame = 1; frame <= 30; frame++) {
      const next = applySkeletonActions(STAND, 0, [throwAction], frame / 30).pose.shoulderL;
      expect(Math.abs(((next - previous) % 360 + 540) % 360 - 180)).toBeLessThan(75);
      previous = next;
    }
  });

  it('round-trips the stored lane and drops invalid entries', () => {
    const lane = [action({ action: 'kick', start: 2 }), action({ action: 'punch', start: 1, target: { figure: 'c|e', joint: 'head' } })];
    const parsed = parseSkeletonActions(serializeSkeletonActions(lane));
    expect(parsed.map(item => item.action)).toEqual(['punch', 'kick']);
    expect(parsed[0].target).toEqual({ figure: 'c|e', joint: 'head' });
    expect(parseSkeletonActions('[{"id":"x","action":"moonwalk","start":0,"duration":1},{"id":"y","action":"duck","start":0,"duration":0}]')).toEqual([]);
    expect(parseSkeletonActions('not json')).toEqual([]);
  });
});

describe('ballistic flight', () => {
  it('arcs, bounces and comes to rest', () => {
    expect(ballisticState(-1, 1, 2, 3, 4, 6, 0.5).x).toBe(1);
    const apex = ballisticState(1 / 3, 0, 0, 0, -2, 6, 0.5);
    expect(apex.y).toBeCloseTo(-1 / 3);
    expect(apex.vy).toBeCloseTo(0);
    const landed = ballisticState(10, 0, 0, 1, -2, 6, 0.5, 0.5, 0.8);
    expect(landed).toMatchObject({ y: 0.5, resting: 1 });
    expect(landed.bounces).toBeGreaterThan(3);
    expect(landed.firstImpact).toBeGreaterThan(0.6);
    expect(ballisticState(10, 0, 0, 0, -2, 6, 0.5, 0).bounces).toBe(1);
    expect(ballisticState(2, 0, 0, 1, 0, 0, null).x).toBe(2);
  });
});

describe('stick figure effect', () => {
  it('packs twelve joints in output pixels, mirrored around the pelvis when facing left', () => {
    const params = Object.fromEntries(Object.entries(STICK_FIGURE_PARAMS).map(([key, def]) => [key, def.default])) as Record<string, number | string>;
    const right = stickFigure.packUniforms({ ...params, rootX: 200 }, 1920, 1080)!;
    const left = stickFigure.packUniforms({ ...params, rootX: 200, facing: 'left' }, 1920, 1080)!;
    expect(right).toHaveLength(36);
    expect(right[12]).toBeCloseTo(960 + 200);
    expect(left[12]).toBeCloseTo(right[12]);
    expect(left[12 + 9 * 2] - left[12]).toBeCloseTo(-(right[12 + 9 * 2] - right[12]));
    const half = stickFigure.packUniforms({ ...params }, 960, 540)!;
    expect(half[2]).toBeCloseTo(right[2] / 2);
  });

  it('exposes every numeric parameter as a target with joint angles in degrees', () => {
    const effect = { id: 'fx', name: 'Stick Figure', params: { hipL: 30 } };
    const targets = stickFigureParameterTargets(effect);
    expect(targets.find(target => target.path === 'effect.fx.hipL')).toMatchObject({ value: 30, unit: 'degrees' });
    expect(targets.find(target => target.path === 'effect.fx.thigh')).toMatchObject({ unit: 'pixels' });
    expect(targets.some(target => target.path === 'effect.fx.actions' || target.path === 'effect.fx.color')).toBe(false);
  });

  it('maps figure points through a clip transform and back', () => {
    const transform: ClipTransform = { opacity: 1, blendMode: 'normal', position: { x: 0.2, y: -0.1, z: 0 },
      anchor: { x: 0.05, y: 0, z: 0 }, scale: { x: 1.5, y: 0.8 }, rotation: { x: 0, y: 0, z: 30 } };
    const out = mapLayerPointToComposition(123, -45, transform, 1920, 1080);
    const back = mapCompositionPointToLayer(out.x, out.y, transform, 1920, 1080);
    expect(back.x).toBeCloseTo(123);
    expect(back.y).toBeCloseTo(-45);
    expect(mapLayerPointToComposition(960, 0, { ...transform, position: { x: 0, y: 0, z: 0 }, anchor: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 } }, 1920, 1080)).toEqual({ x: 1, y: 0 });
  });
});

describe('rig control nodes', () => {
  const figureEffect: Effect = { id: 'fx', name: 'Stick Figure', type: 'stick-figure', enabled: true,
    params: { thigh: 80, shin: 80, spine: 0 } } as Effect;
  const clipWith = (nodes: ReturnType<typeof createControlNode>[]) => ({ id: 'clip', startTime: 0, effects: [figureEffect],
    nodeGraph: { version: 1 as const, nodes: [], parameterSources: { version: 1 as const, clipTimeOffset: 0,
      graph: { version: 1 as const, nodes, edges: [], layout: {} }, targets: {} } } });

  it('runs Gait Cycle on clip time with outputs named like the figure joints', () => {
    const gait = createControlNode('rig.gait-cycle', 'gait');
    const evaluator = createParameterSourceEvaluator(clipWith([gait]), [], 0.3);
    expect(evaluator.evaluateNode({ nodeId: 'gait', portId: 'hipL' })).toBeCloseTo(gaitPose('walk', 0.3).hipL);
  });

  it('reads the figure lengths for Limb IK and reports a missing figure', () => {
    const ik = createControlNode('rig.limb-ik', 'ik');
    ik.constants = { ...ik.constants, targetX: 0, targetY: 160 };
    const evaluator = createParameterSourceEvaluator(clipWith([ik]), [], 0);
    expect(evaluator.evaluateNode({ nodeId: 'ik', portId: 'reach' })).toBeCloseTo(1);
    expect(evaluator.evaluateNode({ nodeId: 'ik', portId: 'lower' })).toBeCloseTo(0);
    const lonely = { ...clipWith([ik]), effects: [] };
    expect(() => createParameterSourceEvaluator(lonely, [], 0).evaluateNode({ nodeId: 'ik', portId: 'upper' })).toThrow('Stick Figure');
  });

  it('launches Ballistic at its launch time', () => {
    const ball = createControlNode('control.ballistic', 'ball');
    ball.constants = { ...ball.constants, launch: 1, velocityY: -2, floor: 'off' };
    const before = createParameterSourceEvaluator(clipWith([ball]), [], 0.5);
    const after = createParameterSourceEvaluator(clipWith([ball]), [], 1 + 1 / 3);
    expect(before.evaluateNode({ nodeId: 'ball', portId: 'y' })).toBe(0);
    expect(after.evaluateNode({ nodeId: 'ball', portId: 'y' })).toBeCloseTo(-1 / 3);
  });
});

describe('stick figure timeline runtime', () => {
  const initial = useTimelineStore.getState();
  afterEach(() => useTimelineStore.setState(initial));
  const figure = (id: string, rootX: number, facing: string, actions: SkeletonActionInstance[]) => createMockClip({
    id, startTime: 0, duration: 4, trackId: 'track-a',
    effects: [{ id: `${id}-fx`, name: 'Stick Figure', type: 'stick-figure', enabled: true,
      params: { ...Object.fromEntries(Object.entries(STICK_FIGURE_PARAMS).map(([key, def]) => [key, def.default])),
        rootX, facing, actions: serializeSkeletonActions(actions) } } as Effect],
  });

  it('aims a punch at another figure and finds nothing to report', () => {
    const a = figure('a', -40, 'right', [action({ id: 'p', action: 'punch', start: 1, duration: 0.55, target: { figure: 'b|b-fx', joint: 'head' } })]);
    const b = figure('b', 130, 'left', []);
    useTimelineStore.setState({ clips: [a, b], tracks: [createMockTrack({ id: 'track-a' })], clipKeyframes: new Map() });
    const params = useTimelineStore.getState().getInterpolatedEffects('a', 1.2)[0].params;
    expect(params.shoulderL).not.toBeCloseTo(88);
    expect(params.rootX).toBeGreaterThan(-40);
    expect(validateChoreography({ fps: 15 })).toEqual([]);
  });

  it('reports a strike that misses and a figure below its ground', () => {
    const a = figure('a', -600, 'right', [action({ id: 'p', action: 'punch', start: 1, duration: 0.55 })]);
    const b = figure('b', 500, 'left', []);
    b.effects[0].params = { ...b.effects[0].params, groundMode: 'off', lift: 40 };
    useTimelineStore.setState({ clips: [a, b], tracks: [createMockTrack({ id: 'track-a' })], clipKeyframes: new Map() });
    const kinds = validateChoreography({ fps: 10 }).map(issue => issue.kind);
    expect(kinds).toContain('missed-contact');
    expect(kinds).toContain('foot-in-ground');
  });
});

describe('simple synth sound effects', () => {
  it('fills seeded noise deterministically within range', () => {
    const a = fillSeededNoise(new Float32Array(4096)), b = fillSeededNoise(new Float32Array(4096));
    expect(a).toEqual(b);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(-1);
    expect(Math.abs(a.reduce((sum, value) => sum + value, 0) / a.length)).toBeLessThan(0.05);
    expect(noiseStartOffset(60)).not.toBe(noiseStartOffset(61));
    expect(pitchEnvelopeCents(100)).toBe(4800);
    expect(pitchEnvelopeCents(undefined)).toBe(0);
  });

  it('sets every new field explicitly on presets so loading one never keeps an old sweep', () => {
    for (const preset of SIMPLE_SYNTH_PRESETS) expect(preset.instrument.pitchEnv).toBeDefined();
    expect(SIMPLE_SYNTH_PRESETS.find(preset => preset.id === 'sfx-whoosh')?.instrument).toMatchObject({ waveform: 'noise', filter: { type: 'bandpass' } });
  });
});
