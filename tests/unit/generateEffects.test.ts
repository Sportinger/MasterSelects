import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import common from '../../src/effects/_shared/commonShader';
import { getDefaultParams } from '../../src/effects';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';
import { colorWheel, COLOR_WHEEL_PARAMS } from '../../src/effects/generate/colorWheel';
import { perspectiveGrid, PERSPECTIVE_GRID_PARAMS } from '../../src/effects/generate/perspectiveGrid';
import { stickFigure } from '../../src/effects/generate/stickFigure';
import { STICK_FIGURE_PARAMS } from '../../src/effects/generate/stickFigure/params';
import { memoryLeakWarnings } from '../../src/effects/generate/memoryLeak/memoryWindow';
import { normalizeSkeleton, SKELETON_COORDINATE_LIMIT, skeletonFromParams, solveSkeleton } from '../../src/services/rig/skeletonRig';
import { executeAITool } from '../../src/services/aiTools';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { integrateKeyframedRate } from '../../src/utils/speedIntegration';
import type { AnimatableProperty } from '../../src/types/animationProperties';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';

type Params = Record<string, number | boolean | string>;
const GRID_SCROLL = 3;
const pack = (definition: typeof perspectiveGrid, params: Params, width = 1920, height = 1080, time = 0) =>
  Array.from(definition.packUniforms({ ...getDefaultParams(definition.id), ...params }, width, height, time) ?? []);
// Values keyframes, bezier overshoot and tools can deliver without any clamping.
const HOSTILE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1e12, 1e12, 0, -0.5];

describe('Perspective Grid', () => {
  const field = { horizon: 0, columns: 1, rows: 2, scroll: 3, linePixels: 4, fade: 5, opacity: 6, blend: 7, width: 12, height: 13, screenWidth: 14 } as const;

  it('keeps the stored half width in 1080p pixels and scales the line with the output height', () => {
    expect(pack(perspectiveGrid, { lineWidth: 1 })[field.linePixels]).toBe(2);
    expect(pack(perspectiveGrid, { lineWidth: 1 }, 3840, 2160)[field.linePixels]).toBe(4);
    expect(pack(perspectiveGrid, { lineWidth: 1 }, 960, 540)[field.linePixels]).toBe(1);
  });

  it('wraps the row scroll to one row in double precision, so long timelines do not jitter', () => {
    const time = 987654.321, speed = 7.3, offset = 0.25;
    const expected = (speed * time + offset) % 1;
    expect(pack(perspectiveGrid, { speed, offset }, 1920, 1080, time)[field.scroll]).toBeCloseTo(expected, 5);
    expect(pack(perspectiveGrid, { speed: -1.5, offset: 0 }, 1920, 1080, 1)[field.scroll]).toBeCloseTo(0.5, 6);
  });

  it.each(HOSTILE)('packs only finite values in range for %s', value => {
    const data = pack(perspectiveGrid, { horizon: value, columns: value, rows: value, speed: value, offset: value, lineWidth: value, fade: value, opacity: value }, 1920, 1080, 3);
    expect(data.every(Number.isFinite)).toBe(true);
    expect(data[field.horizon]).toBeGreaterThanOrEqual(0);
    expect(data[field.horizon]).toBeLessThanOrEqual(Math.fround(0.98));
    for (const key of ['columns', 'rows', 'linePixels', 'fade'] as const) expect(data[field[key]]).toBeGreaterThanOrEqual(0);
    expect(data[field.opacity]).toBeGreaterThanOrEqual(0);
    expect(data[field.opacity]).toBeLessThanOrEqual(1);
    expect(data[field.scroll]).toBeGreaterThanOrEqual(0);
    expect(data[field.scroll]).toBeLessThan(1);
  });

  it('adds glowing lines unless Blend is Normal, and names clamps and unknown choices', () => {
    expect(pack(perspectiveGrid, {})[field.blend]).toBe(0);
    expect(pack(perspectiveGrid, { blend: 'normal' })[field.blend]).toBe(1);
    const notes = paramRangeNotes(PERSPECTIVE_GRID_PARAMS, { horizon: 1.5, lineWidth: -2, opacity: 2 }).map(note => note.param);
    expect(notes).toEqual(['horizon', 'lineWidth', 'opacity']);
    expect(perspectiveGrid.paramWarnings?.({ ...getDefaultParams('perspective-grid'), blend: 'screen' })).toEqual(['blend: "screen" is not an option; using add.']);
    expect(perspectiveGrid.paramWarnings?.(getDefaultParams('perspective-grid'))).toEqual([]);
  });

  it('keeps saved grids at their even screen width and names settings that draw no lines', () => {
    const saved = { horizon: 0.66, columns: 14, rows: 6, speed: 1.5, offset: 0, lineWidth: 0, fade: 1.4, opacity: 0.16, color: '#2ee6ff' };
    // Old look at 1080p: a core of 2 × Line Width px plus a one-pixel rim, so Line Width 0 is a hairline.
    expect(perspectiveGrid.packUniforms(saved, 1920, 1080, 0)?.slice(field.linePixels, field.linePixels + 1)[0]).toBe(1);
    expect(perspectiveGrid.packUniforms({ ...saved, lineWidth: 1.5 }, 1920, 1080, 0)?.[field.screenWidth]).toBe(1);
    expect(perspectiveGrid.paramWarnings?.(saved)).toEqual([]);
    const fresh = getDefaultParams('perspective-grid');
    expect(fresh.widthMode).toBe('floor');
    expect(perspectiveGrid.paramWarnings?.({ ...fresh, lineWidth: 0 })?.[0]).toMatch(/^lineWidth: 0 draws no lines/);
    expect(perspectiveGrid.paramWarnings?.({ ...fresh, columns: 0, rows: 0 })).toEqual(['columns and rows: both are 0, so no lines are drawn.']);
    expect(perspectiveGrid.paramWarnings?.({ ...fresh, widthMode: 'world' })?.[0]).toBe('widthMode: "world" is not an option; using floor.');
  });
});

