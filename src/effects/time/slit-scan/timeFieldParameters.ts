import type { EffectParam } from '../../types';

const number = (label: string, value: number, min: number, max: number, step: number, group: string): EffectParam =>
  ({ type: 'number', label, default: value, min, max, step, group, animatable: true });

/** Choice order is persisted through the image graph's numeric choice nodes. Append only. */
export const timeFieldChannelOptions = [
  { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' },
  { value: 'hue', label: 'Hue' }, { value: 'saturation', label: 'Saturation' }, { value: 'value', label: 'Value' },
];

export const slitScanTimeFieldParams: Record<string, EffectParam> = {
  rgbTimeMode: { type: 'select', label: 'Channel times', default: 'linked', group: 'RGB time', options: [
    { value: 'linked', label: 'Linked' }, { value: 'separate', label: 'Separate RGB (no smoothing)' },
  ] },
  rgbRedOffset: number('Red offset (s)', 0, -60, 60, .01, 'RGB time'),
  rgbGreenOffset: number('Green offset (s)', 0, -60, 60, .01, 'RGB time'),
  rgbBlueOffset: number('Blue offset (s)', 0, -60, 60, .01, 'RGB time'),
  rgbTimePreview: { type: 'select', label: 'Time map channel', default: 'base', group: 'RGB time', options: [
    { value: 'base', label: 'Base / alpha' }, { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' },
  ] },
  mapSource: { type: 'select', label: 'Field source', default: 'external', group: 'Time map', options: [
    { value: 'external', label: 'External image / video' }, { value: 'input', label: 'Effect input' },
    { value: 'noise', label: 'Noise' }, { value: 'mask', label: 'Clip mask' }, { value: 'motion', label: 'Source motion' },
    { value: 'edges', label: 'Edge strength (Sobel)' },
  ] },
  mapMotionMode: { type: 'select', label: 'Motion value', default: 'magnitude', group: 'Motion field', options: [
    { value: 'magnitude', label: 'Magnitude' }, { value: 'direction', label: 'Directed velocity' },
  ] },
  mapMotionAngle: number('Direction (degrees)', 0, -180, 180, 1, 'Motion field'),
  mapMotionMin: number('Minimum (UV/s)', 0, -10, 10, .01, 'Motion field'),
  mapMotionMax: number('Maximum (UV/s)', .25, -10, 10, .01, 'Motion field'),
  mapMotionConfidence: number('Confidence threshold', .1, 0, 1, .01, 'Motion field'),
  mapMaskId: { type: 'text', label: 'Time field mask', default: '', group: 'Resources' },
  mapAlignment: { type: 'select', label: 'Map alignment', default: 'timeline', group: 'Time map', options: [
    { value: 'timeline', label: 'Timeline (free)' }, { value: 'source', label: 'Depth source' },
  ] },
  mapMin: number('Input minimum', 0, 0, 1, .01, 'Field shaping'),
  mapMax: number('Input maximum', 1, 0, 1, .01, 'Field shaping'),
  mapGamma: number('Gamma', 1, .01, 10, .01, 'Field shaping'),
  mapHueMode: { type: 'select', label: 'Hue mapping', default: 'wave', group: 'Field shaping', options: [
    { value: 'wave', label: 'Periodic wave' }, { value: 'ramp', label: 'Direct ramp (seam)' },
  ] },
  mapHuePhase: number('Hue phase', 0, 0, 1, .01, 'Field shaping'),
  mapNoiseScale: number('Noise scale', 4, .1, 100, .1, 'Field noise'),
  mapNoiseSeed: number('Noise seed', 0, 0, 1000, 1, 'Field noise'),
  mapNoiseDriftX: number('Drift X (UV/s)', .02, -1, 1, .001, 'Field noise'),
  mapNoiseDriftY: number('Drift Y (UV/s)', .01, -1, 1, .001, 'Field noise'),
  mapNoiseMode: { type: 'select', label: 'Noise type', default: 'smooth', group: 'Field noise', options: [
    { value: 'smooth', label: 'Smooth' }, { value: 'cells', label: 'Hard cells' },
  ] },
  mapNoiseAmount: number('Noise strength', 0, 0, 1, .01, 'Field combination'),
  mapCombine: { type: 'select', label: 'Combine noise', default: 'mix', group: 'Field combination', options: [
    { value: 'mix', label: 'Mix' }, { value: 'add', label: 'Add (centered)' }, { value: 'multiply', label: 'Multiply' },
    { value: 'min', label: 'Minimum' }, { value: 'max', label: 'Maximum' },
  ] },
};

export const slitScanTimeFieldPresets: ReadonlyArray<{ value: string; label: string; params: Record<string, number | string> }> = [
  { value: 'color', label: 'Color Time', params: { mapSource: 'input', mapChannel: 'luminance' } },
  { value: 'hue', label: 'Hue Waves', params: { mapSource: 'input', mapChannel: 'hue', mapHueMode: 'wave' } },
  { value: 'fog', label: 'Time Fog', params: { mapSource: 'noise', mapNoiseMode: 'smooth' } },
  { value: 'shards', label: 'Time Shards', params: { mapSource: 'noise', mapNoiseMode: 'cells' } },
  { value: 'mask', label: 'Mask Time', params: { mapSource: 'mask' } },
];

export function slitScanTimeFieldPreset(value: string): Record<string, number | string> | undefined {
  const preset = slitScanTimeFieldPresets.find(item => item.value === value);
  return preset && { mapAmount: 1, mapNoiseAmount: 0, mapMin: 0, mapMax: 1, mapGamma: 1,
    mapInvert: 'off', mapHuePhase: 0, mapNoiseScale: 4, mapNoiseSeed: 0, mapNoiseDriftX: .02, mapNoiseDriftY: .01,
    ...preset.params };
}
