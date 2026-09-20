import { memo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { NodeGraphNode, NodeGraphPort } from '../../../../services/nodeGraph';
import { NodeGraphPortView } from './NodeGraphPortView';
import { KeyframeNodeCardPreview } from '../keyframes/KeyframeNodeCurve';
import { NodeAnimationBadge } from '../keyframes/NodeAnimationBadge';
import { requestNodeAnimation } from '../../../../services/nodeGraph/nodeWorkspaceNavigation';
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
  canvasRendered?: boolean;
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
  canvasRendered = false,
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
  const [keyboardFocused, setKeyboardFocused] = useState(false);
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
      onFocusCapture={event => setKeyboardFocused(event.target.matches(':focus-visible'))}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeyboardFocused(false);
      }}
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
              aria-label={`Bypass ${node.label}`} aria-pressed={isBypassed}
              title={isBypassed ? 'Bypassed; click to enable' : String(node.params?.bypassDescription ?? 'Bypass node')}
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
      {node.binding?.kind === 'keyframe-node' && (!canvasRendered || keyboardFocused) && <KeyframeNodeCardPreview node={node} />}
      {!!node.animation?.channels.length && (canvasRendered
        ? <button type="button" className="node-animation-badge" style={{ top: getNodePortStartY(node) - 78 }}
            aria-label={`Edit animation for ${node.label}, ${node.animation.channels.length} curves`}
            onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); requestNodeAnimation(node.animation!.clipId, node.id); if (event.detail > 0) event.currentTarget.blur(); }}>
            <span>◇ Animation · {node.animation.channels.length} curves</span>
          </button>
        : <NodeAnimationBadge node={node} top={getNodePortStartY(node) - 78} />)}
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
