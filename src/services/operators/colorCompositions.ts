import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition, OperatorEndpoint, OperatorPort } from '../../types/operatorGraph';
import { extractImageComposition } from './extractImageComposition';
import { createDefaultBrightnessGraph, createDefaultContrastGraph, createDefaultExposureGraph, createDefaultHueShiftGraph,
  createDefaultSaturationGraph, createDefaultTemperatureGraph } from './colorEffectGraphs';

const node = (id: string, operator: string): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings: {} });
const endpoint = (nodeId: string, portId: string): OperatorEndpoint => ({ nodeId, portId });
const port = (id: string, label: string, type: OperatorPort['type']): OperatorPort => ({ id, label, type, required: true });
const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });

const hueShiftGraph: EffectOperatorGraph = {
  version: 1,
  schemaVersion: 1,
  domain: 'image',
  nodes: [
    node('hsv', 'convert.rgb-to-hsv'),
    node('split-hsv', 'vector.split.vec3'),
    node('add-shift', 'math.add.scalar'),
    node('wrap-hue', 'math.fract.scalar'),
    node('combine-hsv', 'vector.combine.vec3'),
    node('rgb', 'convert.hsv-to-rgb'),
  ],
  edges: [
    edge('hsv', 'value', 'split-hsv', 'value'),
    edge('split-hsv', 'x', 'add-shift', 'a'),
    edge('add-shift', 'value', 'wrap-hue', 'value'),
    edge('wrap-hue', 'value', 'combine-hsv', 'x'),
    edge('split-hsv', 'y', 'combine-hsv', 'y'),
    edge('split-hsv', 'z', 'combine-hsv', 'z'),
    edge('combine-hsv', 'value', 'rgb', 'value'),
  ],
  layout: {
    hsv: { x: 0, y: 0 }, 'split-hsv': { x: 280, y: 0 }, 'add-shift': { x: 560, y: 0 },
    'wrap-hue': { x: 840, y: 0 }, 'combine-hsv': { x: 1120, y: 0 }, rgb: { x: 1400, y: 0 },
  },
};

const ids = (graph: EffectOperatorGraph, prefix: RegExp) => graph.nodes.filter(node => prefix.test(node.id)
  && !(node.operator === 'values.number' && node.constants)).map(node => node.id);
const rgbIn = { 'split-rgb': 'RGB' };
const consumers = (...effects: string[]) => ['Image graphs', ...effects];

/**
 * The tone, light and colour stages of the rebuilt color effects (2026-10) as shared nodes:
 * each effect graph is its bound parameters plus one of these, and every block is insertable
 * from Reusable Nodes and expandable into its primitives.
 */
