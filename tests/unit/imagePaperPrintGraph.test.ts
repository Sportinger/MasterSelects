import { describe, expect, it } from 'vitest';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { paperPrint } from '../../src/effects/halftone';
import { PAPER_PRINT_PRESETS } from '../../src/effects/halftone/paperPrint';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';
import { createEarlierPaperPrintGraph, hasEarlierPaperPrintParams } from '../../src/services/operators/paperPrintEffectGraph';
import { createDefaultPaperPrintGraph, PAPER_PRINT_EVEN } from '../../src/services/operators/paperPrintGrainGraph';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { IMAGE_EFFECT_GRAPH_LIMITS } from '../../src/services/operators/effectGraphLimits';
import { evaluateFractalNoise2d } from '../../src/services/operators/imageNoiseSemantics';

type Rgba = [number, number, number, number];
type Params = Record<string, number | string | boolean>;
/** Pattern sizes count pixels of a 1080p frame (patternReferenceFrame.ts): size × shorter side / 1080, at least one pixel. */
const px = (size: number, resolution: readonly number[]) => Math.max(size * (Math.min(resolution[0], resolution[1]) / 1080), 1);
const toLinear = (c: number) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const toSrgb = (c: number) => c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055;
const light = (rgb: readonly number[]) => .2126 * toLinear(rgb[0]) + .7152 * toLinear(rgb[1]) + .0722 * toLinear(rgb[2]);
const defaults = Object.fromEntries(Object.entries(paperPrint.params).map(([id, spec]) => [id, spec.default])) as Params;
/** Black ink on white paper: the printed light is 1 − ink coverage. */
const blackOnWhite: Params = { colorA: '#000000', colorB: '#ffffff', amount: 1 };

function printer(params: Params, resolution: [number, number] = [1920, 1080]) {
  const plan = compileImageOperatorGraph(createDefaultPaperPrintGraph(), { ...defaults, ...params }, { parameterSchema: paperPrint.params });
  return (pixel: [number, number], picture: Rgba | ((uv: [number, number]) => Rgba)) => evaluateImageOperatorPlan(plan, [0, 0, 0, 0], {
    uv: [(pixel[0] + .5) / resolution[0], (pixel[1] + .5) / resolution[1]], resolution,
    sampleImage: typeof picture === 'function' ? picture : () => picture }) as Rgba;
}
/** A flat grey whose linear light is `value`. */
const grey = (value: number): Rgba => { const c = toSrgb(value); return [c, c, c, 1]; };
/** Pixels on a coarse grid, so neighbouring samples sit in different grains. */
const grid = (count: number, step = 3, origin = 200): Array<[number, number]> =>
  Array.from({ length: count * count }, (_, index) => [origin + (index % count) * step, origin + Math.floor(index / count) * step]);

