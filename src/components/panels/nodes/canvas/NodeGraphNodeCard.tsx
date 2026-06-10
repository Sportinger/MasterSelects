import type { PointerEvent as ReactPointerEvent } from 'react';
import type { NodeGraphNode, NodeGraphPort } from '../../../../services/nodeGraph';
import type { ConnectionDraft } from './canvasGeometry';
import {
  clamp,
  getAudioAnalysisBadges,
  getNodeHeight,
  getNodeParamNumber,
  getNodePortStartY,
  getPortTitle,
  isNodeBypassable,
  isNodeBypassed,
  NODE_WIDTH,
} from './canvasGeometry';

interface NodeGraphNodeCardProps {
  node: NodeGraphNode;
  selectedNodeId: string | null;
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

export function NodeGraphNodeCard({
  node,
  selectedNodeId,
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
  const isSelected = node.id === selectedNodeId;
  const isBypassable = isNodeBypassable(node);
  const isBypassed = isNodeBypassed(node);
  const nodeBadges = getAudioAnalysisBadges(node);
  const analysisProgress = clamp(getNodeParamNumber(node, 'progressPercent'), 0, 100);

  const renderPort = (port: NodeGraphPort) => {
    const isConnectableTarget = !!connectionDraft &&
      connectionDraft.nodeId !== node.id &&
      connectionDraft.direction !== port.direction &&
      connectionDraft.type === port.type;
    const isDraftStart = connectionDraft?.nodeId === node.id && connectionDraft.portId === port.id;

    return (
      <div
        key={port.id}
        className={[
          'node-workspace-port',
          `node-workspace-port-${port.direction}`,
          isConnectableTarget ? 'connectable' : '',
          isDraftStart ? 'connecting' : '',
        ].filter(Boolean).join(' ')}
        title={`${getPortTitle(port)} - drag to connect, right-click to disconnect`}
        data-node-id={node.id}
        data-port-id={port.id}
        data-direction={port.direction}
        onPointerDown={(event) => onStartConnectionDrag(event, node, port)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDisconnectPortEdges(node, port);
        }}
      >
        <span className="node-workspace-port-dot" />
        <span className="node-workspace-port-label">{port.label}</span>
      </div>
    );
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        'node-workspace-node',
        `node-workspace-node-${node.kind}`,
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
        <span>{node.kind}</span>
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
          <span className="node-workspace-node-progress" title={`${analysisProgress}% available`}>
            <span style={{ width: `${analysisProgress}%` }} />
          </span>
        </div>
      )}
      <div className="node-workspace-node-ports" style={{ top: getNodePortStartY(node) }}>
        <div className="node-workspace-port-column">
          {node.inputs.map((port) => renderPort(port))}
        </div>
        <div className="node-workspace-port-column node-workspace-port-column-output">
          {node.outputs.map((port) => renderPort(port))}
        </div>
      </div>
    </div>
  );
}
