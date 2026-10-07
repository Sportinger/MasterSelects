import type { OperatorDefinition, OperatorParameter } from '../../../types/operatorGraph';

const number = (id: string, label: string, value: number, min: number, max: number, step = 0.01): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step, animatable: false });
export const KNIT_CYCLE_OPERATORS: readonly OperatorDefinition[] = [{
  id: 'geometry.knit-cycle', version: 1, label: 'Knit Cycle Guides',
  description: 'Closed stockinette guide rings. Connect Curves to both the Curves and Cycle Guide inputs of one Rod Simulation. Local soft guides reuse the four-yarn draw-through study to form and release material loops in forward time; the rod solver supplies stretch, bending and contacts. Entry and Exit control separate forming windows. This is a driven simulation, not a guaranteed collision-free knitting planner.',
  inputs: [], outputs: [{ id: 'curves', label: 'Curves', type: 'curves', contract: { formats: ['strand-curves'] } }],
  parameters: [number('rows', 'Threads', 4, 2, 32, 1), number('stitches', 'Stitches per Turn', 24, 8, 64, 1),
    number('resolution', 'Points per Stitch', 32, 8, 64, 1), number('radius', 'Ring Radius', 0.85, 0.01, 10),
    number('spacing', 'Thread Spacing', 0.138, 0.001, 1, 0.001), number('height', 'Loop Height', 0.118, 0, 1, 0.001),
    number('depth', 'Crossing Depth', 0.07, 0, 1, 0.001), number('lean', 'Loop Fold', 1.495, 0, 3, 0.001),
    number('width', 'Patch Turns', 0.18, 0.05, 0.6), number('entry', 'Entry Turns', 0.04, 0.01, 0.3),
    number('exit', 'Exit Turns', 0.06, 0.01, 0.3), number('period', 'Seconds per Stitch', 1.5, 0.2, 20, 0.1),
    number('strength', 'Guide Strength', 24, 0, 100, 1)],
  invalidates: 'simulation', runtime: 'builtin', state: 'stateless', addable: true, implementation: 'shared', consumers: ['Weave'],
}];
