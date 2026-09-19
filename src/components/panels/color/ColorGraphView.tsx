import { useState, type MouseEvent, type PointerEvent, type RefObject, type WheelEvent } from 'react';
import type { ColorNodeType } from '../../../types/colorCorrection';
import { createNodeColorGradeThumbnailPreview } from '../../../services/colorGrades/colorGradeThumbnailPreview';

import {
  GRAPH_NODE_PADDING,
  getColorGraphNodeBottom,
  getColorGraphNodeHeight,
  getColorGraphNodeRight,
  getColorGraphPortX,
  getColorGraphPortY,
  getColorGraphNodeTop,
  getColorGraphNodeWidth,
  getEdgePath,
  isColorGraphAnchorNode,
  isColorGraphGradeNode,
} from './colorEditorMath';
import { ColorGraphContextMenu } from './ColorGraphContextMenu';
import { ColorGradeThumbnail } from './ColorGradeThumbnail';
import { ColorGraphStructureIcon } from './ColorGraphStructureIcon';
import type {
  ColorEditorEdge,
  ColorEditorNode,
  ColorEditorPort,
  ColorGraphMarquee,
  ConnectionDragState,
} from './colorEditorTypes';
import './colorGraph.css';

interface ColorGraphViewProps {
  canvasRef: RefObject<HTMLDivElement | null>;
  nodes: ColorEditorNode[];
  edges: ColorEditorEdge[];
  workspace: boolean;
  isPanning: boolean;
  selectedNodeId: string | undefined;
  selectedNodeIds: string[];
  selectedEdgeId: string | null;
  connectionDrag: ConnectionDragState | null;
  marquee: ColorGraphMarquee | null;
  viewport: { x: number; y: number; zoom: number };
  thumbnailUrl?: string;
  nodeDisplayMode: 'thumbnail' | 'label';
  addNodeDisabled: boolean;
  onCanvasPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onCanvasWheel: (event: WheelEvent<HTMLDivElement>) => void;
  onCanvasClick: () => void;
  onResetAll: () => void;
  onResetNodeStackLayers: () => void;
  onAddNode: (type: ColorNodeType) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToWindow: () => void;
  onOriginalSize: () => void;
  onToggleDisplayMode: () => void;
  onResetNodePositions: () => void;
  onNodeRemove: (nodeId: string) => void;
  onNodePointerDown: (event: PointerEvent<HTMLDivElement>, node: ColorEditorNode) => void;
  onNodeSelect: (nodeId: string) => void;
  onNodeEnabledChange: (nodeId: string, enabled: boolean) => void;
  onConnectionStart: (
    event: PointerEvent<HTMLButtonElement>,
    node: ColorEditorNode,
    port: ColorEditorPort,
  ) => void;
  onEdgeSelect: (edgeId: string) => void;
  onEdgeRemove: (edgeId: string) => void;
}

