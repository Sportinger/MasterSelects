import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';

/** Persisted eight-node topology from before the granular display migration. */
export function createLegacyAnalogSignalGraph(): EffectOperatorGraph {
  const definitions = [
    ['frame', 'image.frame'], ['encode', 'analog.pal-encode'], ['rf', 'analog.rf-channel'],
    ['vhs', 'analog.vhs-transport'], ['analyze', 'analog.receiver-analyze'], ['decode', 'analog.pal-decode'],
    ['resolve', 'analog.display-resolve'], ['output', 'image.output'],
  ];
  const connections = [
    ['frame', 'image', 'encode', 'image'], ['encode', 'signal', 'rf', 'signal'],
    ['rf', 'signal', 'vhs', 'signal'], ['vhs', 'signal', 'analyze', 'signal'],
    ['vhs', 'signal', 'decode', 'signal'], ['analyze', 'lines', 'decode', 'receiver'],
    ['frame', 'image', 'resolve', 'source'], ['decode', 'image', 'resolve', 'decoded'],
    ['resolve', 'image', 'output', 'image'],
  ];
  return {
    version: 1, schemaVersion: 1, domain: 'analog-signal',
    nodes: definitions.map(([id, operator]) => ({ id, operator, operatorVersion: 1,
      bindings: Object.fromEntries((getEffectOperator(operator)?.parameters ?? []).map(parameter => [parameter.id, parameter.id])) })),
    edges: connections.map(([from, output, to, input]) => ({ id: `${from}-${to}`, from, output, to, input })),
    layout: Object.fromEntries(definitions.map(([id], index) => [id, { x: index * 300, y: 0 }])),
  };
}
