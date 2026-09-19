import { useMemo, type KeyboardEvent } from 'react';
import type { NodeGraphNode } from '../../../../services/nodeGraph';
import { compileFlockDefinitionCached } from '../../../../services/flock/compiler/flockCompiler';
import type { TimelineClip } from '../../../../stores/timeline/types';
import { FlockNodeParameters } from './FlockNodeParameters';
import { FlockPortConnections } from './FlockPortConnections';
import { FLOCK_RUNTIME_STATE_LABELS, useFlockRuntimeStatus } from './useFlockRuntimeStatus';
import type { FlockGraphActions } from './useFlockGraphActions';

export function FlockNodeInspector({
  clip,
  node,
  actions,
  onSelectNode,
}: {
  clip: TimelineClip;
  node: NodeGraphNode;
  actions: FlockGraphActions;
  onSelectNode: (nodeId: string) => void;
}) {
  const definition = clip.flock ?? null;
  const status = useFlockRuntimeStatus(clip.id);
  const diagnostics = useMemo(() => (
    definition
      ? compileFlockDefinitionCached(definition).diagnostics.filter((diagnostic) => diagnostic.nodeIds?.includes(node.id))
      : []
  ), [definition, node.id]);
  const flockNode = definition?.nodes.find((candidate) => candidate.id === node.id);

  if (!definition || !flockNode) {
    return <div className="node-workspace-inspector-empty">Flock node not found</div>;
  }

  const commitRename = (value: string) => {
    const next = value.trim();
    if (next !== (flockNode.label ?? '') && next !== node.label) actions.rename(node.id, next);
  };

  const handleRenameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.currentTarget.value = node.label;
      event.currentTarget.blur();
    }
    event.stopPropagation();
  };

  return (
    <>
      <div className="node-workspace-inspector-header">
        <span>{typeof node.params?.categoryLabel === 'string' ? node.params.categoryLabel : node.kind}</span>
        <input
          key={`${node.id}:${node.label}`}
          className="node-workspace-flock-rename"
          defaultValue={node.label}
          aria-label="Node name"
          onBlur={(event) => commitRename(event.currentTarget.value)}
          onKeyDown={handleRenameKey}
        />
        <p>{node.description}</p>
      </div>

      <div className="node-workspace-inspector-meta">
        <div>
          <span>Operator</span>
          <strong title={flockNode.operator}>{flockNode.operator.replace(/^flock\./, '')} v{flockNode.operatorVersion}</strong>
        </div>
        <div>
          <span>Runtime</span>
          <strong className={`node-workspace-flock-state state-${status?.state ?? 'idle'}`} title={status?.message}>
            {status ? FLOCK_RUNTIME_STATE_LABELS[status.state] : 'Not rendered yet'}
          </strong>
        </div>
        {flockNode.bypassed && (
          <div>
            <span>Bypass</span>
            <strong>Bypassed</strong>
          </div>
        )}
      </div>

      {diagnostics.length > 0 && (
        <div className="node-workspace-inspector-section">
          <div className="node-workspace-inspector-section-title">Diagnostics</div>
          <ul className="node-workspace-flock-diagnostics">
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}:${index}`} className={`severity-${diagnostic.severity}`}>
                <strong>{diagnostic.severity}</strong> {diagnostic.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <FlockPortConnections definition={definition} node={node} actions={actions} onSelectNode={onSelectNode} />

      <div className="node-workspace-inspector-section">
        <div className="node-workspace-inspector-section-title">Parameters</div>
        <FlockNodeParameters clip={clip} definition={definition} flockNode={flockNode} actions={actions} />
      </div>
    </>
  );
}