describe('Keyframed Speed and Spin', () => {
  const initial = useTimelineStore.getState();
  afterEach(() => useTimelineStore.setState(initial));
  const key = (id: string, property: string, time: number, value: number) =>
    ({ id, clipId: 'gen', time, property, value, easing: 'linear' }) as Keyframe;

  it('integrates a linear ramp exactly (area under the curve)', () => {
    const ramp = [key('a', 'effect.fx.speed', 0, 0), key('b', 'effect.fx.speed', 2, 4)];
    // v(t) = 2t: travel t².
    for (const t of [0.5, 1, 2]) expect(integrateKeyframedRate(ramp, 'effect.fx.speed' as AnimatableProperty, t, 0)).toBeCloseTo(t * t, 6);
    // Held at 4 after the last key.
    expect(integrateKeyframedRate(ramp, 'effect.fx.speed' as AnimatableProperty, 3, 0)).toBeCloseTo(8, 6);
  });

  it('scrolls the grid and turns the wheel continuously through a keyed ramp', () => {
    const effects = [
      { id: 'grid', name: 'Perspective Grid', type: 'perspective-grid', enabled: true, params: getDefaultParams('perspective-grid') },
      { id: 'wheel', name: 'Color Wheel', type: 'color-wheel', enabled: true, params: getDefaultParams('color-wheel') },
    ] as Effect[];
    useTimelineStore.setState({
      clips: [createMockClip({ id: 'gen', startTime: 0, duration: 4, trackId: 'v0', effects })],
      tracks: [createMockTrack({ id: 'v0', type: 'video' })],
      clipKeyframes: new Map([['gen', [key('a', 'effect.grid.speed', 0, 0), key('b', 'effect.grid.speed', 2, 10),
        key('c', 'effect.wheel.spin', 1, 0.5), key('d', 'effect.wheel.spin', 3, -0.5)]]]),
    });
    expect(PERSPECTIVE_GRID_PARAMS.speed.animatable).toBe(true);
    expect(COLOR_WHEEL_PARAMS.spin.animatable).toBe(true);
    const frame = 1 / 30;
    let previous: { scroll: number; hue: number } | undefined;
    for (let t = 0; t <= 3; t += frame) {
      const [grid, wheel] = useTimelineStore.getState().getInterpolatedEffects('gen', t);
      // Travel since the clip start: v(t) = 5t up to 2 s → 2.5 t² rows.
      if (t <= 2) expect(grid.params.speedTravel).toBeCloseTo(2.5 * t * t, 3);
      const scroll = perspectiveGrid.packUniforms(grid.params as Params, 1920, 1080, t + 100)![GRID_SCROLL];
      const hue = colorWheel.packUniforms(wheel.params as Params, 1920, 1080, t + 100)![0];
      if (previous) {
        // Per frame the scroll moves at most the top speed × one frame (wrapped to one row); no jumps.
        const step = (scroll - previous.scroll + 1) % 1;
        expect(Math.min(step, 1 - step)).toBeLessThanOrEqual(10 * frame + 1e-4);
        const turn = (hue - previous.hue + 1) % 1;
        expect(Math.min(turn, 1 - turn)).toBeLessThanOrEqual(0.5 * frame + 1e-4);
      }
      previous = { scroll, hue };
    }
    // Without keyframes the rate still runs from the timeline time.
    expect(pack(perspectiveGrid, { speed: 0.25 }, 1920, 1080, 2)[GRID_SCROLL]).toBeCloseTo(0.5, 6);
  });
});

