// Halftone and Pattern Halftone share one dot screen (createDefaultHalftoneGraph): turned around the frame
// centre in pixels (round dots on every frame shape), cells in pixels of a 1080p frame, edges one pixel soft.
// Halftone reads its tone per cell in linear light (one clean circle per cell, exact coverage, solid black).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import common from '../../src/effects/_shared/commonShader';
import { halftone, patternHalftone } from '../../src/effects/halftone';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { createDefaultHalftoneGraph, HALFTONE_DOT, HALFTONE_OWN_WEIGHT, HALFTONE_TAPS } from '../../src/services/operators/halftoneEffectGraphs';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

type Rgba = [number, number, number, number];
type Picture = (uv: [number, number]) => Rgba;
/** Pattern sizes count pixels of a 1080p frame (patternReferenceFrame.ts): size × shorter side / 1080, at least one pixel. */
const px = (size: number, resolution: readonly number[]) => Math.max(size * (Math.min(resolution[0], resolution[1]) / 1080), 1);
const gradient: Picture = ([u, v]) => [.2 + u * .3, .25 + v * .5, .4 - u * .2, 1];
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const linear = (c: number) => (Math.abs(c) <= .04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + .055) / 1.055) ** 2.4);
const light = (c: Rgba) => .2126 * linear(c[0]) + .7152 * linear(c[1]) + .0722 * linear(c[2]);
const luma = (c: Rgba) => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
const clampUv = (uv: [number, number]): [number, number] => [Math.min(Math.max(uv[0], .001), .999), Math.min(Math.max(uv[1], .001), .999)];
const turn = ([x, y]: [number, number], angle: number): [number, number] => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
const INK = [17, 24, 39].map(value => value / 255), PAPER = [248, 250, 252].map(value => value / 255);

function reference(type: 'halftone' | 'pattern-halftone', uv: [number, number], resolution: [number, number], params: Record<string, number | string>, picture: Picture): number[] {
  const angle = Number(params.angle) * Math.PI / 180, cells = px(Math.max(Number(params.scale), 2), resolution), edge = .5 / cells;
  const center: [number, number] = [resolution[0] / 2, resolution[1] / 2];
  const turned = turn([uv[0] * resolution[0] - center[0], uv[1] * resolution[1] - center[1]], angle);
  const screen: [number, number] = [turned[0] + center[0], turned[1] + center[1]];
  const cell = screen.map(value => value / cells - Math.floor(value / cells) - .5) as [number, number];
  const color = picture(clampUv(uv));
  let mark: number;
  if (type === 'halftone') {
    const middle = turn([(Math.floor(screen[0] / cells) + .5) * cells - center[0], (Math.floor(screen[1] / cells) + .5) * cells - center[1]], -angle);
    const middleUv: [number, number] = [(middle[0] + center[0]) / resolution[0], (middle[1] + center[1]) / resolution[1]];
    const stepX = turn([cells / 4, 0], -angle), stepY = turn([0, cells / 4], -angle);
    let lightSum = light(color) * color[3] * HALFTONE_OWN_WEIGHT, alphaSum = color[3] * HALFTONE_OWN_WEIGHT;
    for (const [x, y] of HALFTONE_TAPS) {
      const tap = picture(clampUv([middleUv[0] + (x * stepX[0] + y * stepY[0]) / resolution[0], middleUv[1] + (x * stepX[1] + y * stepY[1]) / resolution[1]]));
      lightSum += light(tap) * tap[3]; alphaSum += tap[3];
    }
    const darkness = Math.min(Math.max(1 - lightSum / Math.max(alphaSum, 1e-6), 0), 1);
    const radius = darkness > HALFTONE_DOT.touch ? HALFTONE_DOT.corner - Math.sqrt(1 - darkness) * HALFTONE_DOT.cornerReach : Math.sqrt(darkness / Math.PI);
    const dot = radius + (darkness * 2 - 1) * edge;
    mark = 1 - smooth(dot - edge, dot + edge, Math.hypot(...cell));
  } else {
    const radius = (1 - luma(color)) * .72, shape = params.shape;
    const distance = shape === 'circle' ? Math.hypot(...cell) : shape === 'diamond' ? Math.abs(cell[0]) + Math.abs(cell[1]) : Math.abs(cell[1]);
    mark = 1 - smooth(radius - edge, radius + edge, distance);
  }
  const ink = String(params.colorA) === '#111827' ? INK : [0, 0, 0], paper = String(params.colorB) === '#f8fafc' ? PAPER : [1, 1, 1];
  const amount = Number(params.amount);
  return [0, 1, 2].map(index => color[index] * (1 - amount) + (paper[index] * (1 - mark) + ink[index] * mark) * amount).concat(color[3]);
}

