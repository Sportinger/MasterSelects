import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { useDockStore } from '../../../stores/dockStore';
import {
  MAX_RUNTIME_PRIMARY_NODES,
  PRIMARY_COLOR_PARAM_DEFS,
  createColorProperty,
  ensureColorCorrectionState,
  getActiveColorVersion,
  getEditableColorNodes,
  type ColorNode,
  type ColorParamDefinition,
  type ColorViewMode,
} from '../../../types';
import type { AnimatableProperty } from '../../../types';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import { DraggableNumber, KeyframeToggle } from '../properties/shared';
import { MIDIParameterLabel } from '../properties/MIDIParameterLabel';
import './colorTab.css';

interface ColorEditorProps {
  clipId: string;
  workspace?: boolean;
  onExitWorkspace?: (viewMode: ColorViewMode) => void;
}

const GRAPH_NODE_WIDTH = 112;
const GRAPH_NODE_HEIGHT = 48;
const GRAPH_NODE_PADDING = 24;

interface ConnectionDragState {
  fromNodeId: string;
  start: { x: number; y: number };
  current: { x: number; y: number };
}

function isEditableNode(node: ColorNode | undefined): node is ColorNode {
  return !!node && node.type !== 'input' && node.type !== 'output';
}

function getControlSections(defs: ColorParamDefinition[]) {
  const sections = new Map<ColorParamDefinition['section'], ColorParamDefinition[]>();
  for (const def of defs) {
    const sectionDefs = sections.get(def.section) ?? [];
    sectionDefs.push(def);
    sections.set(def.section, sectionDefs);
  }
  return [...sections.entries()];
}

const PRIMARY_CONTROL_SECTIONS = getControlSections(PRIMARY_COLOR_PARAM_DEFS);

function getEdgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const tension = Math.max(48, Math.abs(x2 - x1) * 0.38);
  return `M ${x1} ${y1} C ${x1 + tension} ${y1}, ${x2 - tension} ${y2}, ${x2} ${y2}`;
}

function ListViewIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <rect x="1" y="2" width="14" height="2" rx="0.5" />
      <rect x="1" y="7" width="14" height="2" rx="0.5" />
      <rect x="1" y="12" width="14" height="2" rx="0.5" />
    </svg>
  );
}

function NodeViewIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="2" />
      <circle cx="13" cy="4" r="2" />
      <circle cx="13" cy="12" r="2" />
      <path d="M4.8 7.2 11.2 4.8v1.4L5.3 8.5l5.9 2.3v1.4L4.8 9.8V7.2Z" />
    </svg>
  );
}

function InspectorToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M10 2v12" />
      <path
        d={collapsed ? 'M5.2 8 8.2 5v6L5.2 8Z' : 'M8 8 5 5v6l3-3Z'}
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

