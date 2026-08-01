import { useEffect, useRef, useState } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { startBatch, endBatch } from '../../../stores/historyStore';
import {
  MAX_RUNTIME_PRIMARY_NODES,
  PRIMARY_COLOR_PARAM_DEFS,
  WHEEL_COLOR_PARAM_DEFS,
  createColorProperty,
  ensureColorCorrectionState,
  getActiveColorVersion,
  getEditableColorNodes,
  type ColorNode,
  type ColorViewMode,
} from '../../../types/colorCorrection';
import type { AnimatableProperty } from '../../../types/animationProperties';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import {
  useEditableDraggableNumberSettingsRevision,
} from '../../common/EditableDraggableNumberSettings';
import { ColorGraphView } from './ColorGraphView';
import { InspectorToggleIcon } from './ColorEditorIcons';
import { ColorNodeList } from './ColorNodeList';
import { ColorToolbar } from './ColorToolbar';
import { ColorVersionRow } from './ColorVersionRow';
import { PrimaryColorControls } from './PrimaryColorControls';
import { WheelColorControls } from './WheelColorControls';
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  getControlSections,
  getWheelParamDef,
  getWheelPoint,
  getWheelValuesFromPoint,
  type WheelControlConfig,
} from './colorEditorMath';
import type { ColorEditorNode, ConnectionDragState } from './colorEditorTypes';
import './colorTab.css';

interface ColorEditorProps {
  clipId: string;
  workspace?: boolean;
  onExitWorkspace?: (viewMode: ColorViewMode) => void;
}

function isEditableNode(node: ColorNode | undefined): node is ColorNode {
  return !!node && node.type !== 'input' && node.type !== 'output';
}

const PRIMARY_CONTROL_SECTIONS = getControlSections(PRIMARY_COLOR_PARAM_DEFS);

