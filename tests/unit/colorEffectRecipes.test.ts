import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { COLOR_RECIPE, createDefaultColorEffectGraph, createFormerContrastGraph, type EditableColorEffectType } from '../../src/services/operators/colorEffectGraphs';
import { flattenContrastGraph } from '../../src/services/operators/contrastFlattenUpgrade';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { effectPresentationPlan } from '../../src/services/operators/effectPresentationPlans';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { colorEffectGraphState } from '../../src/services/operators/colorEffectGraphState';
import { createLegacyColorEffectGraph } from '../../src/services/operators/legacyColorEffectGraphs';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';
import { workerSoftwareEffectPlanForLayer } from '../../src/services/render/workerSoftwareEffectPlan';
import { applyWorkerSoftwareImageGraphs } from '../../src/services/render/workerSoftwareImageGraphs';
import type { Layer } from '../../src/types/layers';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { COLOR_COMPOSITIONS } from '../../src/services/operators/colorCompositions';
import { expandOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { extractImageComposition } from '../../src/services/operators/extractImageComposition';
import { effectRecipeFingerprint } from '../../src/services/operators/recipeFingerprint';
import { FORMER_CONTRAST_FINGERPRINT } from '../../src/services/operators/contrastFlattenUpgrade';

/**
 * Independent CPU references for the rebuilt color effects (2026-10). The formulas below are
 * written from the colour science, not from the graphs, and run on texels taken from the
 * effect lab test images (skin, sky, stage haze, deep shadow, neon).
 */
type Pixel = [number, number, number, number];
const TEXELS: Pixel[] = [
  [0.8784, 0.6745, 0.5922, 1], // dancer: lit skin
  [0.6549, 0.5922, 0.5294, 0.6], // dancer: dress, semi-transparent
  [0.2667, 0.1647, 0.098, 1], // dancer: warm stage floor
  [0.1255, 0.2314, 0.298, 1], // dancer: blue haze
  [0.3373, 0.549, 0.7843, 1], // harbour: sky
  [0.0314, 0.0275, 0.098, 1], // street: night shadow
  [0.93, 0.25, 0.78, 1], // street: neon pink
  [0, 0, 0, 1], [1, 1, 1, 1], [0.5, 0.5, 0.5, 0.25],
];

const srgbToLinear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (v: number) => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
const luma709 = (p: readonly number[]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function render(type: EditableColorEffectType, params: Record<string, number>, pixel: Pixel, graph = createDefaultColorEffectGraph(type)) {
  return evaluateImageOperatorPlan(compileImageOperatorGraph(graph, { ...getDefaultParams(type), ...params }), pixel);
}
function expectPixel(actual: number[], expected: number[], digits = 5) {
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, digits));
}
const finite = (pixel: number[]) => pixel.every(Number.isFinite);

/**
 * The former Contrast recipe as a Nodes-tab save stored it before the fade: the Contrast Curve block
 * packed into one instance whose nodeIds list the members the block had then (curve…, input and
 * their literals), next to a Parameters folder.
 */
function packFormerContrast(): EffectOperatorGraph {
  const former = createFormerContrastGraph();
  const block = extractImageComposition(former, { id: 'color.contrast-curve.rgb', label: 'Contrast Curve', description: '', consumers: [],
    members: former.nodes.filter(node => (/^curve/.test(node.id) || node.id === 'input') && !(node.operator === 'values.number' && node.constants)).map(node => node.id) });
  const body = new Set(block.composition!.graph.nodes.map(node => node.id));
  const instance = { id: 'contrast-curve', operator: block.id, operatorVersion: 1, bindings: {},
    composition: { nodeIds: Object.fromEntries([...body].map(id => [id, id])), layout: block.composition!.graph.layout } };
  const edges = new Map<string, EffectOperatorGraph['edges'][number]>();
  for (const edge of former.edges) {
    const inside = [body.has(edge.from), body.has(edge.to)];
    if (inside[0] && inside[1]) continue;
    const packed = inside[1] ? { ...edge, to: instance.id, input: `${edge.from}-${edge.output}` }
      : inside[0] ? { ...edge, from: instance.id, output: `${edge.from}-${edge.output}` } : edge;
    edges.set(`${packed.from}.${packed.output}>${packed.to}.${packed.input}`, { ...packed, id: `e${edges.size}` });
  }
  const parameters = former.nodes.filter(node => node.id.startsWith('amount')).map(node => node.id);
  return { ...former, nodes: [...former.nodes.filter(node => !body.has(node.id)), instance], edges: [...edges.values()],
    layout: { ...Object.fromEntries(Object.entries(former.layout).filter(([id]) => !body.has(id))), [instance.id]: { x: 600, y: 0 } },
    groups: [{ id: 'parameters', label: 'Parameters', color: '#888', nodeIds: parameters }] };
}