describe('Color Wheel', () => {
  const field = { hueOffset: 0, saturation: 1, value: 2, mix: 3, aspect: 4, shape: 5, shortSide: 6, radius: 7, centerX: 8, centerY: 9, counterClockwise: 10 } as const;

  it('wraps Hue Rotation plus Spin × time into one turn and shows both in degrees', () => {
    expect(pack(colorWheel, { rotation: 0.25, spin: 1 }, 1920, 1080, 10.5)[field.hueOffset]).toBeCloseTo(0.75, 6);
    expect(pack(colorWheel, { rotation: -0.25, spin: 0 })[field.hueOffset]).toBeCloseTo(0.75, 6);
    expect(pack(colorWheel, { rotation: 0, spin: 0.37 }, 1920, 1080, 123456.789)[field.hueOffset]).toBeCloseTo((0.37 * 123456.789) % 1, 4);
    expect(COLOR_WHEEL_PARAMS.rotation).toMatchObject({ displayScale: 360, unit: '°' });
  });

  it('draws a disc for new wheels and fills the layer for wheels saved without Shape', () => {
    const saved = colorWheel.packUniforms({ rotation: 0, saturation: 1.2, value: 1, mix: 1 }, 1920, 1080, 0)!;
    // Saved: fill, full colour at the shorter edge (radius 0.5), centred, clockwise.
    expect([saved[field.shape], saved[field.radius], saved[field.centerX], saved[field.centerY], saved[field.counterClockwise]])
      .toEqual([0, 0.5, 0.5, 0.5, 0]);
    const fresh = pack(colorWheel, {}, 1280, 720);
    expect([fresh[field.shape], fresh[field.shortSide], fresh[field.counterClockwise]]).toEqual([1, 720, 1]);
    expect(fresh[field.radius]).toBeCloseTo(0.45, 6);
    expect(pack(colorWheel, { shape: 'fill' })[field.shape]).toBe(0);
    expect(pack(colorWheel, { radius: 0.2, centerX: 0.25, centerY: 0.75 }).slice(field.radius, field.centerY + 1).map(v => Number(v.toFixed(5))))
      .toEqual([0.2, 0.25, 0.75]);
    expect(colorWheel.paramWarnings?.({ ...getDefaultParams('color-wheel'), shape: 'ring', direction: 'up' }))
      .toEqual(['shape: "ring" is not an option; using disc.', 'direction: "up" is not an option; using ccw.']);
    expect(pack(colorWheel, { shape: 'ring', direction: 'up' }).filter((_, index) => index === field.shape || index === field.counterClockwise)).toEqual([1, 1]);
    // A one-sided render range names its limit instead of an infinite end.
    expect(paramRangeNotes(STICK_FIGURE_PARAMS, { thickness: -1 })[0].message).toBe('Line Thickness -1 is below the rendered range (0 to 100000) and renders as 0.');
    expect(paramRangeNotes(PERSPECTIVE_GRID_PARAMS, { columns: -1 })[0].message).toBe('Columns -1 is below the rendered range (0 to 2000) and renders as 0.');
  });

  it('names radius and centre clamps in the units of their rows in the inspector', () => {
    const [radius] = paramRangeNotes(COLOR_WHEEL_PARAMS, { radius: 0 }, undefined, { display: true });
    expect(radius.message).toBe('Radius 0% is below the rendered range (0.1% to 1000%) and renders as 0.1%.');
    const [horizon, lineWidth] = paramRangeNotes(PERSPECTIVE_GRID_PARAMS, { horizon: 1.5, lineWidth: -2 }, undefined, { display: true });
    expect(horizon.message).toBe('Horizon 150% is above the rendered range (0% to 98%) and renders as 98%.');
    expect(lineWidth.message).toBe('Line Width -4 px is below the rendered range (0 px to 2000 px) and renders as 0 px.');
    // Tool results keep stored units.
    expect(paramRangeNotes(PERSPECTIVE_GRID_PARAMS, { horizon: 1.5 })[0].message).toBe('Horizon 1.5 is above the rendered range (0 to 0.98) and renders as 0.98.');
  });

  it.each(HOSTILE)('packs only finite values for %s', value => {
    const data = pack(colorWheel, { rotation: value, spin: value, saturation: value, value, mix: value, radius: value, centerX: value, centerY: value }, 1920, 1080, 5);
    expect(data.every(Number.isFinite)).toBe(true);
    expect(data[field.radius]).toBeGreaterThan(0);
    expect(data[field.hueOffset]).toBeGreaterThanOrEqual(0);
    expect(data[field.hueOffset]).toBeLessThan(1);
    expect(data[field.mix]).toBeGreaterThanOrEqual(0);
    expect(data[field.mix]).toBeLessThanOrEqual(1);
  });
});

