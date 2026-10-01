import type { OperatorDefinition, OperatorParameter } from '../../../types/operatorGraph';

const number = (id: string, label: string, value: number, min: number, max: number, step = 0.001, animatable = true): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step, animatable });
const generator = (id: string, variant: string, label: string, description: string, parameters: OperatorParameter[]): OperatorDefinition =>
  ({ id, version: 1, label, description, inputs: [], outputs: [{ id: 'curves', label: 'Curves', type: 'curves', contract: { formats: ['strand-curves'] } }],
    parameters, family: 'geometry.curve-generator', variant, invalidates: 'appearance', runtime: 'builtin', state: 'stateless',
    addable: true, implementation: 'shared', consumers: ['Weave'] });

/** General knot curve generators; their curves feed Yarn Profile, Thread Along or any curve modifier. */
export const KNOT_OPERATORS: readonly OperatorDefinition[] = [
  generator('geometry.knot', 'knot', 'Knot', 'Creates knot curves centered on the origin: a trefoil (simple knot), figure-eight, reef knot of two ropes, or a (P, Q) torus knot. Depth lifts the crossings.', [
    { id: 'shape', label: 'Shape', type: 'select', default: 'trefoil', options: [
      { value: 'trefoil', label: 'Trefoil' }, { value: 'figure-eight', label: 'Figure Eight' },
      { value: 'reef', label: 'Reef Knot' }, { value: 'torus', label: 'Torus Knot' }] },
    number('p', 'Torus P', 2, 1, 32, 1, false), number('q', 'Torus Q', 3, 1, 32, 1, false),
    number('size', 'Size', 0.6, 0, 100), number('depth', 'Depth', 0.12, 0, 10), number('points', 'Points', 720, 16, 65_536, 1, false),
  ]),
  generator('geometry.celtic-knot', 'celtic', 'Celtic Knot', 'Creates Celtic plaitwork on a grid of cells: threads run diagonally, turn in loops at the border and alternate over and under like a plain weave. Height lifts the crossings.', [
    number('columns', 'Columns', 3, 1, 64, 1, false), number('rows', 'Rows', 2, 1, 64, 1, false),
    number('size', 'Cell Size', 0.3, 0, 100), number('height', 'Height', 0.03, 0, 10),
    number('resolution', 'Points per Step', 10, 2, 64, 1, false), number('roundness', 'Roundness', 0.6, 0, 2, 0.01),
  ]),
];
