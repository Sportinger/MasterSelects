import { memo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { NodeGraphNode, NodeGraphPort } from '../../../../services/nodeGraph';
import { NodeGraphPortView } from './NodeGraphPortView';
import { KeyframeNodeCardPreview } from '../keyframes/KeyframeNodeCurve';
import { NodeAnimationBadge } from '../keyframes/NodeAnimationBadge';
import { NodePreviewOutput, NodeViewerButton } from '../previews/NodePreviewControls';
import { NodeValuePreview } from '../previews/NodeValuePreview';
import { MathNodeMode } from '../previews/MathNodeMode';
import { inlineNumericPorts } from '../previews/previewGeometry';
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
  clipId?: string;
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
  onTogglePreview?: (nodeId: string) => void;
  onPreviewOutput?: (nodeId: string, portId: string) => void;
}

function getNodeHeaderLabel(node: NodeGraphNode): string {
  const categoryLabel = node.params?.categoryLabel;
  return typeof categoryLabel === 'string' ? categoryLabel : node.kind;
}

export const NodeGraphNodeCard = memo(function NodeGraphNodeCard({
  node,
  clipId,
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
  onTogglePreview,
  onPreviewOutput,
}: NodeGraphNodeCardProps) {
  const [focusBox, setFocusBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const nodeHeight = getNodeHeight(node);
  const isSelected = node.id === selectedNodeId || isInSelection;
  const isBypassable = isNodeBypassable(node);
  const isBypassed = isNodeBypassed(node);
  const nodeBadges = getNodeBadges(node);
  const hasAudioBadges = getAudioAnalysisBadges(node).length > 0;
  const analysisProgress = clamp(getNodeParamNumber(node, 'progressPercent'), 0, 100);

  const renderPort = (port: NodeGraphPort) => <NodeGraphPortView key={port.id} node={node} port={port}
    connectionDraft={connectionDraft} onStartConnectionDrag={onStartConnectionDrag} onDisconnectPortEdges={onDisconnectPortEdges} />;

  return (<>
    <div
      role="button"
      tabIndex={0}
      className={[
        'node-workspace-node',
        inlineNumericPorts(node) ? 'node-inline-math' : '',
        `node-workspace-node-${node.kind}`,
        node.binding?.kind === 'flock-node' ? 'node-workspace-node-flock' : '',
        isSelected ? 'selected' : '',
        isBypassed ? 'bypassed' : '',
      ].filter(Boolean).join(' ')}
      data-node-id={node.id}
      onFocusCapture={event => {
        if (!event.target.matches(':focus-visible')) { setFocusBox(null); return; }
        const card = event.currentTarget.getBoundingClientRect(), target = event.target.getBoundingClientRect();
        const scale = card.width / NODE_WIDTH || 1;
        setFocusBox({ left: (target.left - card.left) / scale, top: (target.top - card.top) / scale,
          width: target.width / scale, height: target.height / scale });
      }}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusBox(null);
      }}
      onPointerDownCapture={() => setFocusBox(null)}
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
      onPointerDown={event => {
        event.preventDefault(); event.currentTarget.blur(); onStartNodeDrag(event, node);
      }}
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
          {onTogglePreview && <NodeViewerButton node={node} onToggle={onTogglePreview} />}
        </div>
      </div>
      <div className="node-workspace-node-title" title={node.label}>{node.label}</div>
      <div className="node-workspace-node-description" title={node.description}>
        {node.description ?? 'Built-in processing node'}
      </div>
      {node.binding?.kind === 'keyframe-node' && !canvasRendered && <KeyframeNodeCardPreview node={node} />}
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
      {onPreviewOutput && <NodePreviewOutput node={node} onOutput={onPreviewOutput} />}
      <div className="node-workspace-node-ports" style={{ top: getNodePortStartY(node) }}>
        <div className="node-workspace-port-column">
          {node.inputs.length > 0 && <span className="node-workspace-port-direction">IN</span>}
          {node.inputs.map((port) => renderPort(port))}
        </div>
        <div className="node-workspace-port-column node-workspace-port-column-output" style={inlineNumericPorts(node) && node.inputs.length > 1 ? { marginTop: 42 } : undefined}>
          {node.outputs.length > 0 && <span className="node-workspace-port-direction">OUT</span>}
          {node.outputs.map((port) => renderPort(port))}
        </div>
      </div>
    </div>
    {inlineNumericPorts(node) && <span className="node-math-symbol" title={node.label} aria-label={`${node.label} operation`}
      style={{ left: node.layout.x + 18, top: node.layout.y + getNodePortStartY(node) + (node.inputs.length ? 56 : 8), width: 64 }}>{String(node.params?.mathSymbol ?? '')}</span>}
    {clipId && <MathNodeMode node={node} clipId={clipId} />}
    <NodeValuePreview node={node} />
    {canvasRendered && focusBox && <div aria-hidden="true" className="node-workspace-keyboard-focus"
      style={{ left: node.layout.x + focusBox.left, top: node.layout.y + focusBox.top, width: focusBox.width, height: focusBox.height }} />}
    </>
  );
});
