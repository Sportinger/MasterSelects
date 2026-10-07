import type { OperatorDefinition } from '../../../types/operatorGraph';

/** A finite authored study, separate from the experimental live guide solver. */
export const KNIT_PASSAGE_OPERATORS: readonly OperatorDefinition[] = [{
  id: 'geometry.knit-passage', version: 1, label: 'Knit Passage Study',
  description: 'Four closed yarns with successive draw-throughs from a baked rod simulation. The entry replays the release backwards; the mature seam and ring return are constructed. A finite study, not an independently simulated knitting machine or a seamless loop.',
  inputs: [], outputs: [{ id: 'curves', label: 'Curves', type: 'curves', contract: { formats: ['strand-curves'] } }],
  parameters: [
    { id: 'duration', label: 'Playback Seconds', type: 'number', default: 33.8, min: 1, max: 600, step: 0.1, animatable: false },
    { id: 'timeScale', label: 'Time Scale', type: 'number', default: 1, min: -20, max: 20, step: 0.01, animatable: false },
    { id: 'timeOffset', label: 'Time Offset', type: 'number', default: 0, min: -600, max: 600, step: 0.1, animatable: false },
    { id: 'travel', label: 'Patch Travel Turns', type: 'number', default: 1, min: -10, max: 10, step: 0.01, animatable: false },
    { id: 'follow', label: 'Follow Patch', type: 'select', default: 'follow', animatable: false,
      options: [{ value: 'follow', label: 'Follow patch' }, { value: 'fixed', label: 'Fixed view' }] },
  ],
  invalidates: 'appearance', runtime: 'builtin', state: 'stateless', addable: true,
  implementation: 'shared', consumers: ['Weave'],
}];
