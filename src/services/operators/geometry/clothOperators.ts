import type { OperatorDefinition, OperatorParameter, OperatorPort } from '../../../types/operatorGraph';

/**
 * General cloth nodes. Cloth Sheet simulates a grid driven by the shared force nodes (Wind,
 * Gravity, Turbulence, Drag); Surface Bind puts any curves of the flat rest sheet onto it.
 */
export const CLOTH_GRID_FORMAT = 'cloth-grid';
/** Edges of the sheet that never move. */
export const CLOTH_PINS = ['none', 'top', 'left', 'top-corners', 'corners'] as const;
export const CLOTH_GRID_LIMIT = 128;
const surface = (required = false): OperatorPort => ({ id: 'surface', label: 'Cloth', type: 'surface', required,
  contract: { typeLabel: 'Cloth', description: 'A simulated cloth sheet: grid positions over its flat rest plane.', formats: [CLOTH_GRID_FORMAT] } });
const curves = (required = false): OperatorPort => ({ id: 'curves', label: 'Curves', type: 'curves', required, contract: { formats: ['strand-curves'] } });
const number = (id: string, label: string, value: number, min: number, max: number, step = 0.01): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step, animatable: false });
const operator = (definition: Pick<OperatorDefinition, 'id' | 'label' | 'description' | 'inputs' | 'outputs' | 'parameters'> & Partial<OperatorDefinition>): OperatorDefinition =>
  ({ version: 1, invalidates: 'simulation', runtime: 'builtin', addable: true, implementation: 'shared', consumers: ['Weave'], ...definition });

export const CLOTH_OPERATORS: readonly OperatorDefinition[] = [
  operator({ id: 'geometry.cloth-sheet', label: 'Cloth Sheet',
    description: 'Simulates a flat sheet of cloth in the source time of its clip. Connect Wind, Gravity, Turbulence and Drag; Pin keeps an edge in place and Pre-roll starts the motion before the clip.',
    inputs: [{ id: 'forces', label: 'Forces', type: 'force', repeated: true }, { id: 'drag', label: 'Drag', type: 'drag', repeated: true }],
    outputs: [surface()], state: 'simulation', bypass: 'mute',
    parameters: [number('columns', 'Columns', 40, 2, CLOTH_GRID_LIMIT, 1), number('rows', 'Rows', 27, 2, CLOTH_GRID_LIMIT, 1),
      number('width', 'Width', 2.4, 0.001, 100), number('height', 'Height', 1.6, 0.001, 100),
      { id: 'pin', label: 'Pin', type: 'select', default: 'top', options: [{ value: 'none', label: 'None' }, { value: 'top', label: 'Top edge' },
        { value: 'left', label: 'Left edge' }, { value: 'top-corners', label: 'Top corners' }, { value: 'corners', label: 'All corners' }] },
      number('stretch', 'Stretch Stiffness', 0.9, 0, 1), number('bend', 'Bend Stiffness', 0.6, 0, 1), number('damping', 'Damping', 0.3, 0, 20),
      number('substeps', 'Substeps', 6, 1, 32, 1), number('preroll', 'Pre-roll', 2, 0, 30, 0.1)] }),
  operator({ id: 'geometry.surface-bind', label: 'Surface Bind',
    description: 'Places curves drawn on the flat rest sheet onto the connected cloth: X and Y find the spot on the sheet, Z becomes height along its normal.',
    inputs: [curves(true), surface(true)], outputs: [curves()], invalidates: 'appearance', state: 'stateless', bypass: 'passthrough',
    parameters: [number('height', 'Height Scale', 1, 0, 10)] }),
];