describe('rebuilt color effect recipes', () => {
  it.each(['brightness', 'contrast', 'saturation', 'vibrance', 'exposure', 'levels', 'hue-shift', 'temperature'] as const)(
    '%s is the identity at its defaults and keeps alpha', type => {
      for (const texel of TEXELS) expectPixel(render(type, {}, texel), texel, 5);
    });

  it('Brightness lifts mid-tones on an odds curve and keeps black and white', () => {
    for (const amount of [-1, -0.3, 0.15, 0.4, 1]) {
      const gain = 2 ** (COLOR_RECIPE.brightnessStops * amount);
      for (const texel of TEXELS) {
        const expected = texel.slice(0, 3).map(x => x * gain / (x * gain + 1 - x));
        expectPixel(render('brightness', { amount }, texel), [...expected, texel[3]]);
      }
    }
    expectPixel(render('brightness', { amount: 1 }, [0.5, 0.5, 0.5, 1]), [2 ** 2.5 / (2 ** 2.5 + 1), 2 ** 2.5 / (2 ** 2.5 + 1), 2 ** 2.5 / (2 ** 2.5 + 1), 1]);
    // The old flat offset turned black grey; the curve never does.
    expectPixel(render('brightness', { amount: 0.4 }, [0, 0, 0, 1]), [0, 0, 0, 1]);
    expectPixel(render('brightness', { amount: -0.4 }, [1, 1, 1, 1]), [1, 1, 1, 1]);
  });

  it('Contrast is an S-curve with slope Amount at mid-grey that never clips detail', () => {
    for (const amount of [1.3, 2, 3]) {
      for (const texel of TEXELS) {
        const expected = texel.slice(0, 3).map(raw => {
          const x = Math.min(Math.max(raw, COLOR_RECIPE.contrastEdge), 1 - COLOR_RECIPE.contrastEdge);
          return x ** amount / (x ** amount + (1 - x) ** amount);
        });
        expectPixel(render('contrast', { amount }, texel), [...expected, texel[3]]);
      }
    }
    for (const amount of [0, 0.3, 0.5, 1.3, 2, 3]) {
      const epsilon = 1e-4, slope = (render('contrast', { amount }, [0.5 + epsilon, 0, 0, 1])[0] - render('contrast', { amount }, [0.5 - epsilon, 0, 0, 1])[0]) / (2 * epsilon);
      expect(slope).toBeCloseTo(amount, 3);
    }
    // Amount 2 keeps highlight detail the old linear contrast clipped to white.
    const highlights = [0.8, 0.9].map(x => render('contrast', { amount: 2 }, [x, x, x, 1])[0]);
    expect(highlights[0]).toBeLessThan(highlights[1]);
    expect(highlights[1]).toBeLessThan(1);
    expectPixel(render('contrast', { amount: 0 }, [0.8, 0.2, 0.6, 1]), [0.5, 0.5, 0.5, 1]);
  });

  it('Contrast below 1 flattens toward mid-grey without stretching the shadows (2026-10-22 fix)', () => {
    for (const amount of [0, 0.3, 0.6, 0.95]) {
      for (const texel of TEXELS) expectPixel(render('contrast', { amount }, texel), [...texel.slice(0, 3).map(x => 0.5 + (x - 0.5) * amount), texel[3]]);
    }
    // One 8-bit code value above black: the former inverse S turned it into about 40 at Amount 0.3.
    const step = 1 / 255, gain = (graph: ReturnType<typeof createFormerContrastGraph>) =>
      (render('contrast', { amount: 0.3 }, [step, step, step, 1], graph)[0] - render('contrast', { amount: 0.3 }, [0, 0, 0, 1], graph)[0]) / step;
    expect(gain(createFormerContrastGraph())).toBeGreaterThan(30);
    expect(gain(createDefaultColorEffectGraph('contrast'))).toBeCloseTo(0.3, 3);
  });

  it('recognises the former Contrast recipe by its frozen fingerprint', () => {
    // Pinned: a later change to the curve helpers must not quietly change what counts as the former recipe.
    expect(FORMER_CONTRAST_FINGERPRINT).toBe('173cd1faa98e02');
    expect(effectRecipeFingerprint(createFormerContrastGraph())).toBe(FORMER_CONTRAST_FINGERPRINT);
  });

  it('upgrades a former Contrast packed by a Nodes-tab save, whose block instance lists only the former members', () => {
    const packed = packFormerContrast();
    expect(effectRecipeFingerprint(packed)).not.toBe(FORMER_CONTRAST_FINGERPRINT);
    expect(colorEffectGraphState('contrast', packed)).toBe('recipe');
    expect(matchesEffectRecipe(flattenContrastGraph(packed), createDefaultColorEffectGraph('contrast'))).toBe(true);
    const rendered = effectOperatorGraph({ id: 'fx', name: 'contrast', type: 'contrast', enabled: true, params: { amount: 0.3 }, operatorGraph: packFormerContrast() });
    expectPixel(render('contrast', { amount: 0.3 }, [0.1, 0.1, 0.1, 1], rendered), [0.38, 0.38, 0.38, 1]);
    // An edit outside the block is the author's work: kept and reported as edited (the block itself has the fade).
    const edited = packFormerContrast();
    edited.nodes.find(node => node.id === 'amount-render-max')!.constants = { value: 4 };
    expect(flattenContrastGraph(edited)).toBe(edited);
    expect(colorEffectGraphState('contrast', edited)).toBe('edited');
  });

  it('upgrades a saved Contrast of the former recipe and leaves edited graphs alone', () => {
    const former = createFormerContrastGraph();
    const upgraded = flattenContrastGraph(structuredClone(former));
    expect(matchesEffectRecipe(upgraded, createDefaultColorEffectGraph('contrast'))).toBe(true);
    // From Amount 1 up the look is unchanged; only the broken range below 1 changes.
    for (const amount of [1, 1.4, 3]) for (const texel of TEXELS) expectPixel(render('contrast', { amount }, texel, upgraded), render('contrast', { amount }, texel, former));
    const rendered = effectOperatorGraph({ id: 'fx', name: 'contrast', type: 'contrast', enabled: true, params: { amount: 0.3 }, operatorGraph: structuredClone(former) });
    expectPixel(render('contrast', { amount: 0.3 }, [0.1, 0.1, 0.1, 1], rendered), [0.5 - 0.4 * 0.3, 0.5 - 0.4 * 0.3, 0.5 - 0.4 * 0.3, 1]);
    expect(colorEffectGraphState('contrast', structuredClone(former))).toBe('recipe');
    const edited = structuredClone(former);
    edited.nodes.find(node => node.id === 'curve-minimum-slope')!.constants = { value: 0.2 };
    expect(flattenContrastGraph(edited)).toBe(edited);
    const legacy = createLegacyColorEffectGraph('contrast');
    expect(flattenContrastGraph(legacy)).toBe(legacy);
    // A bypassed folder or an incomplete graph is the author's work: kept, and not reported as the recipe.
    const bypassed = { ...structuredClone(former), groups: [{ id: 'g1', label: 'Tone Curve', color: '#888', bypassed: true,
      nodeIds: former.nodes.filter(node => node.id.startsWith('curve')).map(node => node.id) }] };
    expect(flattenContrastGraph(bypassed)).toBe(bypassed);
    expect(colorEffectGraphState('contrast', bypassed)).not.toBe('recipe');
    const incomplete = { ...structuredClone(former), incomplete: 'missing wire' };
    expect(flattenContrastGraph(incomplete)).toBe(incomplete);
    expect(colorEffectGraphState('contrast', incomplete)).not.toBe('recipe');
  });

  it('Saturation mixes Rec.709 luma and stops at the gamut edge without turning the hue', () => {
    for (const texel of TEXELS) {
      const y = luma709(texel);
      expectPixel(render('saturation', { amount: 0 }, texel), [y, y, y, texel[3]]);
      const half = render('saturation', { amount: 0.5 }, texel);
      expectPixel(half, [...texel.slice(0, 3).map(x => y + 0.5 * (x - y)), texel[3]]);
    }
    const sky = TEXELS[4], y = luma709(sky);
    const limit = Math.min(...sky.slice(0, 3).map(x => x > y ? (1 - y) / (x - y) : x < y ? y / (y - x) : Infinity));
    expect(limit).toBeGreaterThan(1.5);
    expectPixel(render('saturation', { amount: 1.5 }, sky), [...sky.slice(0, 3).map(x => y + 1.5 * (x - y)), 1]);
    for (const amount of [3, 10]) {
      const out = render('saturation', { amount }, sky);
      expectPixel(out, [...sky.slice(0, 3).map(x => y + limit * (x - y)), 1]);
      expect(luma709(out)).toBeCloseTo(y, 6);
    }
  });

  it('Vibrance boosts muted colours more than vivid ones and spares skin tones', () => {
    const boost = (pixel: Pixel, amount = 1) => {
      const y = luma709(pixel), out = render('vibrance', { amount }, pixel);
      return Math.hypot(...out.slice(0, 3).map(v => v - luma709(out))) / Math.hypot(...pixel.slice(0, 3).map(v => v - y));
    };
    const muted: Pixel = [0.5, 0.55, 0.6, 1], vivid: Pixel = [0.2, 0.45, 0.8, 1];
    expect(boost(muted)).toBeGreaterThan(boost(vivid));
    // Same HSV saturation and value, skin hue (orange) versus a cool blue: skin moves less.
    const skin: Pixel = [0.8, 0.6, 0.5, 1], cool: Pixel = [0.5, 0.6, 0.8, 1];
    expect(boost(skin)).toBeLessThan(boost(cool) - 0.1);
    expect(boost(skin, -1)).toBeGreaterThan(boost(cool, -1));
    for (const texel of TEXELS) {
      const out = render('vibrance', { amount: 4 }, texel);
      expect(out.slice(0, 3).every(value => value >= -1e-6 && value <= 1 + 1e-6)).toBe(true);
      expect(luma709(out)).toBeCloseTo(luma709(texel), 5);
    }
    expectPixel(render('vibrance', { amount: 1 }, [0.4, 0.4, 0.4, 1]), [0.4, 0.4, 0.4, 1]);
  });

  it('Vibrance spares lit skin but not a dark warm stage floor or strongly saturated orange light', () => {
    // Pairs with the same HSV saturation and value, skin hue (orange) against a cool blue.
    const ratio = (warm: Pixel, cool: Pixel, amount = 0.5) => {
      const chroma = (pixel: number[]) => Math.hypot(...pixel.slice(0, 3).map(v => v - luma709(pixel)));
      return (chroma(render('vibrance', { amount }, warm)) / chroma(warm)) / (chroma(render('vibrance', { amount }, cool)) / chroma(cool));
    };
    // Lit skin (V 0.8, S 0.38) moves clearly less than the blue.
    expect(ratio([0.8, 0.6, 0.5, 1], [0.5, 0.6, 0.8, 1])).toBeLessThan(0.9);
    // The warm stage floor of dancer_stage is dark (V 0.12): no skin, it gets the full boost.
    expect(ratio([0.12, 0.085, 0.06, 1], [0.06, 0.085, 0.12, 1])).toBeCloseTo(1, 2);
    // Tungsten-orange light at S 0.85 is not skin either.
    expect(ratio([0.9, 0.5, 0.135, 1], [0.135, 0.5, 0.9, 1], 0.3)).toBeCloseTo(1, 2);
  });

  it('Exposure works in camera stops in linear light, then applies Offset and Gamma', () => {
    for (const texel of TEXELS) for (const exposure of [-1, 0.5, 1, 2]) {
      const expected = texel.slice(0, 3).map(x => clamp01(linearToSrgb(srgbToLinear(x) * 2 ** exposure)));
      expectPixel(render('exposure', { exposure }, texel), [...expected, texel[3]]);
    }
    // +1 EV doubles the light: mid-grey goes to 0.686, not to white.
    expect(render('exposure', { exposure: 1 }, [0.5, 0.5, 0.5, 1])[0]).toBeCloseTo(linearToSrgb(2 * srgbToLinear(0.5)), 6);
    const toned = render('exposure', { exposure: 1, offset: 0.05, gamma: 1.5 }, TEXELS[2]);
    expectPixel(toned, [...TEXELS[2].slice(0, 3).map(x => clamp01(Math.max(linearToSrgb(srgbToLinear(x) * 2) + 0.05, 0) ** (1 / 1.5))), 1]);
  });

  it('Levels remaps input and output ranges with gamma; equal points threshold, swapped points invert', () => {
    const params = { inputBlack: 0.1, inputWhite: 0.9, gamma: 1.4, outputBlack: 0.05, outputWhite: 0.95 };
    for (const texel of TEXELS) {
      const expected = texel.slice(0, 3).map(x => 0.05 + 0.9 * clamp01((x - 0.1) / 0.8) ** (1 / 1.4));
      expectPixel(render('levels', params, texel), [...expected, texel[3]]);
    }
    const threshold = render('levels', { inputBlack: 0.5, inputWhite: 0.5 }, [0.49, 0.5, 0.51, 1]);
    expectPixel(threshold, [0, 0, 1, 1]);
    expectPixel(render('levels', { inputBlack: 1, inputWhite: 0 }, [0.2, 0.5, 0.9, 1]), [0.8, 0.5, 0.1, 1]);
  });

  it('Temperature and Tint balance white in linear light: black stays black, grey keeps its luminance', () => {
    for (const temperature of [-1, 0.5, 1]) {
      expectPixel(render('temperature', { temperature }, [0, 0, 0, 1]), [0, 0, 0, 1]);
      const grey = render('temperature', { temperature }, [0.4, 0.4, 0.4, 1]);
      const linear = grey.slice(0, 3).map(srgbToLinear);
      expect(luma709(linear)).toBeCloseTo(srgbToLinear(0.4), 5);
      expect(linear[0] / linear[2]).toBeCloseTo(2 ** (2 * COLOR_RECIPE.temperatureStops * temperature), 4);
    }
    const tinted = render('temperature', { tint: 1 }, [0.4, 0.4, 0.4, 1]).slice(0, 3).map(srgbToLinear);
    expect(tinted[0] / tinted[1]).toBeCloseTo(2 ** (1.5 * COLOR_RECIPE.tintStops), 4);
    expect(tinted[0]).toBeCloseTo(tinted[2], 6);
  });

  it('Hue Shift turns hue in OkLCh and keeps lightness, chroma and neutral greys', () => {
    // Published Oklab of sRGB red (Ottosson 2020): L 0.62796, a 0.22486, b 0.12585.
    const redLch = [0.62796, Math.hypot(0.22486, 0.12585), Math.atan2(0.12585, 0.22486) / (2 * Math.PI)];
    expectPixel(render('hue-shift', { shift: 1 }, [1, 0, 0, 1]), [1, 0, 0, 1]);
    expectPixel(render('hue-shift', { shift: 0.37 }, [0.5, 0.5, 0.5, 0.4]), [0.5, 0.5, 0.5, 0.4]);
    const lch = (pixel: number[]) => {
      const [r, g, b] = pixel.slice(0, 3).map(srgbToLinear);
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
      return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, Math.hypot(A, B), Math.atan2(B, A) / (2 * Math.PI)];
    };
    expectPixel(lch([1, 0, 0]), redLch, 4);
    const muted: Pixel = [0.55, 0.45, 0.4, 1];
    for (const shift of [0.1, 0.25, 0.5, -0.3]) {
      const before = lch(muted), after = lch(render('hue-shift', { shift }, muted));
      expect(after[0]).toBeCloseTo(before[0], 4);
      expect(after[1]).toBeCloseTo(before[1], 4);
      expect(((after[2] - before[2] - shift) % 1 + 1.5) % 1 - 0.5).toBeCloseTo(0, 4);
    }
  });

  it('never produces NaN and clamps out-of-range values to the declared render range', () => {
    const cases: [EditableColorEffectType, string, number][] = [
      ['brightness', 'amount', 1e6], ['brightness', 'amount', -1e6], ['contrast', 'amount', -5], ['contrast', 'amount', 1e6],
      ['saturation', 'amount', -2], ['saturation', 'amount', 1e6], ['vibrance', 'amount', -1e6], ['vibrance', 'amount', 1e6],
      ['exposure', 'exposure', 1e6], ['exposure', 'exposure', -1e6], ['exposure', 'gamma', 0], ['exposure', 'gamma', -3], ['exposure', 'gamma', 1e6],
      ['levels', 'gamma', 0], ['levels', 'gamma', -1], ['temperature', 'temperature', 1e6], ['temperature', 'tint', -1e6],
      ['hue-shift', 'shift', 12345.6], ['exposure', 'offset', -50],
    ];
    for (const [type, name, value] of cases) {
      const param = getEffect(type)!.params[name];
      const bounded = Math.min(param.renderMax ?? Infinity, Math.max(param.renderMin ?? -Infinity, value));
      for (const texel of TEXELS) {
        const out = render(type, { [name]: value }, texel);
        expect(finite(out), `${type}.${name}=${value}`).toBe(true);
        if (bounded !== value) expectPixel(out, render(type, { [name]: bounded }, texel), 5);
      }
    }
  });

  it('reports a clamped value only where the instance graph clamps it', () => {
    const definitions = getEffect('saturation')!.params;
    expect(paramRangeNotes(definitions, { amount: -1 })).toHaveLength(1);
    expect(paramRangeNotes(definitions, { amount: -1 }, createDefaultColorEffectGraph('saturation'))).toHaveLength(1);
    // A graph saved before the rebuild renders the raw value, so nothing is claimed for it.
    expect(paramRangeNotes(definitions, { amount: -1 }, createLegacyColorEffectGraph('saturation'))).toEqual([]);
    expect(paramRangeNotes(definitions, { amount: 2 })).toEqual([]);
  });

  it('renders a fresh (unsaved) recipe on the worker software path with the same curve as the GPU graph', () => {
    const layer = { id: 'layer', effects: [{ id: 'fx', type: 'brightness', name: 'Brightness', enabled: true, params: { amount: 0.4 } }] } as unknown as Layer;
    const plan = workerSoftwareEffectPlanForLayer(layer);
    expect(plan?.pixelEffects.imageOperatorPlans).toHaveLength(1);
    const data = new Uint8ClampedArray([51, 128, 0, 255]);
    applyWorkerSoftwareImageGraphs(data, 1, 1, plan!.pixelEffects.imageOperatorPlans!, 0);
    const gain = 2 ** (COLOR_RECIPE.brightnessStops * 0.4), curve = (x: number) => x * gain / (x * gain + 1 - x);
    expect([...data]).toEqual([Math.round(curve(0.2) * 255), Math.round(curve(128 / 255) * 255), 0, 255]);
  });

  it('folds every working node of the Exposure recipe into a stage folder, the Offset splat into Offset & Gamma', () => {
    const graph = createDefaultColorEffectGraph('exposure'), plan = effectPresentationPlan('exposure')!;
    const plumbing = /^(frame|split|output)$|-render-(min|max)$|^tone-zero$|^clamp-(low|high)$/;
    const bound = new Set(['exposure', 'offset', 'gamma']);
    const loose = graph.nodes.filter(node => !plumbing.test(node.id) && !bound.has(node.id) && plan.stage(node as never) === 'processing');
    expect(loose.map(node => node.id)).toEqual([]);
    expect(plan.stage({ id: 'offset-rgb' } as never)).toBe('tone');
    expect(plan.labels.tone).toBe('Offset & Gamma');
  });

  it('folds every working node of the Levels recipe into a stage folder, the colour splats into Input Black & White and Output Range', () => {
    const graph = createDefaultColorEffectGraph('levels'), plan = effectPresentationPlan('levels')!;
    const plumbing = /^(frame|split|output)$|-render-(min|max)$|^range-(zero|minimum)$|^(remap-)?clamp-(low|high)$/;
    const bound = new Set(['inputBlack', 'inputWhite', 'gamma', 'outputBlack', 'outputWhite']);
    const loose = graph.nodes.filter(node => !plumbing.test(node.id) && !bound.has(node.id) && plan.stage(node as never) === 'processing');
    expect(loose.map(node => node.id)).toEqual([]);
    expect(plan.stage({ id: 'inputBlack-rgb' } as never)).toBe('remap');
    expect(['output-range', 'outputBlack-rgb', 'outputWhite-rgb'].map(id => plan.stage({ id } as never))).toEqual(['output', 'output', 'output']);
    expect(plan.labels.output).toBe('Output Range');
  });

  it('the shared Contrast Curve block holds the even fade below 1 too, under its former ports (2026-10-22 fix)', () => {
    const block = COLOR_COMPOSITIONS.find(definition => definition.id === 'color.contrast-curve.rgb')!;
    expect(block.inputs.map(port => [port.id, port.label]).toSorted()).toEqual([['amount-clamped-value', 'Contrast'], ['split-rgb', 'RGB']]);
    // The block alone in a graph: Frame → Split → block (Contrast from a value card) → Combine → Output.
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image', nodes: [
      { id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
      { id: 'split', operator: 'vector.split.rgba', operatorVersion: 1, bindings: {} },
      { id: 'contrast', operator: 'values.number', operatorVersion: 1, bindings: { value: 'amount' } },
      { id: 'block', operator: block.id, operatorVersion: 1, bindings: {} },
      { id: 'combine', operator: 'vector.combine.rgba', operatorVersion: 1, bindings: {} },
      { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} }],
    edges: [
      { id: 'e1', from: 'frame', output: 'image', to: 'split', input: 'image' },
      { id: 'e2', from: 'split', output: 'rgb', to: 'block', input: 'split-rgb' },
      { id: 'e3', from: 'contrast', output: 'value', to: 'block', input: 'amount-clamped-value' },
      { id: 'e4', from: 'block', output: 'curve-value', to: 'combine', input: 'rgb' },
      { id: 'e5', from: 'split', output: 'alpha', to: 'combine', input: 'alpha' },
      { id: 'e6', from: 'combine', output: 'image', to: 'output', input: 'image' }],
    layout: {} };
    const alone = (amount: number, pixel: Pixel) => evaluateImageOperatorPlan(compileImageOperatorGraph(expandOperatorCompositions(graph), { amount }), pixel);
    const step = 1 / 255;
    expect((alone(0.3, [step, step, step, 1])[0] - alone(0.3, [0, 0, 0, 1])[0]) / step).toBeCloseTo(0.3, 3);
    for (const amount of [0.3, 1.5]) for (const texel of TEXELS) expectPixel(alone(amount, texel), render('contrast', { amount }, texel));
    // Driven below 0 from a value card or an oscillator, the block stays plain grey, never a negative.
    for (const amount of [0, -1, -5]) for (const texel of TEXELS) expectPixel(alone(amount, texel), [0.5, 0.5, 0.5, texel[3]]);
  });

  it('presents Contrast as Parameters and one Contrast Curve block, and names the Vibrance hue match', () => {
    const graph = effectOperatorGraph({ id: 'fx', name: 'Contrast', type: 'contrast', enabled: true, params: getDefaultParams('contrast') }, { inspectionOnly: true });
    expect(graph.groups?.map(group => group.label).toSorted()).toEqual(['Constants', 'Contrast Curve', 'Parameters']);
    expect(graph.groups?.find(group => group.label === 'Contrast Curve')?.parentId).toBeUndefined();
    expect(effectPresentationPlan('vibrance')?.portLabels?.['skin-match']).toBe('Skin Hue Match');
  });

  it('keeps the original formulas in the legacy graphs that saved projects still carry', () => {
    const pixel: Pixel = [0.2, 0.4, 0.8, 0.35];
    expectPixel(render('brightness', { amount: 0.15 }, pixel, createLegacyColorEffectGraph('brightness')), [0.35, 0.55, 0.95, 0.35]);
    expectPixel(render('contrast', { amount: 2 }, pixel, createLegacyColorEffectGraph('contrast')), [0, 0.3, 1, 0.35]);
    expectPixel(render('exposure', { exposure: 1 }, pixel, createLegacyColorEffectGraph('exposure')), [0.4, 0.8, 1, 0.35]);
    expectPixel(render('temperature', { temperature: 1 }, pixel, createLegacyColorEffectGraph('temperature')), [0.3, 0.4, 0.7, 0.35]);
    const gray601 = 0.2 * 0.299 + 0.4 * 0.587 + 0.8 * 0.114;
    expectPixel(render('saturation', { amount: 0 }, pixel, createLegacyColorEffectGraph('saturation')), [gray601, gray601, gray601, 0.35]);
  });
});