export function ColorEditor({ clipId, workspace = false, onExitWorkspace }: ColorEditorProps) {
  const graphCanvasRef = useRef<HTMLDivElement>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDragState | null>(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const rangeSettingsRevision = useEditableDraggableNumberSettingsRevision();
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
    addKeyframe,
    toggleKeyframeRecording,
    isRecording,
  } = useTimelineStore.getState();
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  void rangeSettingsRevision;

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
  const renderedViewMode: ColorViewMode = workspace ? 'nodes' : colorState.ui.viewMode;
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

  const createProperty = (nodeId: string, paramName: string) => (
    createColorProperty(activeVersion.id, nodeId, paramName) as AnimatableProperty
  );

  const getAnimatedParamValue = (node: ColorEditorNode, key: string, defaultValue: number) => {
    const baseValue = typeof node.params[key] === 'number'
      ? node.params[key] as number
      : defaultValue;
    const property = createProperty(node.id, key);
    return interpolateKeyframes(clipColorKeyframes, property, clipLocalTime, baseValue);
  };

  const handleSetAllColorKeyframes = () => {
    const entries = editableNodes.flatMap(node => {
      const defs = node.type === 'wheels'
        ? WHEEL_COLOR_PARAM_DEFS
        : PRIMARY_COLOR_PARAM_DEFS;

      return defs.map(def => ({
        property: createColorProperty(activeVersion.id, node.id, def.key) as AnimatableProperty,
        value: getAnimatedParamValue(node, def.key, def.defaultValue),
      }));
    });

    if (entries.length === 0) return;

    startBatch('Set color keyframes');
    try {
      entries.forEach(({ property, value }) => {
        if (!isRecording(clipId, property)) {
          toggleKeyframeRecording(clipId, property);
        }
        addKeyframe(clipId, property, value);
      });
    } finally {
      endBatch();
    }
  };

  const setWheelChannelValues = (
    nodeId: string,
    config: WheelControlConfig,
    values: { r: number; g: number; b: number }
  ) => {
    setParam(nodeId, config.rKey, values.r);
    setParam(nodeId, config.gKey, values.g);
    setParam(nodeId, config.bKey, values.b);
  };

  const resetWheel = (nodeId: string, config: WheelControlConfig) => {
    handleBatchStart();
    setParam(nodeId, config.rKey, getWheelParamDef(WHEEL_COLOR_PARAM_DEFS, config.rKey).defaultValue);
    setParam(nodeId, config.gKey, getWheelParamDef(WHEEL_COLOR_PARAM_DEFS, config.gKey).defaultValue);
    setParam(nodeId, config.bKey, getWheelParamDef(WHEEL_COLOR_PARAM_DEFS, config.bKey).defaultValue);
    setParam(nodeId, config.yKey, getWheelParamDef(WHEEL_COLOR_PARAM_DEFS, config.yKey).defaultValue);
    handleBatchEnd();
  };

  const applyWheelPadPoint = (
    nodeId: string,
    config: WheelControlConfig,
    pad: HTMLDivElement,
    clientX: number,
    clientY: number
  ) => {
    const point = getWheelPoint(pad, clientX, clientY);
    setWheelChannelValues(nodeId, config, getWheelValuesFromPoint(config, WHEEL_COLOR_PARAM_DEFS, point.x, point.y));
  };

  const startWheelDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    node: ColorEditorNode,
    config: WheelControlConfig
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const pad = event.currentTarget;
    handleBatchStart();
    applyWheelPadPoint(node.id, config, pad, event.clientX, event.clientY);

    let finished = false;
    const handleMove = (moveEvent: PointerEvent) => {
      applyWheelPadPoint(node.id, config, pad, moveEvent.clientX, moveEvent.clientY);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      handleBatchEnd();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
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

  const startConnectionDrag = (event: React.PointerEvent<HTMLButtonElement>, node: ColorEditorNode) => {
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

  const startNodeDrag = (event: React.PointerEvent<HTMLDivElement>, node: ColorEditorNode) => {
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

  const graphNodes = activeVersion.nodes;
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
      <ColorToolbar
        renderedViewMode={renderedViewMode}
        enabled={colorState.enabled}
        addNodeDisabled={addNodeDisabled}
        selectedEdgeId={selectedEdge?.id ?? null}
        maxRuntimePrimaryNodes={MAX_RUNTIME_PRIMARY_NODES}
        onSwitchViewMode={switchViewMode}
        onToggleEnabled={() => setColorCorrectionEnabled(clipId, !colorState.enabled)}
        onSetAllKeyframes={handleSetAllColorKeyframes}
        onAddPrimary={() => addColorNode(clipId, 'primary')}
        onAddWheels={() => addColorNode(clipId, 'wheels')}
        onReset={() => resetColorCorrection(clipId)}
        onDisconnectSelectedEdge={() => {
          if (!selectedEdge) return;
          removeColorEdge(clipId, selectedEdge.id);
          setSelectedEdgeId(null);
        }}
      />

      <ColorVersionRow
        versions={colorState.versions}
        activeVersionId={colorState.activeVersionId}
        onSelectVersion={(versionId) => setActiveColorVersion(clipId, versionId)}
        onDeleteVersion={(versionId) => deleteColorVersion(clipId, versionId)}
        onDuplicateVersion={() => duplicateColorVersion(clipId)}
      />

      <div className="color-main">
        <div className="color-view">
          {renderedViewMode === 'nodes' ? (
            <ColorGraphView
              canvasRef={graphCanvasRef}
              nodes={graphNodes}
              edges={activeVersion.edges}
              workspace={workspace}
              isPanning={isPanning}
              selectedNodeId={selectedNode?.id}
              selectedEdgeId={selectedEdgeId}
              connectionDrag={connectionDrag}
              viewport={workspaceViewport}
              onCanvasPointerDown={startCanvasPan}
              onCanvasClick={() => setSelectedEdgeId(null)}
              onNodePointerDown={startNodeDrag}
              onNodeSelect={(nodeId) => {
                setSelectedEdgeId(null);
                selectColorNode(clipId, nodeId);
              }}
              onNodeEnabledChange={(nodeId, enabled) => setColorNodeEnabled(clipId, nodeId, enabled)}
              onConnectionStart={startConnectionDrag}
              onEdgeSelect={(edgeId) => setSelectedEdgeId(edgeId)}
              onEdgeRemove={(edgeId) => {
                removeColorEdge(clipId, edgeId);
                setSelectedEdgeId(null);
              }}
            />
          ) : (
            <ColorNodeList
              nodes={editableNodes}
              selectedNodeId={selectedNode?.id}
              selectedNodeHasKeyframes={selectedNodeHasKeyframes}
              onSelectNode={(nodeId) => selectColorNode(clipId, nodeId)}
              onSetNodeEnabled={(nodeId, enabled) => setColorNodeEnabled(clipId, nodeId, enabled)}
              onResetNode={(nodeId) => resetColorNode(clipId, nodeId)}
              onRemoveNode={(nodeId) => removeColorNode(clipId, nodeId)}
            />
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

              {selectedNode.type === 'wheels'
                ? (
                  <WheelColorControls
                    clipId={clipId}
                    node={selectedNode}
                    wheelParamDefs={WHEEL_COLOR_PARAM_DEFS}
                    createProperty={createProperty}
                    getParamValue={getAnimatedParamValue}
                    setParam={setParam}
                    resetWheel={resetWheel}
                    startWheelDrag={startWheelDrag}
                    onBatchStart={handleBatchStart}
                    onBatchEnd={handleBatchEnd}
                  />
                )
                : (
                  <PrimaryColorControls
                    clipId={clipId}
                    node={selectedNode}
                    paramSections={PRIMARY_CONTROL_SECTIONS}
                    createProperty={createProperty}
                    getParamValue={getAnimatedParamValue}
                    setParam={setParam}
                    onBatchStart={handleBatchStart}
                    onBatchEnd={handleBatchEnd}
                  />
                )}
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
