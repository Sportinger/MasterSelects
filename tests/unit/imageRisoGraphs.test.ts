import { describe, expect, it } from 'vitest';
import { colorToRgba } from '../../src/effects/_shared/catalogColor';
import { riso, risoGlow } from '../../src/effects/halftone';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { evaluateImagePasses } from '../helpers/imageGraphPasses';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { createDefaultRisoGraph, createEarlierRisoGraph } from '../../src/services/operators/risoEffectGraphs';
import { createRisoGlowGraph, createRisoPrintGraph, hasEarlierRisoParams, RISO_GLOW_PULSE, RISO_PAPER, RISO_SLIP } from '../../src/services/operators/risoPrintEffectGraph';
import type { ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';

type Rgba = [number, number, number, number];
const sample = ([u, v]: [number, number]): Rgba => [u, v, u * .3 + v * .2, .2 + u * .6];
const luma = (value: readonly number[]) => value[0] * .2126 + value[1] * .7152 + value[2] * .0722;
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const toLinear = (c: number) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const toSrgb = (c: number) => c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055;
const defaults = Object.fromEntries(Object.entries(riso.params).map(([id, spec]) => [id, spec.default])) as Record<string, number | string | boolean>;
const paperLinear = RISO_PAPER.map(toLinear);
const inkLinear = (hex: string) => colorToRgba(hex, hex).slice(0, 3).map(toLinear);

function printAt(params: Record<string, number | string | boolean>, pixel: [number, number], picture: (uv: [number, number]) => Rgba,
  resolution: [number, number] = [1920, 1080]) {
  const plan = compileImageOperatorGraph(createRisoPrintGraph(), { ...defaults, ...params }, { parameterSchema: riso.params });
  return evaluateImagePasses(plan, [(pixel[0] + .5) / resolution[0], (pixel[1] + .5) / resolution[1]], resolution, picture);
}
const flat = (rgba: Rgba) => (): Rgba => rgba;
const glowDefaults = Object.fromEntries(Object.entries(risoGlow.params).map(([id, spec]) => [id, spec.default])) as Record<string, number | string | boolean>;

/** Riso Glow at one pixel: its cache pass is evaluated where the gathering pass reads it (point samples). */
function glowAt(params: Record<string, number | string | boolean>, pixel: [number, number], picture: (uv: [number, number]) => Rgba,
  options: { resolution?: [number, number]; time?: number } = {}) {
  const resolution = options.resolution ?? [1920, 1080], timelineTimeSeconds = options.time ?? 0;
  const plan = compileImageOperatorGraph(createRisoGlowGraph(), { ...glowDefaults, ...params }, { parameterSchema: risoGlow.params });
  const producers = new Map((plan.passes ?? []).filter(pass => pass.outputResource).map(pass => [pass.outputResource!, pass.program]));
  const at = (program: ImageOperatorPlan, uv: [number, number]): Rgba => evaluateImageOperatorPlan(program, picture(uv), { uv, resolution,
    timelineTimeSeconds, sampleImage: picture, sampleResource: (id, point) => at(producers.get(id)!, point) }) as Rgba;
  return at(plan.passes!.at(-1)!.program, [(pixel[0] + .5) / resolution[0], (pixel[1] + .5) / resolution[1]]);
}

describe('Riso image graphs', () => {
  it('binds the print recipe and the earlier recipes to catalog-owned parameters', () => {
    const print = createDefaultRisoGraph('riso');
    for (const [nodeId, parameterId] of [['scale', 'scale'], ['dot-size', 'dotSize'], ['amount', 'amount'], ['color-a', 'colorA'], ['color-b', 'colorB']] as const) {
      expect(print.nodes.find(node => node.id === nodeId)?.bindings).toEqual({ value: parameterId });
    }
    // Dot Size and Registration count pixels of a 1080p frame.
    expect(print.nodes.map(node => node.id)).toEqual(expect.arrayContaining(['dotSize-clamped-pixels', 'scale-clamped-frame-pixels', 'frame-scale']));
    for (const graph of [createEarlierRisoGraph('riso'), createEarlierRisoGraph('riso-glow')]) {
      for (const [nodeId, parameterId] of [['scale', 'scale'], ['amount', 'amount'], ['color-a', 'colorA'], ['color-b', 'colorB']] as const) {
        expect(graph.nodes.find(node => node.id === nodeId)?.bindings).toEqual({ value: parameterId });
      }
    }
    const glow = createDefaultRisoGraph('riso-glow');
    for (const [nodeId, parameterId] of [['scale', 'scale'], ['dot-size', 'dotSize'], ['glow', 'glow'], ['speed', 'speed'], ['amount', 'amount'],
      ['color-a', 'colorA'], ['color-b', 'colorB']] as const) expect(glow.nodes.find(node => node.id === nodeId)?.bindings).toEqual({ value: parameterId });
    expect(createEarlierRisoGraph('riso-glow').nodes.find(node => node.id === 'speed')?.bindings).toEqual({ value: 'speed' });
    // Riso Glow is Riso's print plus its Glow stage; the graph leaves room under the 512-node budget for a remix.
    expect(glow.nodes.map(node => node.id)).toEqual(expect.arrayContaining(createRisoPrintGraph().nodes.map(node => node.id)));
    // Room under the 512-node budget for a remix.
    expect(glow.nodes.length).toBeLessThanOrEqual(495);
  });

  it.each([['riso', riso], ['riso-glow', risoGlow]] as const)('keeps the earlier %s operation order', (type, definition) => {
    const params = { scale: 8, amount: .7, speed: 1.3, colorA: definition.params.colorA.default as string, colorB: definition.params.colorB.default as string };
    const uv: [number, number] = [.63, .41], resolution: [number, number] = [64, 37], time = .75, offset = params.scale / resolution[0] * .35; // output pixels, exactly as 3.2.7
    const color = sample(uv), a = 1 - luma(sample([uv[0] - offset, uv[1]])), b = 1 - luma(sample([uv[0] + offset, uv[1]]));
    const colorA = colorToRgba(params.colorA, params.colorA), colorB = colorToRgba(params.colorB, params.colorB), paper = [.96, .93, .85];
    const glow = type === 'riso-glow' ? .55 + .45 * Math.sin(time * params.speed * 2) : 0;
    const expected = [0, 1, 2].map(index => { const subtractive = paper[index] * mix(1, colorA[index], a) * mix(1, colorB[index], b);
      return mix(color[index], subtractive + glow * (a * colorA[index] + b * colorB[index]) * .3, params.amount); }).concat(color[3]);
    const plan = compileImageOperatorGraph(createEarlierRisoGraph(type), params, { parameterSchema: definition.params });
    const actual = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, resolution, timelineTimeSeconds: time, sampleImage: sample });
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10));
  });

  it('keeps a graph-less Riso saved before Dot Size on the earlier recipe and says so in the card', () => {
    const earlier = { scale: 8, amount: .75, angle: 0, colorA: '#2046b3', colorB: '#ef476f' };
    expect(hasEarlierRisoParams(earlier)).toBe(true);
    expect(hasEarlierRisoParams({ ...earlier, dotSize: 6 })).toBe(false);
    const ids = (params: Record<string, unknown>) => migratePersistedEffectOperatorGraph({ id: 'fx', type: 'riso', name: 'Riso', enabled: true, params } as never).operatorGraph?.nodes.map(node => node.id) ?? [];
    expect(ids(earlier)).not.toContain('dark-share');
    expect(ids({ ...earlier, dotSize: 6 })).toContain('dark-share');
    expect(riso.paramWarnings?.(earlier).join(' ')).toMatch(/saved before Dot Size/);
    expect(riso.paramWarnings?.({ ...earlier, dotSize: 6 })).toEqual([]);
    // Dot Size 2 on a 320 × 180 preview is a third of a pixel: it renders one pixel, and the card says so.
    expect(riso.paramWarnings?.({ ...earlier, dotSize: 2 }, 320, 180).join(' ')).toMatch(/renders 1 pixel/);
  });

  it('prints nothing on white, both inks in full on black, and each ink alone where the picture has its colour', () => {
    const paper = printAt({}, [700, 400], flat([1, 1, 1, 1]));
    paper.slice(0, 3).forEach((value, index) => expect(value).toBeCloseTo(RISO_PAPER[index], 4));
    const [dark, warm] = [inkLinear(String(defaults.colorA)), inkLinear(String(defaults.colorB))];
    const black = printAt({}, [700, 400], flat([0, 0, 0, 1]));
    black.slice(0, 3).forEach((value, index) => expect(value).toBeCloseTo(toSrgb(paperLinear[index] * dark[index] * warm[index]), 4));
    // A picture of exactly one ink printed in full on the paper separates into that ink alone.
    for (const ink of [dark, warm]) {
      const printed = ink.map((value, index) => toSrgb(paperLinear[index] * value));
      const result = printAt({}, [701, 403], flat([...printed, 1] as Rgba));
      result.slice(0, 3).forEach((value, index) => expect(value).toBeCloseTo(printed[index], 3));
    }
  });

  it('keeps the light of a two-ink colour over an area of dots (dots cover the share of the cell their ink needs)', () => {
    const [dark, warm] = [inkLinear(String(defaults.colorA)), inkLinear(String(defaults.colorB))];
    // A colour both inks can make: the dark ink at 30 % and the warm ink at 60 % coverage.
    const target = paperLinear.map((paper, index) => paper * (1 - .3 * (1 - dark[index])) * (1 - .6 * (1 - warm[index])));
    const picture = flat([...target.map(toSrgb), 1] as Rgba);
    const total = [0, 0, 0];
    let count = 0;
    for (let y = 300; y < 360; y += 2) for (let x = 600; x < 660; x += 2) {
      printAt({ scale: 0 }, [x, y], picture).slice(0, 3).forEach((value, index) => { total[index] += toLinear(value); }); count++;
    }
    const average = total.map(value => value / count);
    // Two screens at different angles: the area keeps the colour's brightness (Tone) and mixes both inks (Separation:
    // more red than the dark ink alone, more blue than the warm ink alone).
    expect(luma(average) / luma(target)).toBeGreaterThan(.97);
    expect(luma(average) / luma(target)).toBeLessThan(1.03);
    expect(average[0] / average[2]).toBeGreaterThan(dark[0] / dark[2]);
    expect(average[0] / average[2]).toBeLessThan(warm[0] / warm[2]);
    average.forEach((value, index) => expect(Math.abs(value - target[index]) / target[index]).toBeLessThan(.08));
  });

  it('slips the two inks apart by Registration: across a dark edge the warm ink sticks out alone', () => {
    // Black left of x = 960, white right. Registration 20 px slips each drum by 10 px along RISO_SLIP (8 px across).
    const edge = ([u]: [number, number]): Rgba => (u < .5 ? [0, 0, 0, 1] : [1, 1, 1, 1]);
    const warm = inkLinear(String(defaults.colorB)).map((value, index) => toSrgb(paperLinear[index] * value));
    const fringe = printAt({ scale: 20 }, [960, 540], edge);
    fringe.slice(0, 3).forEach((value, index) => expect(value).toBeCloseTo(warm[index], 3));
    expect(RISO_SLIP[0] * 10).toBe(8);
    // In register the same pixel is paper: both inks end at the edge.
    const inRegister = printAt({ scale: 0 }, [970, 540], edge);
    inRegister.slice(0, 3).forEach((value, index) => expect(value).toBeCloseTo(RISO_PAPER[index], 3));
  });

  it('leaves transparent areas without ink and stays finite for any pair of inks', () => {
    const empty = printAt({}, [700, 400], flat([0, 0, 0, 0]));
    expect(empty[3]).toBe(0);
    empty.slice(0, 3).forEach((value, index) => expect(value).toBeCloseTo(RISO_PAPER[index], 4));
    for (const [colorA, colorB] of [['#ef476f', '#ef476f'], ['#ffffff', '#ffffff'], ['#000000', '#000000'], ['#ffffff', '#000000'], ['#f5eed8', '#2046b3']]) {
      for (const picture of [[0, 0, 0, 1], [.5, .5, .5, 1], [1, .2, .1, .4]] as Rgba[]) {
        for (const dotSize of [0, 2, 40]) {
          const result = printAt({ colorA, colorB, dotSize, scale: 32 }, [33, 17], flat(picture));
          result.forEach(value => expect(Number.isFinite(value)).toBe(true));
          result.slice(0, 3).forEach(value => { expect(value).toBeGreaterThanOrEqual(-1e-6); expect(value).toBeLessThanOrEqual(1 + 1e-6); });
        }
      }
    }
  });

  it('mixes the print over the picture by Amount and keeps its alpha', () => {
    const color: Rgba = [.8, .4, .2, .6];
    const off = printAt({ amount: 0 }, [500, 500], flat(color));
    off.forEach((value, index) => expect(value).toBeCloseTo(color[index], 6));
    const full = printAt({ amount: 1 }, [500, 500], flat(color)), half = printAt({ amount: .5 }, [500, 500], flat(color));
    [0, 1, 2].forEach(index => expect(half[index]).toBeCloseTo(mix(color[index], full[index], .5), 6));
    expect(full[3]).toBeCloseTo(.6, 6);
  });
  it('keeps a graph-less Riso Glow saved before Dot Size on the earlier recipe and says so in the card', () => {
    const earlier = { scale: 14, amount: .75, angle: 0, speed: 1, colorA: '#4f46e5', colorB: '#f43f5e' };
    const ids = (params: Record<string, unknown>) => migratePersistedEffectOperatorGraph({ id: 'fx', type: 'riso-glow', name: 'Riso Glow', enabled: true, params } as never).operatorGraph?.nodes.map(node => node.id) ?? [];
    expect(ids(earlier)).not.toContain('glow-cache');
    expect(ids({ ...earlier, dotSize: 6, glow: 1 })).toContain('glow-cache');
    expect(risoGlow.paramWarnings?.(earlier).join(' ')).toMatch(/This Riso Glow was saved before Dot Size/);
    expect(risoGlow.paramWarnings?.({ ...earlier, dotSize: 6, glow: 1 })).toEqual([]);
    // A negative Glow or Registration (a tool call, a keyframe overshoot) renders as 0, and the card says so.
    expect(paramRangeNotes(risoGlow.params, { glow: -.5, scale: -2 }).map(note => note.message)).toEqual([
      'Registration -2 is below the rendered minimum (0) and renders as 0.', 'Glow -0.5 is below the rendered minimum (0) and renders as 0.']);
  });

  it('prints exactly Riso at Glow 0, and keeps black and white as Riso prints them at any Glow', () => {
    const print = (params: Record<string, number | string | boolean>, pixel: [number, number], picture: (uv: [number, number]) => Rgba) =>
      printAt({ colorA: glowDefaults.colorA, colorB: glowDefaults.colorB, ...params }, pixel, picture);
    const scene = ([u, v]: [number, number]): Rgba => [.5 + .4 * Math.sin(u * 30), .4 + .3 * Math.cos(v * 20), u, 1];
    for (const pixel of [[700, 400], [33, 17], [1500, 900]] as [number, number][]) {
      glowAt({ glow: 0 }, pixel, scene).forEach((value, index) => expect(value).toBeCloseTo(print({}, pixel, scene)[index], 6));
    }
    // Black takes both inks in full, so the glow ink is covered there: no glow lifts it.
    glowAt({ glow: 2 }, [700, 400], flat([0, 0, 0, 1])).forEach((value, index) => expect(value).toBeCloseTo(print({}, [700, 400], flat([0, 0, 0, 1]))[index], 4));
    // White prints as paper, and RISO_GLOW_PAPER of the paper's light glows in the glow ink: a white costume blooms.
    const white = glowAt({ glow: 2 }, [700, 400], flat([1, 1, 1, 1]));
    white.slice(0, 3).forEach((value, index) => expect(value).toBeGreaterThanOrEqual(RISO_PAPER[index] - 1e-6));
    expect(white[0] - RISO_PAPER[0]).toBeGreaterThan(white[1] - RISO_PAPER[1]);
    glowAt({ glow: 0 }, [700, 400], flat([1, 1, 1, 1])).slice(0, 3).forEach((value, index) => expect(value).toBeCloseTo(RISO_PAPER[index], 4));
  });

  it('lets the colours of the glow ink shine and spill a few cells into the dark around them, breathing with the pulse', () => {
    // The glow ink printed alone on the paper left of x = 960, black right of it.
    const warm = inkLinear(String(glowDefaults.colorB)).map((value, index) => toSrgb(paperLinear[index] * value));
    const edge = ([u]: [number, number]): Rgba => (u < .5 ? [...warm, 1] as Rgba : [0, 0, 0, 1]);
    const red = (params: Record<string, number | string | boolean>, x: number, time = 0) => glowAt({ scale: 0, ...params }, [x, 540], edge, { time })[0];
    // On the ink: brighter than the plain print. In the dark beside it: a halo that fades within about three cells (18 px).
    expect(red({}, 900)).toBeGreaterThan(red({ glow: 0 }, 900) + .02);
    expect(red({}, 966)).toBeGreaterThan(red({ glow: 0 }, 966) + .1);
    expect(red({}, 972)).toBeGreaterThan(red({ glow: 0 }, 972) + .03);
    expect(red({}, 1010) - red({ glow: 0 }, 1010)).toBeLessThan(.005);
    // Glow 2 shines more; the pulse peaks at second 0 and is lowest at cos = −1 (Speed 1: t = π/2); Speed 0 holds the peak.
    expect(red({ glow: 2 }, 966)).toBeGreaterThan(red({}, 966) + .03);
    const trough = red({}, 966, Math.PI / 2), peak = red({}, 966, 0);
    expect(peak).toBeGreaterThan(trough + .1);
    expect(trough).toBeGreaterThan(red({ glow: 0 }, 966));
    expect(red({ speed: 0 }, 966, Math.PI / 2)).toBeCloseTo(peak, 6);
    expect(RISO_GLOW_PULSE.rest + RISO_GLOW_PULSE.swing).toBe(1);
  });

  it('names a clamped Dot Size or Registration also on a stored Riso or Riso Glow graph (no silent clamp)', () => {
    for (const [definition, graph] of [[riso, createRisoPrintGraph()], [risoGlow, createRisoGlowGraph()]] as const) {
      const notes = paramRangeNotes(definition.params, { dotSize: 1, scale: -2 }, graph).map(note => note.message);
      expect(notes).toEqual(['Dot Size 1 is below the rendered minimum (2) and renders as 2.', 'Registration -2 is below the rendered minimum (0) and renders as 0.']);
    }
  });

  it('keeps the glow inside the picture: transparent areas give no glow and keep their alpha', () => {
    const warm = inkLinear(String(glowDefaults.colorB)).map((value, index) => toSrgb(paperLinear[index] * value));
    const cutOut = ([u]: [number, number]): Rgba => (u < .5 ? [...warm, 1] as Rgba : [0, 0, 0, 0]);
    expect(glowAt({}, [966, 540], cutOut)[3]).toBe(0);
    const empty = glowAt({ glow: 2 }, [700, 400], flat([0, 0, 0, 0]));
    empty.slice(0, 3).forEach((value, index) => expect(value).toBeCloseTo(RISO_PAPER[index], 4));
    for (const [colorA, colorB] of [['#ffffff', '#ffffff'], ['#000000', '#000000'], ['#ffffff', '#000000']]) {
      const result = glowAt({ colorA, colorB, glow: 2, dotSize: 2 }, [33, 17], flat([.5, .5, .5, 1]));
      result.forEach(value => { expect(Number.isFinite(value)).toBe(true); expect(value).toBeGreaterThanOrEqual(-1e-6); expect(value).toBeLessThanOrEqual(1 + 1e-6); });
    }
  });
});
