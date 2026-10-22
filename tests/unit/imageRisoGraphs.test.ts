import { describe, expect, it } from 'vitest';
import { colorToRgba } from '../../src/effects/_shared/catalogColor';
import { riso, risoGlow } from '../../src/effects/halftone';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { createDefaultRisoGraph, createEarlierRisoGraph } from '../../src/services/operators/risoEffectGraphs';
import { createRisoPrintGraph, hasEarlierRisoParams, RISO_PAPER, RISO_SLIP } from '../../src/services/operators/risoPrintEffectGraph';

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
  return evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [(pixel[0] + .5) / resolution[0], (pixel[1] + .5) / resolution[1]], resolution,
    timelineTimeSeconds: 0, sampleImage: picture });
}
const flat = (rgba: Rgba) => (): Rgba => rgba;

describe('Riso image graphs', () => {
  it('binds the print recipe and the earlier recipes to catalog-owned parameters', () => {
    const print = createDefaultRisoGraph('riso');
    for (const [nodeId, parameterId] of [['scale', 'scale'], ['dot-size', 'dotSize'], ['amount', 'amount'], ['color-a', 'colorA'], ['color-b', 'colorB']] as const) {
      expect(print.nodes.find(node => node.id === nodeId)?.bindings).toEqual({ value: parameterId });
    }
    // Dot Size and Registration count pixels of a 1080p frame.
    expect(print.nodes.map(node => node.id)).toEqual(expect.arrayContaining(['safe-dot-size-pixels', 'registration-frame-pixels', 'frame-scale']));
    for (const graph of [createEarlierRisoGraph('riso'), createDefaultRisoGraph('riso-glow')]) {
      for (const [nodeId, parameterId] of [['scale', 'scale'], ['amount', 'amount'], ['color-a', 'colorA'], ['color-b', 'colorB']] as const) {
        expect(graph.nodes.find(node => node.id === nodeId)?.bindings).toEqual({ value: parameterId });
      }
    }
    expect(createDefaultRisoGraph('riso-glow').nodes.find(node => node.id === 'speed')?.bindings).toEqual({ value: 'speed' });
  });

  it.each([['riso', riso], ['riso-glow', risoGlow]] as const)('keeps the earlier %s operation order', (type, definition) => {
    const params = { scale: 8, amount: .7, speed: 1.3, colorA: definition.params.colorA.default as string, colorB: definition.params.colorB.default as string };
    const uv: [number, number] = [.63, .41], resolution: [number, number] = [64, 37], time = .75, offset = params.scale * (Math.min(...resolution) / 1080) / resolution[0] * .35;
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
    const ids = (params: Record<string, unknown>) => effectOperatorGraph({ id: 'fx', type: 'riso', name: 'Riso', enabled: true, params } as never)?.nodes.map(node => node.id) ?? [];
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
});