// Contrast's block holds both halves of the recipe, Flatten below 1 and the S-curve from 1 up (2026-10-22):
// the S-curve family alone ran an inverse S below 1 that blew shadow noise into colour blotches. Its ports
// (RGB and the clamped Contrast) are the ones the curve-only block had, so saved instances stay valid.
const brightness = createDefaultBrightnessGraph(), contrast = createDefaultContrastGraph(), exposure = createDefaultExposureGraph();
const temperature = createDefaultTemperatureGraph(), saturation = createDefaultSaturationGraph(), hue = createDefaultHueShiftGraph();
const RECIPE_COMPOSITIONS: readonly OperatorDefinition[] = [
  extractImageComposition(brightness, {
    id: 'color.brightness-curve.rgb', label: 'Brightness Curve',
    description: 'Lift (+) or lower (−) mid-tones while black and white stay put: y = x·m / (x·m + 1 − x) with m = 2^(2.5 × Brightness), on 0–1 RGB.',
    members: [...ids(brightness, /^curve/), 'input'], consumers: consumers('Brightness'),
    inputLabels: { ...rgbIn, 'amount-clamped-value': 'Brightness' }, outputLabels: { 'curve-value': 'RGB' },
  }),
  extractImageComposition(contrast, {
    id: 'color.contrast-curve.rgb', label: 'Contrast Curve',
    description: 'Contrast with slope c at mid-grey on 0–1 RGB. From 1 up an S-curve y = x^c / (x^c + (1 − x)^c): black and white stay put and highlights roll off instead of clipping. Below 1 an even fade toward mid-grey, y = 0.5 + (x − 0.5)·c: blacks lift and whites soften, 0 is plain grey.',
    members: [...ids(contrast, /^(curve|flatten)(-|$)|^amount-(steepness|flatten)$/), 'input'], consumers: consumers('Contrast'),
    inputLabels: { ...rgbIn, 'amount-clamped-value': 'Contrast' }, outputLabels: { 'curve-value': 'RGB' },
  }),
  extractImageComposition(exposure, {
    id: 'color.exposure-stops.rgb', label: 'Exposure (Stops)',
    description: 'Multiplies linear light by 2^Stops between sRGB to Linear and Linear to sRGB, like opening the lens: +1 doubles the light. Not clamped.',
    members: ids(exposure, /^light-/), consumers: consumers('Exposure'),
    inputLabels: { ...rgbIn, 'exposure-clamped-value': 'Stops' }, outputLabels: { 'light-encoded-rgb': 'RGB' },
  }),
  extractImageComposition(temperature, {
    id: 'color.white-balance.rgb', label: 'White Balance',
    description: 'Temperature (+ warm, − cool) and Tint (+ magenta, − green) as channel gains in linear light, scaled so grey keeps its brightness and black stays black. Temperature 1 raises red and lowers blue by 0.6 stops each; Tint 1 lowers green 0.5 stops and raises red and blue 0.25. Not clamped.',
    members: [...ids(temperature, /^(gain|light)-/)], consumers: consumers('Temperature'),
    inputLabels: { ...rgbIn, 'temperature-clamped-value': 'Temperature', 'tint-clamped-value': 'Tint' }, outputLabels: { 'light-encoded-rgb': 'RGB' },
  }),
  extractImageComposition(saturation, {
    id: 'color.gamut-saturation.rgb', label: 'Saturation (Gamut-Safe)',
    description: 'Mixes Rec.709 luma and RGB by Amount (0 grey, 1 unchanged), but stops where the first channel reaches 0 or 1, so strong settings keep hue and brightness instead of clipping. Expects 0–1 RGB and Amount ≥ 0.',
    members: ids(saturation, /^gamut-/), consumers: consumers('Saturation', 'Vibrance'),
    inputLabels: { 'input-value': 'RGB', 'amount-clamped-value': 'Amount' }, outputLabels: { 'gamut-mix-value': 'RGB' },
  }),
  extractImageComposition(hue, {
    id: 'color.oklch-hue-rotate.rgb', label: 'Hue Rotate (OkLCh)',
    description: 'Rotates hue in perceptual OkLCh by Shift turns (0.5 = 180°), keeping lightness and chroma, so a rotation does not pump brightness. Not clamped.',
    members: ids(hue, /^hue-/), consumers: consumers('Hue Shift'),
    inputLabels: { ...rgbIn, 'shift-value': 'Shift (turns)' }, outputLabels: { 'hue-rgb-rgb': 'RGB' },
  }),
];

/** Reusable HSV hue rotation assembled entirely from the existing image operators, then the recipe stages above. */
export const COLOR_COMPOSITIONS: readonly OperatorDefinition[] = [...RECIPE_COMPOSITIONS, {
  id: 'color.hue-shift.rgb',
  version: 1,
  label: 'Hue Shift',
  description: 'Rotate RGB hue in HSV space, wrap it in turns, and preserve saturation and value. Open to edit the conversion and math nodes.',
  inputs: [port('rgb', 'RGB', 'rgb'), port('shift', 'Shift (turns)', 'number')],
  outputs: [port('rgb', 'RGB', 'rgb')],
  parameters: [],
  runtime: 'builtin',
  invalidates: 'appearance',
  addable: true,
  state: 'stateless',
  fusion: 'inline',
  implementation: 'shared',
  consumers: ['Image graphs', 'Hue Shift'],
  composition: {
    graph: hueShiftGraph,
    inputs: { rgb: [endpoint('hsv', 'rgb')], shift: [endpoint('add-shift', 'b')] },
    outputs: { rgb: endpoint('rgb', 'rgb') },
  },
}];
