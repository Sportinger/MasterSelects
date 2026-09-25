import { SEQUENCE_BLEND_MODES } from '../../../services/operators/sequenceBlendModes';
import type { FullscreenEffectDefinition } from '../../types';
export const timeStack: FullscreenEffectDefinition = {
  id: 'time-stack', name: 'Time Stack', category: 'time',
  shader: '// Rendered by the editable Time Stack image graph.', entryPoint: 'timeStackFragment', uniformSize: 0,
  usesInputHistory: true, sourceTimeOwner: 'time-stack', packUniforms: () => null,
  params: {
    count: { type: 'number', label: 'Instances', default: 20, min: 1, max: 32, step: 1 },
    offset: { type: 'number', label: 'Time offset (s)', default: 0.1, min: 0, max: 10, step: 0.01 },
    blendMode: { type: 'select', label: 'Blend mode', default: 'darken', options: SEQUENCE_BLEND_MODES.map(value => ({ value, label: value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') })) },
    previewSize: { type: 'select', label: 'Preview size', default: 'full', options: [
      { value: 'small', label: 'Small (960 px)' }, { value: 'full', label: 'Full' },
    ] },
    memoryMiB: { type: 'select', label: 'Frame cache', default: '1024', options: [
      { value: '640', label: '640 MiB' }, { value: '1024', label: '1 GiB' },
      { value: '2048', label: '2 GiB' }, { value: '4096', label: '4 GiB' },
    ] },
  },
};
