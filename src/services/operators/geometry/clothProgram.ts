import type { BoundOperatorNode, EffectOperatorGraph } from '../../../types/operatorGraph';
import { getEffectOperator } from '../operatorRegistry';
import type { GeometryParameterReader } from './geometryProgram';
import { CLOTH_GRID_LIMIT, CLOTH_PINS } from './clothOperators';

const FORCE_LIMIT = 8;

export interface ClothWind { direction: [number, number, number]; strength: number; gust: number }
export interface ClothTurbulence { strength: number; frequency: number }
/**
 * Everything a cloth simulation depends on, apart from time. Two equal specs produce the same
 * motion, so the render thread keys its checkpointed simulations by this value.
 */
export interface ClothSpec {
  nodeId: string; columns: number; rows: number; width: number; height: number; pin: number;
  stretch: number; bend: number; damping: number; substeps: number; preroll: number;
  gravity: number; drag: number; winds: ClothWind[]; turbulence: ClothTurbulence[];
}

const finite = (value: unknown, label: string) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const label = (node: BoundOperatorNode) => getEffectOperator(node.operator)?.label ?? node.operator;

/**
 * Reads a Cloth Sheet and the general force nodes wired into it. Force nodes contribute their own
 * parameters; their scalar inputs are not evaluated for cloth yet, so a connected one is an error
 * rather than a silently ignored cable.
 */
export function compileClothSpec(graph: EffectOperatorGraph, cloth: BoundOperatorNode, read: GeometryParameterReader): ClothSpec {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const inputs = (input: string) => graph.edges.filter(edge => edge.to === cloth.id && edge.input === input)
    .map(edge => nodes.get(edge.from)!).filter(node => !node.bypassed);
  const spec: ClothSpec = {
    nodeId: cloth.id,
    columns: Math.round(clamp(finite(read(cloth, 'columns'), 'Columns'), 2, CLOTH_GRID_LIMIT)),
    rows: Math.round(clamp(finite(read(cloth, 'rows'), 'Rows'), 2, CLOTH_GRID_LIMIT)),
    width: Math.max(1e-3, finite(read(cloth, 'width'), 'Cloth width')), height: Math.max(1e-3, finite(read(cloth, 'height'), 'Cloth height')),
    pin: Math.max(0, CLOTH_PINS.indexOf(String(read(cloth, 'pin')) as typeof CLOTH_PINS[number])),
    stretch: clamp(finite(read(cloth, 'stretch'), 'Stretch stiffness'), 0, 1), bend: clamp(finite(read(cloth, 'bend'), 'Bend stiffness'), 0, 1),
    damping: Math.max(0, finite(read(cloth, 'damping'), 'Damping')),
    substeps: Math.round(clamp(finite(read(cloth, 'substeps'), 'Substeps'), 1, 32)),
    preroll: clamp(finite(read(cloth, 'preroll'), 'Pre-roll'), 0, 30),
    gravity: 0, drag: 0, winds: [], turbulence: [],
  };
  for (const force of inputs('forces')) {
    if (graph.edges.some(edge => edge.to === force.id)) throw new Error(`${label(force)}: Cloth Sheet reads its values from the node; disconnect its inputs.`);
    if (force.operator === 'forces.gravity') spec.gravity += finite(read(force, 'strength'), 'Gravity');
    else if (force.operator === 'forces.wind') {
      const direction = read(force, 'direction');
      if (!Array.isArray(direction) || direction.length !== 3) throw new Error('Wind direction must be a vector.');
      spec.winds.push({ direction: direction.map(value => finite(value, 'Wind direction')) as [number, number, number],
        strength: finite(read(force, 'strength'), 'Wind strength'), gust: finite(read(force, 'gust'), 'Gusts') });
    } else if (force.operator === 'forces.turbulence') {
      spec.turbulence.push({ strength: finite(read(force, 'strength'), 'Turbulence strength'),
        frequency: finite(read(force, 'frequency'), 'Turbulence frequency') });
    } else throw new Error(`${label(force)} is not a cloth force.`);
  }
  for (const drag of inputs('drag')) spec.drag += Math.max(0, finite(read(drag, 'amount'), 'Drag'));
  if (spec.winds.length > FORCE_LIMIT || spec.turbulence.length > FORCE_LIMIT) throw new Error(`Cloth Sheet accepts up to ${FORCE_LIMIT} winds and turbulences.`);
  return spec;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const within = (value: unknown, min: number, max: number) => number(value) && value >= min && value <= max;
const integer = (value: unknown, min: number, max: number) => Number.isInteger(value) && within(value, min, max);

/** Validates a transported spec: bounded grid, substeps, force counts and finite values. */
export function isClothSpec(value: unknown): value is ClothSpec {
  if (!record(value) || !exact(value, ['nodeId', 'columns', 'rows', 'width', 'height', 'pin', 'stretch', 'bend', 'damping', 'substeps',
    'preroll', 'gravity', 'drag', 'winds', 'turbulence']) || typeof value.nodeId !== 'string') return false;
  if (!integer(value.columns, 2, CLOTH_GRID_LIMIT) || !integer(value.rows, 2, CLOTH_GRID_LIMIT) || !integer(value.pin, 0, CLOTH_PINS.length - 1)
    || !integer(value.substeps, 1, 32) || !within(value.preroll, 0, 30) || !within(value.stretch, 0, 1) || !within(value.bend, 0, 1)
    || !within(value.width, 1e-3, 1e6) || !within(value.height, 1e-3, 1e6) || !within(value.damping, 0, 1e6)
    || !number(value.gravity) || !within(value.drag, 0, 1e6)) return false;
  const winds = value.winds, turbulence = value.turbulence;
  return Array.isArray(winds) && winds.length <= FORCE_LIMIT && winds.every(wind => record(wind) && exact(wind, ['direction', 'strength', 'gust'])
      && Array.isArray(wind.direction) && wind.direction.length === 3 && wind.direction.every(number) && number(wind.strength) && number(wind.gust))
    && Array.isArray(turbulence) && turbulence.length <= FORCE_LIMIT
    && turbulence.every(item => record(item) && exact(item, ['strength', 'frequency']) && number(item.strength) && number(item.frequency));
}