describe('Stick Figure robustness', () => {
  const jointsOf = (params: Params, width = 1920, height = 1080) => pack(stickFigure as typeof perspectiveGrid, params, width, height).slice(12);

  it('keeps positions and lengths inside the drawable range and leaves angles free', () => {
    const skeleton = normalizeSkeleton({ torso: 1e9, thigh: -5, rootX: -1e12, lift: Number.NaN, spine: 7200 });
    expect(skeleton).toMatchObject({ torso: SKELETON_COORDINATE_LIMIT, thigh: 0, rootX: -SKELETON_COORDINATE_LIMIT, lift: 0, spine: 7200 });
    const { joints } = solveSkeleton({ torso: 1e9, groundMode: 'off' });
    // Pelvis at 0, neck straight up the clamped torso.
    expect(joints.neck.y).toBeCloseTo(-SKELETON_COORDINATE_LIMIT, 3);
  });

  it.each(HOSTILE)('packs finite joints for %s in every length and position', value => {
    const params = Object.fromEntries(['torso', 'thigh', 'shin', 'upperArm', 'forearm', 'rootX', 'rootY', 'lift', 'groundY', 'spine', 'scale', 'turn', 'opacity', 'thickness']
      .map(key => [key, value]));
    const data = pack(stickFigure as typeof perspectiveGrid, params);
    expect(data.every(Number.isFinite)).toBe(true);
    // Within a few drawable ranges of the frame: 32-bit GPU maths keeps sub-pixel precision there.
    expect(Math.max(...jointsOf(params).map(Math.abs))).toBeLessThan(20 * SKELETON_COORDINATE_LIMIT);
  });

  it('says when nothing of the figure can be seen', () => {
    const defaults = getDefaultParams('stick-figure');
    expect(stickFigure.paramWarnings?.(defaults, 1920, 1080)).toEqual([]);
    expect(stickFigure.paramWarnings?.({ ...defaults, scale: 0 }, 1920, 1080)?.[0]).toMatch(/^scale: 0 gives the figure no size/);
    expect(stickFigure.paramWarnings?.({ ...defaults, rootX: 5000 }, 1920, 1080)?.[0]).toMatch(/whole figure lies outside its layer/);
    // A figure walking in from the side with only an arm in frame is visible.
    expect(stickFigure.paramWarnings?.({ ...defaults, rootX: -1010, shoulderR: 90, elbowR: 0 }, 1920, 1080)).toEqual([]);
    expect(stickFigure.paramWarnings?.({ ...defaults, headStyle: 'hollow' }, 1920, 1080)).toEqual(['headStyle: "hollow" is not an option; using filled.']);
    expect(paramRangeNotes(STICK_FIGURE_PARAMS, { opacity: 3, torso: -4 }).map(note => note.param)).toEqual(['torso', 'opacity']);
  });

  it('starts new figures in an open stance and keeps the rest pose for figures saved without joints', () => {
    const fresh = solveSkeleton({ ...skeletonFromParams(getDefaultParams('stick-figure')), groundMode: 'off' }).joints;
    const rest = solveSkeleton({ ...skeletonFromParams({}), groundMode: 'off' }).joints;
    // Hands and feet stand clear of the torso line, so the figure does not read as one stroke.
    const spread = (joints: typeof fresh) => Math.min(Math.abs(joints.handL.x - joints.handR.x), Math.abs(joints.footL.x - joints.footR.x));
    expect(spread(fresh)).toBeGreaterThan(40);
    expect(spread(rest)).toBeLessThan(40);
    expect(STICK_FIGURE_PARAMS.shoulderL).toMatchObject({ default: 30, legacyDefault: 8 });
  });

  it('names lengths that Scale pushes past the drawable limit', () => {
    const defaults = getDefaultParams('stick-figure');
    expect(stickFigure.paramWarnings?.({ ...defaults, torso: 90000, scale: 2 }, 1920, 1080)?.[0])
      .toBe(`torso: times Scale 2 is longer than ${SKELETON_COORDINATE_LIMIT} figure px, so it is drawn at ${SKELETON_COORDINATE_LIMIT}.`);
    expect(stickFigure.paramWarnings?.({ ...defaults, torso: 90000, scale: 1 }, 1920, 1080)?.some(note => /times Scale/.test(note))).toBe(false);
  });

  it('draws the head as a ring only when asked (saved figures keep the filled head)', () => {
    expect(pack(stickFigure as typeof perspectiveGrid, {})[9]).toBe(0);
    expect(pack(stickFigure as typeof perspectiveGrid, { headStyle: 'ring' })[9]).toBe(1);
  });
});

