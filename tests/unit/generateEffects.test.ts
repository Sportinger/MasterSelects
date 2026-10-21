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
import { normalizeSkeleton, SKELETON_COORDINATE_LIMIT, solveSkeleton } from '../../src/services/rig/skeletonRig';
import { executeAITool } from '../../src/services/aiTools';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockTrack } from '../helpers/mockData';

type Params = Record<string, number | boolean | string>;
const pack = (definition: typeof perspectiveGrid, params: Params, width = 1920, height = 1080, time = 0) =>
  Array.from(definition.packUniforms({ ...getDefaultParams(definition.id), ...params }, width, height, time) ?? []);
// Values keyframes, bezier overshoot and tools can deliver without any clamping.
const HOSTILE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1e12, 1e12, 0, -0.5];

describe('Perspective Grid', () => {
  const field = { horizon: 0, columns: 1, rows: 2, scroll: 3, linePixels: 4, fade: 5, opacity: 6, blend: 7, width: 12, height: 13 } as const;

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
});

describe('Color Wheel', () => {
  const field = { hueOffset: 0, saturation: 1, value: 2, mix: 3, aspect: 4, shape: 5, shortSide: 6 } as const;

  it('wraps Hue Rotation plus Spin × time into one turn and shows both in degrees', () => {
    expect(pack(colorWheel, { rotation: 0.25, spin: 1 }, 1920, 1080, 10.5)[field.hueOffset]).toBeCloseTo(0.75, 6);
    expect(pack(colorWheel, { rotation: -0.25, spin: 0 })[field.hueOffset]).toBeCloseTo(0.75, 6);
    expect(pack(colorWheel, { rotation: 0, spin: 0.37 }, 1920, 1080, 123456.789)[field.hueOffset]).toBeCloseTo((0.37 * 123456.789) % 1, 4);
    expect(COLOR_WHEEL_PARAMS.rotation).toMatchObject({ displayScale: 360, unit: '°' });
  });

  it('fills the layer for wheels saved without Shape and draws a disc only when asked', () => {
    expect(colorWheel.packUniforms({ rotation: 0, saturation: 1.2, value: 1, mix: 1 }, 1920, 1080, 0)?.[field.shape]).toBe(0);
    expect(pack(colorWheel, {})[field.shape]).toBe(0);
    expect(pack(colorWheel, { shape: 'disc' }, 1280, 720)[field.shape]).toBe(1);
    expect(pack(colorWheel, { shape: 'disc' }, 1280, 720)[field.shortSide]).toBe(720);
    expect(colorWheel.paramWarnings?.({ ...getDefaultParams('color-wheel'), shape: 'ring' })).toEqual(['shape: "ring" is not an option; using fill.']);
    // A one-sided render range names its limit instead of an infinite end.
    expect(paramRangeNotes(COLOR_WHEEL_PARAMS, { saturation: -1 })[0].message).toBe('Saturation -1 is below the rendered minimum (0) and renders as 0.');
  });

  it.each(HOSTILE)('packs only finite values for %s', value => {
    const data = pack(colorWheel, { rotation: value, spin: value, saturation: value, value, mix: value }, 1920, 1080, 5);
    expect(data.every(Number.isFinite)).toBe(true);
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
