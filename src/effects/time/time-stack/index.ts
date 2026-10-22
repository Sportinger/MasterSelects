import { SEQUENCE_BLEND_MODES } from '../../../services/operators/sequenceBlendModes';
import type { EffectPreset, FullscreenEffectDefinition } from '../../types';
import { TIME_STACK_DEFAULT_DECAY, TIME_STACK_LEGACY_DECAY } from './settings';

/**
 * Named starting points (the card's Preset row). They set only the four look controls; Preview size and
 * Frame cache return to their defaults like every unnamed control. Echo Trail is the default look.
 */
export const TIME_STACK_PRESETS: readonly EffectPreset[] = [
  { id: 'echo-trail', name: 'Echo Trail', params: { count: 20, offset: 0.1, decay: 0.8, blendMode: 'lighten' } },
  { id: 'long-exposure', name: 'Long Exposure', params: { count: 32, offset: 0.08, decay: 0.95, blendMode: 'lighten' } },
  { id: 'stroboscope', name: 'Stroboscope', params: { count: 8, offset: 0.2, decay: 1, blendMode: 'lighten' } },
  { id: 'chorus', name: 'Chorus', params: { count: 5, offset: 0.5, decay: 0.9, blendMode: 'lighten' } },
  // Few, quickly fading copies: Screen adds them up, so more or brighter copies would lift a dark stage into haze.
  { id: 'afterglow', name: 'Afterglow', params: { count: 6, offset: 0.08, decay: 0.5, blendMode: 'screen' } },
];

export const timeStack: FullscreenEffectDefinition = {
  id: 'time-stack', name: 'Time Stack', category: 'time',
  shader: '// Rendered by the editable Time Stack image graph.', entryPoint: 'timeStackFragment', uniformSize: 0,
  usesInputHistory: true, sourceTimeOwner: 'time-stack', packUniforms: () => null,
  presets: TIME_STACK_PRESETS,
  params: {
    count: { type: 'number', label: 'Instances', default: 20, min: 1, max: 32, step: 1, animatable: false },
    offset: { type: 'number', label: 'Time offset (s)', default: 0.1, min: 0, max: 10, step: 0.01, animatable: false },
    // graphOnly: a Time Stack graph edited before Decay existed does not read it; tools say so.
    // legacyDefault: a Time Stack stored without Decay (older project or preset) keeps equal copies.
    decay: { type: 'number', label: 'Decay', default: TIME_STACK_DEFAULT_DECAY, legacyDefault: TIME_STACK_LEGACY_DECAY,
      min: 0, max: 1, step: 0.01, animatable: true, graphOnly: true },
    blendMode: { type: 'select', label: 'Blend mode', default: 'lighten', options: SEQUENCE_BLEND_MODES.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') })) },
    previewSize: { type: 'select', label: 'Preview size', default: 'full', options: [
      { value: 'small', label: 'Small (960 px)' }, { value: 'full', label: 'Full' },
    ] },
    memoryMiB: { type: 'select', label: 'Frame cache', default: '1024', options: [
      { value: '640', label: '640 MiB' }, { value: '1024', label: '1 GiB' },
      { value: '2048', label: '2 GiB' }, { value: '4096', label: '4 GiB' },
    ] },
  },
};