describe('Paper Print image graph', () => {
  it('binds the grain print to catalog parameters and measures its sizes in 1080p pixels', () => {
    const graph = createDefaultPaperPrintGraph();
    expect(graph.nodes.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.nodes);
    expect(graph.edges.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.edges);
    for (const [nodeId, parameterId] of [['scale', 'scale'], ['texture', 'texture'], ['amount', 'amount'], ['color-a', 'colorA'], ['color-b', 'colorB']] as const) {
      expect(graph.nodes.find(node => node.id === nodeId)?.bindings).toEqual({ value: parameterId });
    }
    expect(graph.nodes.map(node => node.id)).toEqual(expect.arrayContaining(['frame-scale', 'scale-clamped-pixels', 'texture-size-frame-pixels',
      'scale-clamped', 'texture-clamped']));
    expect(graph.nodes.filter(node => node.operator === 'noise.fractal2d.vec2')).toHaveLength(2);
    expect(graph.nodes.some(node => node.operator.includes('paper-print'))).toBe(false);
  });

  it('evens the grain out: the Even Out curve spreads the two-octave noise uniformly over 0..1', () => {
    const values: number[] = [];
    for (let i = 0; i < 160; i++) for (let j = 0; j < 160; j++) values.push(evaluateFractalNoise2d([i * .173 + 5.3, j * .181 + 1.7], 2, .5) - .5);
    const even = values.map(x => 1 / (1 + Math.exp(-(PAPER_PRINT_EVEN.linear * x + PAPER_PRINT_EVEN.cubic * x ** 3)))).toSorted((a, b) => a - b);
    for (const share of [.05, .1, .25, .5, .75, .9, .95]) expect(even[Math.floor(share * (even.length - 1))]).toBeCloseTo(share, 1);
    for (const share of [.1, .25, .5, .75, .9]) expect(Math.abs(even[Math.floor(share * (even.length - 1))] - share)).toBeLessThan(.02);
  });

  it('keeps the picture\'s brightness over an area: the ink covers exactly its share (Texture 0), also on whole-pixel grains', () => {
    // An upright grain of whole pixels would read the same spots of every cell (2–4 % too dark or light); the turned grain reads them all.
    for (const scale of [1, 2, 3]) {
      const print = printer({ ...blackOnWhite, scale, texture: 0 });
      for (const value of [.05, .18, .5, .8, .95]) {
        const samples = grid(90, 2 + scale, 100).map(pixel => light(print(pixel, grey(value))));
        const mean = samples.reduce((sum, item) => sum + item, 0) / samples.length;
        expect(Math.abs(mean - value), `Grain Size ${scale}, light ${value}`).toBeLessThan(.02);
      }
    }
  });

  it('prints white as clean paper and black as solid ink, also on coloured ink and paper', () => {
    for (const texture of [0, .5, 1]) {
      const print = printer({ texture, colorA: '#3a2416', colorB: '#eee0c4', amount: 1 });
      for (const pixel of grid(20, 7)) {
        // Paper is shaded by its surface (±fibre × Texture), never inked: within the fibre shading of the paper colour.
        const white = print(pixel, [1, 1, 1, 1]);
        expect(Math.abs(light(white) - light([0xee / 255, 0xe0 / 255, 0xc4 / 255]))).toBeLessThanOrEqual(.2 * texture * .8 + 1e-6);
      }
    }
    const flat = printer({ texture: 0, colorA: '#3a2416', colorB: '#eee0c4', amount: 1 });
    for (const pixel of grid(20, 7)) {
      expect(flat(pixel, [0, 0, 0, 1]).slice(0, 3).map(c => Math.round(c * 255))).toEqual([0x3a, 0x24, 0x16]);
      expect(flat(pixel, [1, 1, 1, 1]).slice(0, 3).map(c => Math.round(c * 255))).toEqual([0xee, 0xe0, 0xc4]);
    }
  });

  it('lets Texture show the paper in the mid tones, more with more Texture, and keeps solid ink solid', () => {
    const specks = (texture: number, grey: number) => {
      const print = printer({ ...blackOnWhite, texture });
      const samples = grid(60, 2).map(pixel => light(print(pixel, [grey, grey, grey, 1])));
      return samples.filter(value => value > .5).length / samples.length;
    };
    // Solid black stays solid at every Texture: the valleys fade out with the ink's share (valley-lift-faded).
    for (const texture of [0, .5, 1]) expect(specks(texture, 0)).toBe(0);
    // A dark grey (ink share about 0.85) shows more paper the more Texture there is.
    const flat = specks(0, .42), middle = specks(.5, .42), full = specks(1, .42);
    expect(middle).toBeGreaterThan(flat + .005);
    expect(full).toBeGreaterThan(middle);
    expect(full).toBeLessThan(flat + .15);
  });

  it('draws the ink edge one output pixel soft at every Grain Size', () => {
    for (const scale of [4, 12, 30]) {
      const print = printer({ ...blackOnWhite, scale, texture: 0 });
      let crossings = 0, partial = 0, previous: boolean | undefined;
      for (let x = 0; x < 1600; x++) {
        const value = 1 - light(print([x + 100, 400], grey(.5)));
        if (value > .03 && value < .97) partial++;
        const inked = value >= .5; if (previous !== undefined && inked !== previous) crossings++; previous = inked;
      }
      expect(crossings).toBeGreaterThan(1600 / px(scale, [1920, 1080]) / 4);
      const perCrossing = partial / crossings;
      expect(perCrossing).toBeGreaterThan(.5);
      expect(perCrossing).toBeLessThan(2.2);
    }
  });

  it('counts Grain Size in pixels of a 1080p frame: a 4K frame shows the same grain, twice as large', () => {
    const hd = printer({ ...blackOnWhite, scale: 6, texture: .5 }), uhd = printer({ ...blackOnWhite, scale: 6, texture: .5 }, [3840, 2160]);
    let agree = 0, total = 0;
    for (const [x, y] of grid(24, 9, 100)) {
      const a = light(hd([x, y], grey(.4))), b = light(uhd([2 * x + .5, 2 * y + .5], grey(.4)));
      if (Math.abs(a - .5) > .3 && Math.abs(b - .5) > .3) { total++; if ((a > .5) === (b > .5)) agree++; }
    }
    expect(agree / total).toBeGreaterThan(.97);
  });

  it('prints light ink on dark paper the other way round, and stays finite when Ink and Paper are equally bright', () => {
    const blueprint = printer({ texture: 0, colorA: '#ffffff', colorB: '#000000', scale: 1 });
    const mean = (value: number) => grid(40).reduce((sum, pixel) => sum + light(blueprint(pixel, grey(value))), 0) / 1600;
    expect(Math.abs(mean(.25) - .25)).toBeLessThan(.03);
    blueprint([300, 300], [1, 1, 1, 1]).slice(0, 3).forEach(channel => expect(channel).toBeCloseTo(1, 12));
    const same = printer({ colorA: '#808080', colorB: '#808080' });
    for (const value of [0, .2, .5, 1]) expect(same([400, 300], grey(value)).every(Number.isFinite)).toBe(true);
    expect(paperPrint.paramWarnings?.({ ...defaults, colorA: '#808080', colorB: '#808080' }).join(' ')).toMatch(/equally bright/);
    expect(paperPrint.paramWarnings?.({ ...defaults, colorA: '#808080', colorB: '#8a8a8a' }).join(' ')).toMatch(/almost equally bright/);
    expect(paperPrint.paramWarnings?.(defaults)).toEqual([]);
  });

  it('keeps the picture\'s alpha and returns the picture at Amount 0', () => {
    const picture: Rgba = [.2, .6, .35, .43];
    expect(printer({ amount: 0 })([500, 500], picture)).toEqual(picture);
    expect(printer({})([500, 500], picture)[3]).toBe(.43);
    const coordinates: Array<[number, number]> = [];
    printer({})([0, 1079], uv => { coordinates.push(uv); return picture; });
    expect(coordinates).toEqual([[.001, .999]]);
  });

  it('reports values it clamps: Texture below 0 and Grain Size below 1', () => {
    const graph = createDefaultPaperPrintGraph();
    expect(paramRangeNotes(paperPrint.params, { texture: -.5, scale: .5 }, graph).map(note => note.message)).toEqual([
      'Grain Size 0.5 is below the rendered minimum (1) and renders as 1.', 'Texture -0.5 is below the rendered minimum (0) and renders as 0.']);
    const at = (params: Params) => printer({ ...blackOnWhite, ...params })([640, 360], grey(.3));
    expect(at({ texture: -.5 })).toEqual(at({ texture: 0 }));
    expect(at({ scale: .5 })).toEqual(at({ scale: 1 }));
  });

  it('declares presets whose values stay inside every control\'s range', () => {
    expect(PAPER_PRINT_PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(PAPER_PRINT_PRESETS.length).toBeLessThanOrEqual(5);
    for (const preset of PAPER_PRINT_PRESETS) for (const [id, value] of Object.entries(preset.params)) {
      const spec = paperPrint.params[id];
      expect(spec, `${preset.name}: ${id}`).toBeDefined();
      if (spec.type === 'number') { expect(value).toBeGreaterThanOrEqual(spec.min!); expect(value).toBeLessThanOrEqual(spec.max!); }
    }
  });

  it('keeps the earlier recipe for a graph-less Paper Print saved before Texture', () => {
    const earlier = { scale: 18, amount: .75, colorA: '#111827', colorB: '#f8fafc' };
    expect(hasEarlierPaperPrintParams(earlier)).toBe(true);
    expect(hasEarlierPaperPrintParams({ ...earlier, texture: .5 })).toBe(false);
    const loaded = (params: Record<string, unknown>) => migratePersistedEffectOperatorGraph({ id: 'fx', type: 'paper-print', name: 'Paper Print', enabled: true, params } as never).operatorGraph!;
    expect(matchesEffectRecipe(loaded(earlier), createEarlierPaperPrintGraph())).toBe(true);
    expect(matchesEffectRecipe(loaded({ ...earlier, texture: .5 }), createDefaultPaperPrintGraph())).toBe(true);
    expect(paperPrint.paramWarnings?.(earlier).join(' ')).toMatch(/saved before Texture/);
    // Values saved before they existed render as before.
    expect(paperPrint.params.scale.legacyDefault).toBe(18);
    expect(paperPrint.params.amount.legacyDefault).toBe(.75);
    expect(paperPrint.params.colorA.legacyDefault).toBe('#111827');
    expect(paperPrint.params.colorB.legacyDefault).toBe('#f8fafc');
  });
});

// The earlier recipe, unchanged: kept for graph-less saves from before Texture.
const fract = (value: number) => value - Math.floor(value);
const hash = ([u, v]: [number, number]) => fract(Math.sin((u * 127.1 + v * 311.7) * 12.9898 + (u * 269.5 + v * 183.3) * 78.233) * 43758.5453);
function noise([x, y]: [number, number]) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = fract(x), fy = fract(y), ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const row0 = hash([ix, iy]) * (1 - ux) + hash([ix + 1, iy]) * ux;
  const row1 = hash([ix, iy + 1]) * (1 - ux) + hash([ix + 1, iy + 1]) * ux;
  return row0 * (1 - uy) + row1 * uy;
}
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const smoothstep = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };

describe('Paper Print earlier image graph', () => {
  it('is a granular bounded graph with canonical catalog bindings', () => {
    const graph = createEarlierPaperPrintGraph();
    expect(graph.nodes.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.nodes);
    expect(graph.nodes.filter(node => node.operator === 'noise.hash2d.vec2')).toHaveLength(4);
    expect(graph.nodes.find(node => node.id === 'scale')?.bindings).toEqual({ value: 'scale' });
    expect(graph.nodes.find(node => node.id === 'color-a')?.bindings).toEqual({ value: 'colorA' });
    expect(graph.nodes.some(node => node.id === 'texture')).toBe(false);
  });

  it('matches legacy grain, press, paper modulation, mix order and source alpha', () => {
    const params = { amount: .72, scale: 18, colorA: '#204060', colorB: '#e0c080' };
    const plan = compileImageOperatorGraph(createEarlierPaperPrintGraph(), params);
    const uv: [number, number] = [.37, .62], resolution: [number, number] = [47, 29], color: Rgba = [.2, .6, .35, .43];
    // Exactly as 3.2.7 drew it: Press Grain in output pixels.
    const grain = noise([Math.floor(uv[0] * resolution[0]) / 18, Math.floor(uv[1] * resolution[1]) / 18]) - .5;
    const luma = color[0] * .2126 + color[1] * .7152 + color[2] * .0722, pressed = smoothstep(.15, .85, luma + grain * .3);
    const inkA = [0x20 / 255, 0x40 / 255, 0x60 / 255], inkB = [0xe0 / 255, 0xc0 / 255, 0x80 / 255];
    const factor = .92 + grain * .08;
    const expected = color.slice(0, 3).map((channel, index) => mix(channel, mix(inkA[index], inkB[index], pressed) * factor, params.amount));
    const actual = evaluateImageOperatorPlan(plan, color, { uv, resolution, sampleImage: () => color });
    expected.forEach((channel, index) => expect(actual[index]).toBeCloseTo(channel, 12));
    expect(actual[3]).toBe(color[3]);
  });
});