function evaluate(type: 'halftone' | 'pattern-halftone', params: Record<string, number | string>, uv: [number, number], resolution: [number, number], picture: Picture) {
  const definition = type === 'halftone' ? halftone : patternHalftone;
  const plan = compileImageOperatorGraph(createDefaultHalftoneGraph(type), { ...getDefaultParams(type), ...params }, { parameterSchema: definition.params });
  return evaluateImageOperatorPlan(plan, picture(clampUv(uv)), { uv, resolution, sampleImage: picture });
}

describe('halftone image graph factories', () => {
  it.each([['halftone', halftone], ['pattern-halftone', patternHalftone]] as const)('binds %s to catalog-owned parameters and passes the editor validation', (type, definition) => {
    const graph = createDefaultHalftoneGraph(type);
    for (const [nodeId, parameterId] of [['scale', 'scale'], ['amount', 'amount'], ['angle', 'angle'], ['color-a', 'colorA'], ['color-b', 'colorB']] as const) {
      expect(graph.nodes.find(node => node.id === nodeId)?.bindings).toEqual({ value: parameterId });
    }
    expect(graph.nodes.find(node => node.id === 'shape')?.bindings).toEqual(type === 'pattern-halftone' ? { value: 'shape' } : undefined);
    expect(definition.params.scale.default).toBe(14);
    // The editor path (compositions, folders, connection types) accepts the recipe: alpha reaches math as a scalar.
    expect(() => effectOperatorGraph({ type, params: getDefaultParams(type) } as never)).not.toThrow();
  });

  it.each([['halftone', 'circle'], ['pattern-halftone', 'circle'], ['pattern-halftone', 'diamond'], ['pattern-halftone', 'line']] as const)('matches the %s/%s reference', (type, shape) => {
    const params = { scale: 9.5, amount: .73, angle: 31, colorA: '#111827', colorB: '#f8fafc', shape };
    for (const uv of [[.73, .41], [.12, .88], [.5, .5]] as [number, number][]) {
      const actual = evaluate(type, params, uv, [64, 37], gradient), expected = reference(type, uv, [64, 37], params, gradient);
      expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 9));
    }
  });

  it('keeps dots round when Angle turns the screen on a wide frame', () => {
    // A flat grey: every dot is the same circle. Points at one distance around a dot centre print alike in every direction.
    const grey: Picture = () => [.45, .45, .45, 1], resolution: [number, number] = [1920, 1080];
    for (const type of ['halftone', 'pattern-halftone'] as const) {
      const params = { scale: 60, angle: 45, amount: 1 }, cells = px(60, resolution), angle = Math.PI / 4;
      const middle = turn([3.5 * cells - 960, 3.5 * cells - 540], -angle), center: [number, number] = [middle[0] + 960, middle[1] + 540];
      for (const reach of [.2, .3]) {
        const around = Array.from({ length: 8 }, (_, index) => {
          const direction = index * Math.PI / 4 + .3, point: [number, number] = [center[0] + Math.cos(direction) * reach * cells, center[1] + Math.sin(direction) * reach * cells];
          return evaluate(type, params, [point[0] / 1920, point[1] / 1080], resolution, grey)[0];
        });
        expect(Math.max(...around) - Math.min(...around)).toBeLessThan(1e-4);
      }
    }
  });

  it('prints black as solid ink and white as clean paper, with one dot per cell covering its share', () => {
    const resolution: [number, number] = [1920, 1080], params = { scale: 40, angle: 0, amount: 1, colorA: '#000000', colorB: '#ffffff' };
    const grid = Array.from({ length: 24 * 24 }, (_, index): [number, number] => [(400 + (index % 24 + .5) * 40 / 24) / 1920, (400 + (Math.floor(index / 24) + .5) * 40 / 24) / 1080]);
    const ink = (picture: Picture) => grid.map(uv => 1 - evaluate('halftone', params, uv, resolution, picture)[0]);
    expect(Math.min(...ink(() => [0, 0, 0, 1]))).toBeGreaterThan(.999); // cell corners included
    expect(Math.max(...ink(() => [1, 1, 1, 1]))).toBeLessThan(.001); // cell centres included
    // A flat tone covers its share of the cell, so ink and paper mix back to the picture's light.
    for (const grey of [.25, .5, .75]) {
      const share = ink(() => [grey, grey, grey, 1]).reduce((sum, value) => sum + value, 0) / grid.length;
      expect(share).toBeCloseTo(1 - linear(grey), 1);
    }
  });

  it('draws the dot edge one output pixel soft at every Dot Size', () => {
    const grey: Picture = () => [.6, .6, .6, 1], resolution: [number, number] = [1920, 1080];
    for (const size of [6, 80]) {
      // Along a row through a dot centre: the ink falls from almost 1 to almost 0 within about two pixels.
      const row = Array.from({ length: Math.round(size) * 4 }, (_, index) => 1 - evaluate('halftone', { scale: size, angle: 0, amount: 1, colorA: '#000000', colorB: '#ffffff' },
        [(size * 10 + index / 4) / 1920, (size * 10.5) / 1080], resolution, grey)[0]);
      const soft = row.filter(value => value > .02 && value < .98).length / 4;
      expect(soft).toBeGreaterThan(0);
      expect(soft).toBeLessThanOrEqual(2.5); // two edges of one pixel each, sampled at quarter pixels
    }
  });

  it('reads the cell tone from opaque points only, so a cut-out edge does not darken its dots', () => {
    // Left of x = 940 transparent (black RGB), right of it white: the cell from 920 to 960 px lies across the cut.
    const cutOut: Picture = ([u]) => (u * 1920 < 940 ? [0, 0, 0, 0] : [1, 1, 1, 1]);
    const params = { scale: 40, angle: 0, amount: 1, colorA: '#000000', colorB: '#ffffff' };
    const x = 945; // opaque, in a cell whose two left points (at 930 px) are transparent
    const [red, , , alpha] = evaluate('halftone', params, [x / 1920, 301 / 1080], [1920, 1080], cutOut);
    expect(alpha).toBe(1);
    expect(red).toBeGreaterThan(.99);
  });
});

// The WGSL twins (halftoneFragment, patternHalftoneFragment) as the pipeline would build them.
const NAGA = [process.env.NAGA, join(homedir(), '.cargo/bin/naga'), '/usr/local/bin/naga', '/usr/bin/naga'].find(path => path && existsSync(path));
describe.skipIf(!NAGA)('halftone WGSL twins', () => {
  it('pass the naga validator', () => {
    const directory = mkdtempSync(join(tmpdir(), 'halftone-wgsl-'));
    try {
      const file = join(directory, 'halftone.wgsl');
      writeFileSync(file, `${common}\n${halftone.shader}`);
      expect(() => execFileSync(NAGA!, [file], { stdio: 'pipe' })).not.toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
