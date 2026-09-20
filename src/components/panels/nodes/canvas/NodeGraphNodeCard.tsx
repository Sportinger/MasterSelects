import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import type { NodeGraphNode, NodeGraphPort } from '../../../../services/nodeGraph';
import { NodeGraphPortView } from './NodeGraphPortView';
import { KeyframeNodeCardPreview } from '../keyframes/KeyframeNodeCurve';
import type { ConnectionDraft } from './canvasGeometry';
import {
  clamp,
  getAudioAnalysisBadges,
  getNodeBadges,
  getNodeHeight,
  getNodeParamNumber,
  getNodePortStartY,
  isNodeBypassable,
  isNodeBypassed,
  NODE_WIDTH,
} from './canvasGeometry';

interface NodeGraphNodeCardProps {
  node: NodeGraphNode;
  selectedNodeId: string | null;
  isInSelection?: boolean;
  connectionDraft: ConnectionDraft | null;
  onSelectNode: (nodeId: string) => void;
  onStartNodeDrag: (event: ReactPointerEvent<HTMLDivElement>, node: NodeGraphNode) => void;
  onNodePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onFinishNodeDrag: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onStartConnectionDrag: (
    event: ReactPointerEvent<HTMLDivElement>,
    node: NodeGraphNode,
    port: NodeGraphPort,
  ) => void;
  onDisconnectPortEdges: (node: NodeGraphNode, port: NodeGraphPort) => void;
  onToggleNodeBypass?: (nodeId: string) => void;
}

function getNodeHeaderLabel(node: NodeGraphNode): string {
  const categoryLabel = node.binding?.kind === 'flock-node' ? node.params?.categoryLabel : undefined;
  return typeof categoryLabel === 'string' ? categoryLabel : node.kind;
}

export const NodeGraphNodeCard = memo(function NodeGraphNodeCard({
  node,
  selectedNodeId,
  isInSelection = false,
  connectionDraft,
  onSelectNode,
  onStartNodeDrag,
  onNodePointerMove,
  onFinishNodeDrag,
  onStartConnectionDrag,
  onDisconnectPortEdges,
  onToggleNodeBypass,
}: NodeGraphNodeCardProps) {
  const nodeHeight = getNodeHeight(node);
  const isSelected = node.id === selectedNodeId || isInSelection;
  const isBypassable = isNodeBypassable(node);
  const isBypassed = isNodeBypassed(node);
  const nodeBadges = getNodeBadges(node);
  const hasAudioBadges = getAudioAnalysisBadges(node).length > 0;
  const analysisProgress = clamp(getNodeParamNumber(node, 'progressPercent'), 0, 100);

  const renderPort = (port: NodeGraphPort) => <NodeGraphPortView key={port.id} node={node} port={port}
    connectionDraft={connectionDraft} onStartConnectionDrag={onStartConnectionDrag} onDisconnectPortEdges={onDisconnectPortEdges} />;

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        'node-workspace-node',
        `node-workspace-node-${node.kind}`,
        node.binding?.kind === 'flock-node' ? 'node-workspace-node-flock' : '',
        isSelected ? 'selected' : '',
        isBypassed ? 'bypassed' : '',
      ].filter(Boolean).join(' ')}
      data-node-id={node.id}
      style={{
        left: node.layout.x,
        top: node.layout.y,
        width: NODE_WIDTH,
        height: nodeHeight,
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelectNode(node.id);
      }}
      onPointerDown={(event) => onStartNodeDrag(event, node)}
      onPointerMove={onNodePointerMove}
      onPointerUp={onFinishNodeDrag}
      onPointerCancel={onFinishNodeDrag}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectNode(node.id);
        }
      }}
    >
      <div className="node-workspace-node-header">
        <span>{getNodeHeaderLabel(node)}</span>
        <div className="node-workspace-node-header-actions">
          {isBypassable && onToggleNodeBypass && (
            <button
              type="button"
              className={`node-workspace-bypass-button${isBypassed ? ' active' : ''}`}
              title={isBypassed ? 'Bypassed; click to enable' : 'Bypass node'}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleNodeBypass(node.id);
                // Pointer activation must not leave a stuck focus ring.
                if (event.detail > 0) event.currentTarget.blur();
              }}
            >
              Byp
            </button>
          )}
          <span>{node.runtime}</span>
        </div>
      </div>
      <div className="node-workspace-node-title" title={node.label}>{node.label}</div>
      <div className="node-workspace-node-description" title={node.description}>
        {node.description ?? 'Built-in processing node'}
      </div>
      {node.binding?.kind === 'keyframe-node' && <KeyframeNodeCardPreview node={node} />}
      {nodeBadges.length > 0 && (
        <div className="node-workspace-node-badges">
          {nodeBadges.map((badge) => (
            <span
              key={`${badge.tone}:${badge.label}`}
              className={`node-workspace-node-badge tone-${badge.tone}`}
              title={badge.title}
            >
              {badge.label}
            </span>
          ))}
          {hasAudioBadges && (
            <span className="node-workspace-node-progress" title={`${analysisProgress}% available`}>
              <span style={{ width: `${analysisProgress}%` }} />
            </span>
          )}
        </div>
      )}
      <div className="node-workspace-node-ports" style={{ top: getNodePortStartY(node) }}>
        <div className="node-workspace-port-column">
          {node.inputs.length > 0 && <span className="node-workspace-port-direction">IN</span>}
          {node.inputs.map((port) => renderPort(port))}
        </div>
        <div className="node-workspace-port-column node-workspace-port-column-output">
          {node.outputs.length > 0 && <span className="node-workspace-port-direction">OUT</span>}
          {node.outputs.map((port) => renderPort(port))}
        </div>
      </div>
    </div>
  );
});
