import type { NodeGraphPort, NodeGraphSignalType } from '../../types/nodeGraph';
import type { OperatorPort } from '../../types/operatorGraph';
import { getOperatorPortContract } from './portContracts';

export function projectOperatorPort(p: OperatorPort, direction: 'input' | 'output'): NodeGraphPort {
  const type: NodeGraphSignalType = p.type === 'audio' ? 'audio' : p.type === 'image' || p.type === 'depth' || p.type === 'texture' ? 'texture' : p.type === 'number' || p.type === 'field' ? 'number' : p.type === 'boolean' ? 'boolean' : ['scene', 'camera', 'light'].includes(p.type) ? 'scene' : 'geometry';
  return { id: p.id, label: p.label, type, direction, metadata: { contract: getOperatorPortContract(p), semanticKind: `operator:${p.type}`, required: p.required, repeated: p.repeated } };
}
