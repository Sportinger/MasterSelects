import { NodeSummarySegments } from './NodeSummarySegments';
import { recordNodeCardRender } from './rendering/nodeCanvasProfile';
import { memo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { NodeGraphNode, NodeGraphPort } from '../../../../services/nodeGraph';
import { NodeGraphPortView } from './NodeGraphPortView';
import { KeyframeNodeCardPreview } from '../keyframes/KeyframeNodeCurve';
import { NodeAnimationBadge } from '../keyframes/NodeAnimationBadge';
import { NodePreviewOutput, NodeViewerButton } from '../previews/NodePreviewControls';
import { NodeValuePreview } from '../previews/NodeValuePreview';
import { NodeControlInputPicker } from './NodeControlInputPicker';
import { inlineNumericPorts } from '../previews/previewGeometry';
import { requestNodeAnimation } from '../../../../services/nodeGraph/nodeWorkspaceNavigation';
import type { ConnectionDraft } from './canvasGeometry';
import './nodeSummarySegments.css';
import {
  clamp,
  getAudioAnalysisBadges,
  getNodeBadges,
  getNodeHeight,
  getNodeParamNumber,
  getNodePortStartY,
  isNodeBypassable,
  isNodeBypassed,
  NODE_BYPASS_HITBOX,
  getNodeWidth,
} from './canvasGeometry';

export interface NodeGraphNodeCardProps {
  node: NodeGraphNode;
  devProfile?: object;
  clipId?: string;
  canvasRendered?: boolean;
  selectedNodeId: string | null;
  isInSelection?: boolean;
  connectionDraft: ConnectionDraft | null;
  onSelectNode: (nodeId: string) => void;
  onSelectSummarySegment?: (nodeId: string, segmentId: string, additive?: boolean) => void;
  selectedSegmentClipIds?: ReadonlySet<string>;
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
  collapsedGroupId?: string;
  onToggleGroup?: (groupId: string) => void;
  /** Canvas mode: inactive cards keep only their focusable hit target; ports and controls mount when active. */
  active?: boolean;
  onFocusChange?: (nodeId: string, focused: boolean) => void;
}

function getNodeHeaderLabel(node: NodeGraphNode): string {
  const categoryLabel = node.params?.categoryLabel;
  return typeof categoryLabel === 'string' ? categoryLabel : node.kind;
}

export const NodeGraphNodeCard = memo(function NodeGraphNodeCard({
  node,
  devProfile,
  clipId,
  canvasRendered = false,
  selectedNodeId,
  isInSelection = false,
  connectionDraft,
  onSelectNode,
  onSelectSummarySegment,
  selectedSegmentClipIds,
  onStartNodeDrag,
  onNodePointerMove,
  onFinishNodeDrag,
  onStartConnectionDrag,
  onDisconnectPortEdges,
  onToggleNodeBypass,
  onTogglePreview,
  onPreviewOutput,
  collapsedGroupId,
  onToggleGroup,
  active = true,
  onFocusChange,
}: NodeGraphNodeCardProps) {
  if (import.meta.env.DEV && devProfile) recordNodeCardRender(devProfile);
  const content = !canvasRendered || active;
  const [focusBox, setFocusBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const nodeHeight = getNodeHeight(node);
  const isSelected = node.id === selectedNodeId || isInSelection;
  const isBypassable = isNodeBypassable(node);
  const isBypassed = isNodeBypassed(node);
  const nodeBadges = getNodeBadges(node);
  const hasAudioBadges = getAudioAnalysisBadges(node).length > 0;
  const analysisProgress = clamp(getNodeParamNumber(node, 'progressPercent'), 0, 100);

  const renderPort = (port: NodeGraphPort) => <NodeGraphPortView key={port.id} node={node} port={port}
    canvasRendered={canvasRendered}
    connectionDraft={connectionDraft} onStartConnectionDrag={onStartConnectionDrag} onDisconnectPortEdges={onDisconnectPortEdges} />;

  // A display:contents slot reports focus inside the card and its sibling editors.
  return (<div className="node-workspace-node-slot"
    onFocusCapture={() => onFocusChange?.(node.id, true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange?.(node.id, false); }}>
    <div
      role="button"
      tabIndex={0}
      aria-label={canvasRendered ? node.label : undefined}
      aria-description={canvasRendered ? node.description : undefined}
      className={[
        'node-workspace-node',
        inlineNumericPorts(node) ? 'node-inline-math' : '',
        `node-workspace-node-${node.kind}`,
        node.operatorId?.startsWith('values.') ? 'node-workspace-node-value' : '',
        node.binding?.kind === 'flock-node' ? 'node-workspace-node-flock' : '',
        isSelected ? 'selected' : '',
        isBypassed ? 'bypassed' : '',
      ].filter(Boolean).join(' ')}
      data-node-id={node.id}
      onFocusCapture={event => {
        if (!event.target.matches(':focus-visible')) { setFocusBox(null); return; }
        const card = event.currentTarget.getBoundingClientRect(), target = event.target.getBoundingClientRect();
        const scale = card.width / getNodeWidth(node) || 1;
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
        width: getNodeWidth(node),
        height: nodeHeight,
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelectNode(node.id);
      }}
      onPointerDown={event => {
        if (event.button === 2 && event.pointerType === 'mouse') return;
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
      {content && <><div className="node-workspace-node-header">
        <span>{getNodeHeaderLabel(node)}</span>
        <div className="node-workspace-node-header-actions">
          {isBypassable && onToggleNodeBypass && (
            <button
              type="button"
              className={`node-workspace-bypass-button${isBypassed ? ' active' : ''}`}
              style={canvasRendered ? { position: 'absolute', ...NODE_BYPASS_HITBOX } : undefined}
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
      {!canvasRendered && <><div className="node-workspace-node-title" title={node.label} style={collapsedGroupId ? { paddingLeft: 30 } : undefined}>{node.label}</div>
      <div className="node-workspace-node-description" title={node.description}>
        {node.description ?? 'Built-in processing node'}
      </div></>}
      {node.binding?.kind === 'keyframe-node' && !canvasRendered && <KeyframeNodeCardPreview node={node} />}
      {!canvasRendered && node.summary?.bar && <div className="node-composition-mini-bar" aria-hidden="true"><span style={{
        left: `${clamp(node.summary.bar.start, 0, 1) * 100}%`, width: `${Math.max(0, clamp(node.summary.bar.end, 0, 1) - clamp(node.summary.bar.start, 0, 1)) * 100}%`,
      }} /></div>}
      {!!node.animation?.channels.length && (canvasRendered
        ? <button type="button" className="node-animation-badge" style={{ top: getNodePortStartY(node) - 78 }}
            aria-label={`Edit animation for ${node.label}, ${node.animation.channels.length} curves`}
            onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); requestNodeAnimation(node.animation!.clipId, node.workspaceOwner?.localId ?? node.id); if (event.detail > 0) event.currentTarget.blur(); }}>
            <span>â—‡ Animation Â· {node.animation.channels.length} curves</span>
          </button>
        : <NodeAnimationBadge node={node.workspaceOwner ? { ...node, id: node.workspaceOwner.localId } : node} top={getNodePortStartY(node) - 78} />)}
      {!canvasRendered && nodeBadges.length > 0 && (
        <div className="node-workspace-node-badges" style={node.summary?.timeAxis ? { position: 'absolute', top: 28, left: 290 } : undefined}>
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
          {!canvasRendered && node.inputs.length > 0 && <span className="node-workspace-port-direction">IN</span>}
          {node.inputs.map((port) => renderPort(port))}
        </div>
        <div className="node-workspace-port-column node-workspace-port-column-output" style={inlineNumericPorts(node) && node.inputs.length > 1 ? { marginTop: 42 } : undefined}>
          {!canvasRendered && node.outputs.length > 0 && <span className="node-workspace-port-direction">OUT</span>}
          {node.outputs.map((port) => renderPort(port))}
        </div>
      </div></>}
    </div>
    <NodeSummarySegments node={node} canvasRendered={canvasRendered} selectedClipIds={selectedSegmentClipIds} onSelect={onSelectSummarySegment} />
    {content && <><NodeControlInputPicker clipId={clipId} node={node} />
    {collapsedGroupId && onToggleGroup && <button type="button" className="node-workspace-node-expand"
      style={{ left: node.layout.x + 5, top: node.layout.y + 31 }} aria-label={`Expand ${node.label} group`} aria-expanded={false}
      title={`Expand ${node.label}`} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); if (event.detail > 0) event.currentTarget.blur(); onToggleGroup(collapsedGroupId); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
    </button>}
    {!canvasRendered && inlineNumericPorts(node) && <span className="node-math-symbol" title={node.label} aria-label={`${node.label} operation`}
      style={{ left: node.layout.x + 18, top: node.layout.y + getNodePortStartY(node) + (node.inputs.length ? 56 : 8), width: 64 }}>{String(node.params?.mathSymbol ?? '')}</span>}
    <NodeValuePreview node={node} canvasRendered={canvasRendered} />
    {canvasRendered && focusBox && <div aria-hidden="true" className="node-workspace-keyboard-focus"
      style={{ left: node.layout.x + focusBox.left, top: node.layout.y + focusBox.top, width: focusBox.width, height: focusBox.height }} />}
    </>}
  </div>);
});
