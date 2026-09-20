import { useState } from 'react';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { mathModeOptions, setMathNodeMode } from '../../../../services/nodeGraph/mathNodeEditing';
import { InspectorSelect } from '../../../inspector/InspectorSelect';

export function MathNodeMode({ node, clipId }: { node: NodeGraphNode; clipId: string }) {
  const [error, setError] = useState('');
  const options = mathModeOptions(node);
  if (!options.length) return null;
  return <div className="node-math-mode" style={{ left: node.layout.x + 12, top: node.layout.y + 34, width: 160 }}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <InspectorSelect ariaLabel={`Math operation for ${node.label}`} options={options}
      value={node.operatorId === 'flock.math' ? String(node.params?.op ?? 'multiply') : node.operatorId!}
      onChange={mode => { try { setMathNodeMode(clipId, node, mode); setError(''); } catch (error) { setError(String(error)); } }} />
    {error && <small role="alert">{error}</small>}
  </div>;
}