export function ColorGraphView({
  canvasRef,
  nodes,
  edges,
  workspace,
  isPanning,
  selectedNodeId,
  selectedNodeIds,
  selectedEdgeId,
  connectionDrag,
  marquee,
  viewport,
  thumbnailUrl,
  nodeDisplayMode,
  addNodeDisabled,
  onCanvasPointerDown,
  onCanvasWheel,
  onCanvasClick,
  onResetAll,
  onResetNodeStackLayers,
  onAddNode,
  onZoomIn,
  onZoomOut,
  onZoomToWindow,
  onOriginalSize,
  onToggleDisplayMode,
  onResetNodePositions,
  onNodeRemove,
  onNodePointerDown,
  onNodeSelect,
  onNodeEnabledChange,
  onConnectionStart,
  onEdgeSelect,
  onEdgeRemove,
}: ColorGraphViewProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId?: string;
    edgeId?: string;
    openSubmenuLeft: boolean;
  } | null>(null);
  const [hoveredPort, setHoveredPort] = useState<{
    nodeId: string;
    portId: string;
    direction: 'input' | 'output';
    type: ColorEditorPort['type'];
  } | null>(null);
  const visualZoom = workspace ? viewport.zoom : 1;
  const graphWidth = Math.max(
    760,
    ...nodes.map(node => getColorGraphNodeRight(node, visualZoom) + GRAPH_NODE_PADDING)
  );
  const graphHeight = Math.max(
    330,
    ...nodes.map(node => getColorGraphNodeBottom(node, visualZoom) + GRAPH_NODE_PADDING)
  );
  const graphNodeById = new Map(nodes.map(node => [node.id, node]));
  const connectionTargetNode = connectionDrag?.validTarget
    ? graphNodeById.get(connectionDrag.validTarget.nodeId)
    : undefined;
  const connectionTargetPort = connectionTargetNode?.inputs?.find(
    port => port.id === connectionDrag?.validTarget?.portId,
  );
  const editableNodeIndexById = new Map(
    nodes
      .filter(isColorGraphGradeNode)
      .map((node, index) => [node.id, index + 1] as const),
  );
  const graphContentStyle = {
    width: graphWidth,
    height: graphHeight,
    transform: workspace
      ? `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
      : undefined,
  };
  const contextNode = contextMenu?.nodeId
    ? graphNodeById.get(contextMenu.nodeId)
    : undefined;

  const closeContextMenu = () => setContextMenu(null);

  const positionContextMenu = (
    event: MouseEvent<Element>,
    nodeId?: string,
    edgeId?: string,
  ) => {
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 222;
    const menuHeight = edgeId ? 30 : nodeId ? 285 : 258;
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX - rect.left, rect.width - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY - rect.top, rect.height - menuHeight - 8)),
      nodeId,
      edgeId,
      openSubmenuLeft: event.clientX - rect.left > rect.width / 2,
    });
  };
  const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const targetNode = (event.target as Element | null)
      ?.closest<HTMLElement>('[data-color-node-id]');
    positionContextMenu(event, targetNode?.dataset.colorNodeId);
  };
  const marqueeStyle = marquee ? {
    left: Math.min(marquee.start.x, marquee.current.x),
    top: Math.min(marquee.start.y, marquee.current.y),
    width: Math.abs(marquee.current.x - marquee.start.x),
    height: Math.abs(marquee.current.y - marquee.start.y),
  } : undefined;
  const gridSize = 52 * (workspace ? viewport.zoom : 1);
  const graphBackgroundStyle = workspace ? {
    backgroundPosition: `${viewport.x}px ${viewport.y}px`,
    backgroundSize: `${gridSize}px ${gridSize}px`,
  } : undefined;

  return (
    <div className="color-graph-scroll" style={graphBackgroundStyle}>
      <div
        ref={canvasRef}
        className={[
          'color-graph-canvas',
          isPanning ? 'panning' : '',
          nodeDisplayMode === 'label' ? 'labels-only' : '',
        ].filter(Boolean).join(' ')}
        onPointerDown={onCanvasPointerDown}
        onWheel={onCanvasWheel}
        onClick={() => {
          closeContextMenu();
          onCanvasClick();
        }}
        onContextMenu={openContextMenu}
      >
        <div className="color-graph-content" style={graphContentStyle}>
          <svg
            className="color-graph-edges"
            viewBox={`0 0 ${graphWidth} ${graphHeight}`}
            width={graphWidth}
            height={graphHeight}
          >
            {edges.map(edge => {
              const fromNode = graphNodeById.get(edge.fromNodeId);
              const toNode = graphNodeById.get(edge.toNodeId);
              if (!fromNode || !toNode) return null;
              const x1 = getColorGraphPortX(fromNode, 'output', visualZoom);
              const y1 = getColorGraphPortY(fromNode, 'output', edge.fromPortId, visualZoom);
              const x2 = getColorGraphPortX(toNode, 'input', visualZoom);
              const y2 = getColorGraphPortY(toNode, 'input', edge.toPortId, visualZoom);
              const path = getEdgePath(x1, y1, x2, y2);
              const midpointX = (x1 + x2) / 2;
              const midpointY = (y1 + y2) / 2;
              const targetHalfPath = getEdgePath(midpointX, midpointY, x2, y2);
              const portHovered = hoveredPort?.direction === 'input'
                ? edge.toNodeId === hoveredPort.nodeId && edge.toPortId === hoveredPort.portId
                : hoveredPort?.direction === 'output'
                  && edge.fromNodeId === hoveredPort.nodeId
                  && edge.fromPortId === hoveredPort.portId;
              return (
                <g
                  key={edge.id}
                  className="color-graph-edge-group"
                  data-color-edge-id={edge.id}
                >
                  <path
                    className={[
                      'color-graph-edge',
                      edge.type === 'mask' ? 'mask' : 'texture',
                      edge.id === selectedEdgeId ? 'selected' : '',
                      portHovered ? 'port-hover' : '',
                    ].filter(Boolean).join(' ')}
                    d={path}
                  />
                  <path
                    className="color-graph-edge-flow-highlight"
                    data-color-edge-half="target"
                    d={targetHalfPath}
                  />
                  <path
                    className="color-graph-edge-hit"
                    d={path}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (edge.id === selectedEdgeId) {
                        onEdgeRemove(edge.id);
                      } else {
                        onEdgeSelect(edge.id);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      positionContextMenu(event, undefined, edge.id);
                    }}
                  />
                  <path
                    className="color-graph-edge-hit color-graph-edge-flow-hit"
                    data-color-edge-action="disconnect-target"
                    d={targetHalfPath}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdgeRemove(edge.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      positionContextMenu(event, undefined, edge.id);
                    }}
                  />
                </g>
              );
            })}
            {connectionDrag && (
              <path
                className={`color-graph-edge dragging ${connectionDrag.type === 'mask' ? 'mask' : 'texture'}`}
                d={getEdgePath(
                  connectionDrag.start.x,
                  connectionDrag.start.y,
                  connectionDrag.current.x,
                  connectionDrag.current.y
                )}
              />
            )}
          </svg>
          {marqueeStyle && <div className="color-graph-marquee" style={marqueeStyle} />}
          {nodes.map(node => {
            const anchor = isColorGraphAnchorNode(node);
            const grade = isColorGraphGradeNode(node);
            const nodeIndex = editableNodeIndexById.get(node.id);
            const displayName = node.type === 'primary' ? 'Corrector' : node.name;
            const thumbnailPreview = grade
              ? createNodeColorGradeThumbnailPreview(nodes, node.id)
              : undefined;

            return (
              <div
                key={node.id}
                className={[
                  'color-graph-node',
                  anchor ? 'anchor' : grade ? 'grade' : 'structure',
                  (selectedNodeIds.length > 0
                    ? selectedNodeIds.includes(node.id)
                    : node.id === selectedNodeId) ? 'selected' : '',
                  node.enabled === false ? 'disabled' : '',
                  !workspace ? 'compact-locked' : '',
                  node.type,
                ].filter(Boolean).join(' ')}
                data-color-node-id={node.id}
                data-color-node-role={anchor ? 'anchor' : grade ? 'grade' : 'structure'}
                style={{
                  left: node.position.x,
                  top: getColorGraphNodeTop(node),
                  width: getColorGraphNodeWidth(node),
                  height: getColorGraphNodeHeight(node),
                  transform: workspace ? `scale(${1 / viewport.zoom})` : undefined,
                  transformOrigin: workspace ? '0 0' : undefined,
                }}
                role="button"
                tabIndex={0}
                title={displayName}
                onPointerDown={workspace ? (event) => onNodePointerDown(event, node) : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  onNodeSelect(node.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    onNodeSelect(node.id);
                  }
                }}
              >
                {(node.inputs ?? []).map(port => (
                  <button
                    key={port.id}
                    type="button"
                    className={[
                      'color-graph-port',
                      'input-port',
                      port.type === 'mask' ? 'mask' : 'texture',
                      connectionDrag?.validTarget?.nodeId === node.id
                        && connectionDrag.validTarget.portId === port.id
                        ? 'connection-valid-target'
                        : '',
                    ].filter(Boolean).join(' ')}
                    data-color-port-direction="input"
                    data-color-port-id={port.id}
                    data-color-port-type={port.type}
                    data-color-node-id={node.id}
                    style={{
                      top: getColorGraphPortY(node, 'input', port.id) - getColorGraphNodeTop(node),
                    }}
                    title={port.label}
                    onPointerEnter={() => setHoveredPort({
                      nodeId: node.id,
                      portId: port.id,
                      direction: 'input',
                      type: port.type,
                    })}
                    onPointerLeave={() => setHoveredPort(null)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  />
                ))}
                {grade && (
                  <>
                    <ColorGradeThumbnail
                      className="color-graph-node-preview"
                      preview={thumbnailPreview}
                      sourceUrl={thumbnailUrl}
                    >
                      <span>{node.name.slice(0, 1).toUpperCase()}</span>
                    </ColorGradeThumbnail>
                    <div className="color-graph-node-footer">
                      <button
                        type="button"
                        aria-label={`${node.enabled !== false ? 'Disable' : 'Enable'} ${displayName}`}
                        aria-pressed={node.enabled !== false}
                        className="color-graph-node-index"
                        title={node.enabled !== false ? `Disable ${displayName}` : `Enable ${displayName}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onNodeEnabledChange(node.id, node.enabled === false);
                        }}
                      >
                        {String(nodeIndex ?? 1).padStart(2, '0')}
                      </button>
                      <span className="color-graph-node-name">{node.name}</span>
                    </div>
                  </>
                )}
                {!anchor && !grade && (
                  <ColorGraphStructureIcon type={node.type} />
                )}
                {(node.outputs ?? []).map(port => (
                  <button
                    key={port.id}
                    type="button"
                    className={`color-graph-port output-port ${port.type === 'mask' ? 'mask' : 'texture'}`}
                    data-color-port-direction="output"
                    data-color-port-id={port.id}
                    data-color-port-type={port.type}
                    data-color-node-id={node.id}
                    onPointerEnter={() => setHoveredPort({
                      nodeId: node.id,
                      portId: port.id,
                      direction: 'output',
                      type: port.type,
                    })}
                    onPointerLeave={() => setHoveredPort(null)}
                    style={{
                      top: getColorGraphPortY(node, 'output', port.id) - getColorGraphNodeTop(node),
                    }}
                    title={`${port.label} — drag to connect`}
                    onPointerDown={(event) => onConnectionStart(event, node, port)}
                    onClick={(event) => event.stopPropagation()}
                  />
                ))}
                {!connectionDrag && hoveredPort?.nodeId === node.id && (
                  <div className="color-graph-port-tooltip" role="tooltip">
                    {hoveredPort.type === 'mask' ? 'Key' : 'RGB'}
                  </div>
                )}
              </div>
            );
          })}
          {connectionDrag?.validTarget && connectionTargetPort && (
            <div
              className="color-graph-connection-tooltip"
              role="tooltip"
              style={{
                left: connectionDrag.current.x + 10 / visualZoom,
                top: connectionDrag.current.y + 12 / visualZoom,
                transform: `scale(${1 / visualZoom})`,
                transformOrigin: '0 0',
              }}
            >
              {connectionTargetPort.label}
            </div>
          )}
        </div>
        {contextMenu && (
          <ColorGraphContextMenu
            style={{ left: contextMenu.x, top: contextMenu.y }}
            openSubmenuLeft={contextMenu.openSubmenuLeft}
            contextNode={contextNode}
            contextEdgeId={contextMenu.edgeId}
            addCorrectorDisabled={addNodeDisabled}
            alphaOutputExists={nodes.some(node => node.type === 'alpha-output')}
            onClose={closeContextMenu}
            onResetAll={onResetAll}
            onResetNodeStackLayers={onResetNodeStackLayers}
            onAddNode={onAddNode}
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
            onZoomToWindow={onZoomToWindow}
            onOriginalSize={onOriginalSize}
            onToggleDisplayMode={onToggleDisplayMode}
            onResetNodePositions={onResetNodePositions}
            onNodeRemove={onNodeRemove}
            onEdgeRemove={onEdgeRemove}
          />
        )}
      </div>
    </div>
  );
}
