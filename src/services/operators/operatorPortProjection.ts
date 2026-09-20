import type { NodeGraphPort, NodeGraphSignalType } from '../../types/nodeGraph';
import type { OperatorPort } from '../../types/operatorGraph';
import { getOperatorPortContract } from './portContracts';

export function projectOperatorPort(p: OperatorPort, direction: 'input' | 'output'): NodeGraphPort {
  const type: NodeGraphSignalType = p.type === 'image' || p.type === 'depth' || p.type === 'texture' ? 'texture' : p.type === 'number' ? 'number' : p.type === 'scene' ? 'scene' : 'geometry';
  return { id: p.id, label: p.label, type, direction, metadata: { contract: getOperatorPortContract(p), semanticKind: `operator:${p.type}`, required: p.required, repeated: p.repeated } };
}