export function ColorEditor({ clipId, workspace = false, onExitWorkspace }: ColorEditorProps) {
  const graphCanvasRef = useRef<HTMLDivElement>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDragState | null>(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const clip = useTimelineStore(state => state.clips.find(c => c.id === clipId));
  const clipKeyframes = useTimelineStore(state => state.clipKeyframes);
  const {
    ensureColorCorrection,
    setColorCorrectionEnabled,
    setColorViewMode,
    selectColorNode,
    addColorNode,
    removeColorNode,
    moveColorNode,
    connectColorNodes,
    removeColorEdge,
    deleteColorVersion,
    setColorNodeEnabled,
    setColorWorkspaceViewport,
    renameColorNode,
    resetColorNode,
    resetColorCorrection,
    duplicateColorVersion,
    setActiveColorVersion,
    setPropertyValue,
  } = useTimelineStore.getState();
  const playheadPosition = useTimelineStore(state => state.playheadPosition);

  useEffect(() => {
    ensureColorCorrection(clipId);
  }, [clipId, ensureColorCorrection]);

  useEffect(() => {
    if (!selectedEdgeId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      event.preventDefault();
      removeColorEdge(clipId, selectedEdgeId);
      setSelectedEdgeId(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clipId, removeColorEdge, selectedEdgeId]);

  if (!clip) {
    return <div className="panel-empty"><p>Select a clip for color correction</p></div>;
  }

  const colorState = ensureColorCorrectionState(clip.colorCorrection);
  const activeVersion = getActiveColorVersion(colorState)!;
  const editableNodes = getEditableColorNodes(colorState);
  const selectedNode =
    activeVersion.nodes.find(node => node.id === colorState.ui.selectedNodeId) ??
    editableNodes[0];
  const renderedViewMode: ColorViewMode = workspace ? 'nodes' : 'list';
  const workspaceViewport = colorState.ui.workspaceViewport ?? { x: 0, y: 0, zoom: 1 };
  const clipColorKeyframes = clipKeyframes.get(clipId) || [];
  const clipLocalTime = Math.max(0, Math.min(clip.duration, playheadPosition - clip.startTime));
  const selectedNodeHasKeyframes = selectedNode
    ? clipColorKeyframes.some(k => k.property.startsWith(`color.${activeVersion.id}.${selectedNode.id}.`))
    : false;

  const handleBatchStart = () => startBatch('Adjust color');
  const handleBatchEnd = () => endBatch();

  const openWorkspace = () => {
    setColorViewMode(clipId, 'nodes');
    const dock = useDockStore.getState();
    dock.activatePanelType('color-workspace');
    window.setTimeout(() => dock.activatePanelType('color-workspace'), 0);
  };

  const switchViewMode = (nextViewMode: ColorViewMode) => {
    if (nextViewMode === 'nodes') {
      if (workspace) {
        setColorViewMode(clipId, 'nodes');
      } else {
        openWorkspace();
      }
      return;
    }

    setColorViewMode(clipId, 'list');
    if (workspace) {
      onExitWorkspace?.('list');
    }
  };

  const setParam = (nodeId: string, paramName: string, value: number) => {
    setPropertyValue(
      clipId,
      createColorProperty(activeVersion.id, nodeId, paramName) as AnimatableProperty,
      value
    );
  };

  const addNodeDisabled = editableNodes.length >= MAX_RUNTIME_PRIMARY_NODES;

  const toGraphPoint = (event: PointerEvent | React.PointerEvent) => {
    const rect = graphCanvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    const zoom = workspace ? workspaceViewport.zoom : 1;
    const viewportX = workspace ? workspaceViewport.x : 0;
    const viewportY = workspace ? workspaceViewport.y : 0;
    return {
      x: Math.round((event.clientX - rect.left - viewportX) / zoom),
      y: Math.round((event.clientY - rect.top - viewportY) / zoom),
    };
  };

  const startCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!workspace || event.button !== 0) return;

    const target = event.target as Element | null;
    if (target?.closest('.color-graph-node,.color-graph-edge-hit,.color-graph-port,button,input')) {
      return;
    }

    event.preventDefault();
    setSelectedEdgeId(null);
    setIsPanning(true);

    const startX = event.clientX;
    const startY = event.clientY;
    const startViewport = workspaceViewport;

    const handleMove = (moveEvent: PointerEvent) => {
      setColorWorkspaceViewport(clipId, {
        ...startViewport,
        x: Math.round(startViewport.x + moveEvent.clientX - startX),
        y: Math.round(startViewport.y + moveEvent.clientY - startY),
      });
    };

    const finish = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setIsPanning(false);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const startConnectionDrag = (event: React.PointerEvent<HTMLButtonElement>, node: ColorNode) => {
    if (event.button !== 0 || node.type === 'output') return;

    event.preventDefault();
    event.stopPropagation();
    setSelectedEdgeId(null);
    startBatch('Rewire color connection');

    const start = {
      x: node.position.x + GRAPH_NODE_WIDTH,
      y: node.position.y + GRAPH_NODE_HEIGHT / 2,
    };
    setConnectionDrag({
      fromNodeId: node.id,
      start,
      current: toGraphPoint(event),
    });

    const handleMove = (moveEvent: PointerEvent) => {
      setConnectionDrag(current => current
        ? { ...current, current: toGraphPoint(moveEvent) }
        : current
      );
    };

    const finish = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);

      const target = document
        .elementFromPoint(upEvent.clientX, upEvent.clientY)
        ?.closest('[data-color-port="in"]') as HTMLElement | null;
      const toNodeId = target?.dataset.colorNodeId;
      if (toNodeId && toNodeId !== node.id) {
        connectColorNodes(clipId, node.id, toNodeId);
      }

      setConnectionDrag(null);
      endBatch();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const startNodeDrag = (event: React.PointerEvent<HTMLDivElement>, node: ColorNode) => {
    if ((event.target as HTMLElement).closest('button,input,.color-graph-port')) return;
    if (event.button !== 0) return;

    event.preventDefault();
    setSelectedEdgeId(null);
    selectColorNode(clipId, node.id);
    startBatch('Move color node');

    const startX = event.clientX;
    const startY = event.clientY;
    const startPosition = node.position;
    const zoom = workspace ? workspaceViewport.zoom : 1;

    const handleMove = (moveEvent: PointerEvent) => {
      const x = Math.max(0, Math.round(startPosition.x + (moveEvent.clientX - startX) / zoom));
      const y = Math.max(0, Math.round(startPosition.y + (moveEvent.clientY - startY) / zoom));
      moveColorNode(clipId, node.id, { x, y });
    };

    const finish = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      endBatch();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const renderPrimaryControls = (node: ColorNode) => (
    <div className="properties-section color-control-section">
      {PRIMARY_CONTROL_SECTIONS.map(([section, defs]) => (
        <div className="color-control-group" key={section}>
          <h4>{section}</h4>
          {defs.map(def => {
            const baseValue = typeof node.params[def.key] === 'number'
              ? node.params[def.key] as number
              : def.defaultValue;
            const property = createColorProperty(activeVersion.id, node.id, def.key) as AnimatableProperty;
            const value = interpolateKeyframes(clipColorKeyframes, property, clipLocalTime, baseValue);
            const midiTarget = {
              clipId,
              property,
              label: `Color ${def.label}`,
              currentValue: value,
              min: def.min,
              max: def.max,
            };

            return (
              <div className="control-row color-control-row" key={def.key}>
                <KeyframeToggle clipId={clipId} property={property} value={value} />
                <MIDIParameterLabel as="label" target={midiTarget}>{def.label}</MIDIParameterLabel>
                <input
                  type="range"
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  value={value}
                  onChange={(rangeEvent) => setParam(node.id, def.key, Number(rangeEvent.target.value))}
                />
                <DraggableNumber
                  value={value}
                  onChange={(nextValue) => setParam(node.id, def.key, nextValue)}
                  defaultValue={def.defaultValue}
                  sensitivity={Math.max(0.5, (def.max - def.min) / 80)}
                  decimals={def.decimals}
                  min={def.min}
                  max={def.max}
                  persistenceKey={`color.${clipId}.${node.id}.${def.key}`}
                  onDragStart={handleBatchStart}
                  onDragEnd={handleBatchEnd}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  const graphNodes = activeVersion.nodes;
  const graphWidth = Math.max(
    760,
    ...graphNodes.map(node => node.position.x + GRAPH_NODE_WIDTH + GRAPH_NODE_PADDING)
  );
  const graphHeight = Math.max(
    330,
    ...graphNodes.map(node => node.position.y + GRAPH_NODE_HEIGHT + GRAPH_NODE_PADDING)
  );
  const graphNodeById = new Map(graphNodes.map(node => [node.id, node]));
  const graphContentStyle: CSSProperties = {
    width: graphWidth,
    height: graphHeight,
    transform: workspace
      ? `translate(${workspaceViewport.x}px, ${workspaceViewport.y}px) scale(${workspaceViewport.zoom})`
      : undefined,
  };
  const selectedEdge = activeVersion.edges.find(edge => edge.id === selectedEdgeId);
  const editorClassName = [
    'color-editor',
    workspace ? 'color-editor-workspace' : 'color-editor-compact',
    workspace && inspectorCollapsed ? 'color-inspector-collapsed' : '',
  ].filter(Boolean).join(' ');
  const renderInspectorToggle = (collapsed: boolean) => (
    <button
      type="button"
      className={collapsed ? 'color-inspector-rail-button' : 'color-inspector-collapse-button'}
      onClick={() => setInspectorCollapsed(!collapsed)}
      title={collapsed ? 'Show inspector' : 'Collapse inspector'}
      aria-label={collapsed ? 'Show inspector' : 'Collapse inspector'}
    >
      <InspectorToggleIcon collapsed={collapsed} />
    </button>
  );

  return (
    <div className={editorClassName}>
      <div className="color-toolbar">
        <div className="color-view-segment" role="tablist" aria-label="Color view mode">
          <button
            type="button"
            className={`color-view-toggle ${renderedViewMode === 'list' ? 'active' : ''}`}
            onClick={() => switchViewMode('list')}
            title="List view"
            aria-label="List view"
          >
            <ListViewIcon />
          </button>
          <button
            type="button"
            className={`color-view-toggle ${renderedViewMode === 'nodes' ? 'active' : ''}`}
            onClick={() => switchViewMode('nodes')}
            title="Node view"
            aria-label="Node view"
          >
            <NodeViewIcon />
          </button>
        </div>

        <button
          className={!colorState.enabled ? 'color-toggle active' : 'color-toggle'}
          type="button"
          onClick={() => setColorCorrectionEnabled(clipId, !colorState.enabled)}
          title={colorState.enabled ? 'Bypass color correction' : 'Enable color correction'}
        >
          {colorState.enabled ? 'Bypass' : 'Bypassed'}
        </button>

        <button
          type="button"
          onClick={() => addColorNode(clipId, 'primary')}
          disabled={addNodeDisabled}
          title={addNodeDisabled ? `Realtime graph limit is ${MAX_RUNTIME_PRIMARY_NODES} primary nodes` : 'Add serial primary node'}
        >
          Add Node
        </button>
        <button type="button" onClick={() => resetColorCorrection(clipId)}>Reset</button>
        {selectedEdge && (
          <button
            type="button"
            onClick={() => {
              removeColorEdge(clipId, selectedEdge.id);
              setSelectedEdgeId(null);
            }}
          >
            Disconnect
          </button>
        )}
      </div>

      <div className="color-version-row">
        {colorState.versions.map(version => (
          <div
            key={version.id}
            className={`color-version-pill ${version.id === colorState.activeVersionId ? 'active' : ''}`}
          >
            <button
              className="color-version-select"
              type="button"
              onClick={() => setActiveColorVersion(clipId, version.id)}
            >
              {version.name}
            </button>
            {colorState.versions.length > 1 && (
              <button
                className="color-version-delete"
                type="button"
                onClick={() => deleteColorVersion(clipId, version.id)}
                title={`Delete version ${version.name}`}
                aria-label={`Delete version ${version.name}`}
              >
                x
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => duplicateColorVersion(clipId)}>New Version</button>
      </div>

      <div className="color-main">
        <div className="color-view">
          {renderedViewMode === 'nodes' ? (
            <div className="color-graph-scroll">
              <div
                ref={graphCanvasRef}
                className={`color-graph-canvas ${isPanning ? 'panning' : ''}`}
                onPointerDown={startCanvasPan}
                onClick={() => setSelectedEdgeId(null)}
              >
                <div className="color-graph-content" style={graphContentStyle}>
                  <svg
                    className="color-graph-edges"
                    viewBox={`0 0 ${graphWidth} ${graphHeight}`}
                    width={graphWidth}
                    height={graphHeight}
                  >
                    {activeVersion.edges.map(edge => {
                      const fromNode = graphNodeById.get(edge.fromNodeId);
                      const toNode = graphNodeById.get(edge.toNodeId);
                      if (!fromNode || !toNode) return null;
                      const x1 = fromNode.position.x + GRAPH_NODE_WIDTH;
                      const y1 = fromNode.position.y + GRAPH_NODE_HEIGHT / 2;
                      const x2 = toNode.position.x;
                      const y2 = toNode.position.y + GRAPH_NODE_HEIGHT / 2;
                      const path = getEdgePath(x1, y1, x2, y2);
                      return (
                        <g key={edge.id}>
                          <path
                            className="color-graph-edge-hit"
                            d={path}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedEdgeId(edge.id);
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              removeColorEdge(clipId, edge.id);
                              setSelectedEdgeId(null);
                            }}
                          />
                          <path
                            className={`color-graph-edge ${edge.id === selectedEdgeId ? 'selected' : ''}`}
                            d={path}
                          />
                        </g>
                      );
                    })}
                    {connectionDrag && (
                      <path
                        className="color-graph-edge dragging"
                        d={getEdgePath(
                          connectionDrag.start.x,
                          connectionDrag.start.y,
                          connectionDrag.current.x,
                          connectionDrag.current.y
                        )}
                      />
                    )}
                  </svg>
                  {graphNodes.map(node => (
                    <div
                      key={node.id}
                      className={[
                        'color-graph-node',
                        node.id === selectedNode?.id ? 'selected' : '',
                        node.enabled === false ? 'disabled' : '',
                        !workspace ? 'compact-locked' : '',
                        node.type,
                      ].filter(Boolean).join(' ')}
                      style={{
                        left: node.position.x,
                        top: node.position.y,
                        width: GRAPH_NODE_WIDTH,
                        height: GRAPH_NODE_HEIGHT,
                      }}
                      role="button"
                      tabIndex={0}
                      onPointerDown={workspace ? (event) => startNodeDrag(event, node) : undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedEdgeId(null);
                        selectColorNode(clipId, node.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          selectColorNode(clipId, node.id);
                        }
                      }}
                    >
                      {node.type !== 'input' && (
                        <button
                          type="button"
                          className="color-graph-port input-port"
                          data-color-port="in"
                          data-color-node-id={node.id}
                          title="Input"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                        />
                      )}
                      <span className="color-graph-node-type">{node.type}</span>
                      <span className="color-graph-node-name">{node.name}</span>
                      {node.type === 'primary' && (
                        <input
                          type="checkbox"
                          checked={node.enabled !== false}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => setColorNodeEnabled(clipId, node.id, event.target.checked)}
                          title={node.enabled !== false ? 'Disable node' : 'Enable node'}
                        />
                      )}
                      {node.type !== 'output' && (
                        <button
                          type="button"
                          className="color-graph-port output-port"
                          data-color-port="out"
                          data-color-node-id={node.id}
                          title="Drag to connect"
                          onPointerDown={(event) => startConnectionDrag(event, node)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="color-node-list">
              {editableNodes.map(node => (
                <div
                  key={node.id}
                  className={`color-node-row ${node.id === selectedNode?.id ? 'selected' : ''}`}
                  onClick={() => selectColorNode(clipId, node.id)}
                >
                  <input
                    type="checkbox"
                    checked={node.enabled !== false}
                    onChange={(event) => {
                      event.stopPropagation();
                      setColorNodeEnabled(clipId, node.id, event.target.checked);
                    }}
                  />
                  <span className="color-node-row-name">{node.name}</span>
                  {node.id === selectedNode?.id && selectedNodeHasKeyframes && <span className="color-kf-dot">KF</span>}
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      resetColorNode(clipId, node.id);
                    }}
                  >
                    Reset
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      removeColorNode(clipId, node.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="color-inspector">
          {workspace && inspectorCollapsed ? (
            renderInspectorToggle(true)
          ) : isEditableNode(selectedNode) ? (
            <>
              <div className="color-inspector-header">
                <div>
                  <input
                    className="color-node-name-input"
                    value={selectedNode.name}
                    onChange={(event) => renameColorNode(clipId, selectedNode.id, event.target.value)}
                  />
                  <span className="color-inspector-subtitle">{selectedNode.type}</span>
                </div>
                <div className="color-inspector-actions">
                  {workspace && renderInspectorToggle(false)}
                  <button
                    className={selectedNode.enabled !== false ? 'color-toggle active' : 'color-toggle'}
                    onClick={() => setColorNodeEnabled(clipId, selectedNode.id, selectedNode.enabled === false)}
                  >
                    {selectedNode.enabled !== false ? 'On' : 'Off'}
                  </button>
                </div>
              </div>

              {renderPrimaryControls(selectedNode)}
            </>
          ) : (
            <>
              {workspace && (
                <div className="color-inspector-header color-inspector-header-empty">
                  <div className="color-inspector-actions">
                    {renderInspectorToggle(false)}
                  </div>
                </div>
              )}
              <div className="panel-empty"><p>Select a grade node</p></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
