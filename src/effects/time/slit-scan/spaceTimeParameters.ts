import type { EffectParam } from '../../types';
const number = (label: string, value: number, min: number, max: number, step: number): EffectParam =>
  ({ type: 'number', label, default: value, min, max, step, group: 'Space-time slice', animatable: true });
export const spaceTimeParams: Record<string, EffectParam> = {
  spaceTimeData: { type: 'text', label: 'Observations', default: '', hidden: true },
  spaceTimeDepthId: { type: 'text', label: 'Depth video', default: '', hidden: true },
  spaceTimeAxis: { type: 'select', label: 'Space axis', default: 'x', group: 'Space-time slice', options: [
    { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Depth Z' },
  ] },
  spaceTimeAngle: number('Tilt (°)', 0, 0, 90, .1),
  spaceTimeScale: number('Length / second', .25, .01, 5, .01),
  spaceTimeSlice: number('Slice position', 0, -10, 10, .01),
  spaceTimeThickness: number('Slice thickness', .06, .001, 2, .001),
  spaceTimeDepth: number('Relative depth', .5, 0, 2, .01),
  spaceTimePointSize: number('Point size', .025, .001, .1, .001),
};
