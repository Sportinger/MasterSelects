import type { OperatorDefinition, OperatorParameter } from '../../../types/operatorGraph';

const number = (id: string, label: string, value: number, min: number, max: number, step = 0.001, animatable = true): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step, animatable });
const generator = (id: string, variant: string, label: string, description: string, parameters: OperatorParameter[]): OperatorDefinition =>
  ({ id, version: 1, label, description, inputs: [], outputs: [{ id: 'curves', label: 'Curves', type: 'curves', contract: { formats: ['strand-curves'] } }],
    parameters, family: 'geometry.curve-generator', variant, invalidates: 'appearance', runtime: 'builtin', state: 'stateless',
    addable: true, implementation: 'shared', consumers: ['Weave'] });

/** General knot curve generators; their curves feed Yarn Profile, Thread Along or any curve modifier. */
export const KNOT_OPERATORS: readonly OperatorDefinition[] = [
  generator('geometry.knit-sphere', 'knit-sphere', 'Knit Sphere', 'Closed horizontal yarn rings form a sphere and circulate through a fixed knitting window at the front. Loose Knit loops form on entry and unravel on exit. Zone Center is height / radius (negative = below equator). Speed is turns per source second; zero pauses, negative reverses. This seamless deformation does not simulate collisions or preserve yarn length.', [
    number('radius', 'Sphere Radius', 0.8, 0.001, 100),
    number('bandSpan', 'Band Half Height / Radius', 0.94, 0.01, 0.94, 0.01),
    number('rows', 'Rings', 28, 2, 512, 1, false), number('stitches', 'Stitches per Ring', 32, 4, 512, 1, false),
    number('height', 'Loop Height', 0.052, 0, 100), number('depth', 'Depth', 0.016, 0, 10), number('lean', 'Lean', 1.5, 0, 4, 0.01),
    number('speed', 'Speed (turns/s)', 0.05, -2, 2, 0.001), number('phase', 'Phase (turns)', 0, -100, 100, 0.001),
    number('zoneWidth', 'Zone Width (deg)', 90, 0, 360, 1), number('zoneCenter', 'Zone Center', -0.38, -1, 1, 0.01),
    number('zoneHeight', 'Zone Height', 0.6, 0.01, 2, 0.01), number('feather', 'Edge Softness', 0.65, 0.01, 1, 0.01),
    number('resolution', 'Points per Stitch', 24, 8, 128, 1, false),
  ]),
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
  generator('geometry.knit', 'knit', 'Knit', 'Creates knitted (stockinette) fabric: one curve per row, its yarn running in loops whose heads reach through the loops of the row above. Lean widens the loops; Depth moves heads and sinkers in front of the legs.', [
    number('stitches', 'Stitches', 16, 1, 512, 1, false), number('rows', 'Rows', 12, 1, 512, 1, false),
    number('width', 'Stitch Width', 0.12, 0.001, 100), number('height', 'Loop Height', 0.09, 0, 100),
    number('spacing', 'Row Spacing', 0.108, 0, 100), number('depth', 'Depth', 0.03, 0, 10),
    number('lean', 'Lean', 1.5, 0, 4, 0.01), number('resolution', 'Points per Stitch', 24, 4, 128, 1, false),
  ]),
];