describe('createRig warnings', () => {
  const initial = useTimelineStore.getState();
  afterEach(() => useTimelineStore.setState(initial));

  it('names a figure that cannot be seen in the tool result', async () => {
    useTimelineStore.setState({ tracks: [createMockTrack({ id: 'v0', type: 'video' })], clips: [], clipKeyframes: new Map() });
    const hidden = await executeAITool('createRig', { start: 0, params: { scale: 0 } }, 'devBridge');
    expect(hidden.success).toBe(true);
    expect((hidden.data as { warnings?: string[] }).warnings?.join(' ')).toMatch(/no size/);
    const offFrame = await executeAITool('createRig', { start: 0, x: 9000 }, 'devBridge');
    expect((offFrame.data as { warnings?: string[] }).warnings?.join(' ')).toMatch(/outside its layer/);
    const fine = await executeAITool('createRig', { start: 0 }, 'devBridge');
    expect((fine.data as { warnings?: string[] }).warnings).toBeUndefined();
  });
});

describe('Memory Leak warnings', () => {
  it('names the values the window planner and decoder replace', () => {
    expect(memoryLeakWarnings(getDefaultParams('memory-leak'))).toEqual([]);
    const notes = memoryLeakWarnings({ ...getDefaultParams('memory-leak'), size: 4000, offset: -2, stride: -1, floatGain: -3, mix: 1.5, depth: '24', motion: 'loop' });
    expect(notes.map(note => note.split(':')[0])).toEqual(['size', 'offset', 'stride', 'floatGain', 'mix', 'depth', 'motion']);
    expect(notes[0]).toMatch(/renders as 1024/);
  });
});

// The fragment modules as the pipeline builds them: the shared common WGSL plus the effect shader.
const NAGA = [process.env.NAGA, join(homedir(), '.cargo/bin/naga'), '/usr/local/bin/naga', '/usr/bin/naga'].find(path => path && existsSync(path));
describe.skipIf(!NAGA)('Generate effect WGSL', () => {
  it.each([['color-wheel', colorWheel.shader], ['perspective-grid', perspectiveGrid.shader], ['stick-figure', stickFigure.shader]])('%s passes the naga validator', (name, shader) => {
    const directory = mkdtempSync(join(tmpdir(), 'generate-wgsl-'));
    try {
      const file = join(directory, `${name}.wgsl`);
      writeFileSync(file, `${common}\n${shader}`);
      expect(() => execFileSync(NAGA!, [file], { stdio: 'pipe' })).not.toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
