import type { OperatorDefinition } from '../../types/operatorGraph';
import { listFlockOperators } from './operators/flockOperatorRegistry';

/**
 * Flock operators as catalog entries for the unified node menus, so swarm nodes
 * sit in the shared categories (Particles, Forces & Physics, Output & Render, ...).
 * Ports stay in the flock registry; the menu only needs identity and text.
 */
export function flockMenuOperators(): OperatorDefinition[] {
  return listFlockOperators().filter(operator => operator.category !== 'groups').map(operator => ({
    id: operator.id, version: 1, label: operator.label, description: operator.description,
    inputs: [], outputs: [], parameters: [], invalidates: 'simulation', runtime: 'builtin', addable: true, state: 'simulation',
  }));
}
