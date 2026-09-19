import { useEffect, useRef, useState } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { getClipMediaFileId } from '../../../services/mediaArtifacts/mediaSourceArtifacts';
import {
  MAX_RUNTIME_PRIMARY_NODES,
  PRIMARY_COLOR_PARAM_DEFS,
  WHEEL_COLOR_PARAM_DEFS,
  createColorProperty,
  ensureColorCorrectionState,
  getActiveColorVersion,
  getEditableColorNodes,
  type ColorNode,
  type ColorNodeType,
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
import { useColorGraphCanvasInteraction } from './useColorGraphCanvasInteraction';
import { useColorGraphNodeDrag } from './useColorGraphNodeDrag';
import { useInitialColorGraphLayout } from './useInitialColorGraphLayout';
import { useResponsiveColorGraphAnchors } from './useResponsiveColorGraphAnchors';
import {
  getColorGraphBounds,
  getColorGraphFitViewport,
  getColorGraphOriginalSizeViewport,
} from './colorGraphViewport';
import {
  getColorGraphPortY,
  getColorGraphPortX,
  getControlSections,
  getWheelParamDef,
  getWheelPoint,
  getWheelPuckPosition,
  getWheelValuesFromPoint,
  type WheelControlConfig,
} from './colorEditorMath';
import type { ColorEditorNode, ColorEditorPort, ConnectionDragState } from './colorEditorTypes';
import { trackEditorControlCommitted } from '../../../services/productAnalytics';
import {
  buildClipNodeGraphDocument,
  getNodeGraphView,
} from '../../../services/nodeGraph';
import './colorTab.css';

interface ColorEditorProps {
  clipId: string;
  workspace?: boolean;
  surface?: 'full' | 'nodes' | 'controls';
  controlSet?: 'auto' | 'primary' | 'wheels';
  onExitWorkspace?: (viewMode: ColorViewMode) => void;
}

function isEditableNode(node: ColorNode | undefined): node is ColorNode {
  return !!node && (node.type === 'primary' || node.type === 'wheels');
}

const PRIMARY_CONTROL_SECTIONS = getControlSections(PRIMARY_COLOR_PARAM_DEFS);

export function ColorEditor({
  clipId,
  workspace = false,
  surface = 'full',
  controlSet = 'auto',
  onExitWorkspace,
}: ColorEditorProps) {
  const graphCanvasRef = useRef<HTMLDivElement>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDragState | null>(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const rangeSettingsRevision = useEditableDraggableNumberSettingsRevision();
  const clip = useTimelineStore(state => state.clips.find(c => c.id === clipId));
  const mediaFiles = useMediaStore(state => state.files);
  const clipKeyframes = useTimelineStore(state => state.clipKeyframes);
  const {
    ensureColorCorrection,
    setColorCorrectionEnabled,
    setColorViewMode,
    setColorNodeDisplayMode,
    selectColorNode,
    addColorNode,
    removeColorNode,
    moveColorNode,
    connectColorNodes,
    removeColorEdge,
    deleteColorVersion,
    setColorNodeEnabled,
    setColorWorkspaceViewport,
    initializeColorNodeGraphLayout,
    renameColorNode,
    resetColorNode,
    resetColorNodeStackLayers,
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

  const colorState = ensureColorCorrectionState(clip?.colorCorrection);
  const activeColorVersion = getActiveColorVersion(colorState);
  const workspaceViewport = colorState.ui.workspaceViewport ?? { x: 0, y: 0, zoom: 1 };
  const {
    clearMarqueeSelection,
    isPanning,
    marquee,
    marqueeSelectedNodeIds,
    scrollCanvas,
    startCanvasInteraction,
  } = useColorGraphCanvasInteraction({
    canvasRef: graphCanvasRef,
    getNodes: () => graphNodes,
    selectionScope: clipId,
    viewport: workspaceViewport,
    workspace,
    onViewportChange: viewport => setColorWorkspaceViewport(clipId, viewport),
    onPrimaryNodeSelect: nodeId => {
      setSelectedEdgeId(null);
      selectColorNode(clipId, nodeId);
    },
  });
  useInitialColorGraphLayout({
    canvasRef: graphCanvasRef, clipId,
    enabled: Boolean(clip && workspace && surface !== 'controls'),
    initialize: initializeColorNodeGraphLayout,
    setViewport: setColorWorkspaceViewport,
  });
  useResponsiveColorGraphAnchors({
    canvasRef: graphCanvasRef,
    clipId,
    enabled: Boolean(clip && workspace && surface !== 'controls'),
    nodes: activeColorVersion?.nodes ?? [],
    viewport: workspaceViewport,
    moveNode: moveColorNode,
  });
  const startNodeDrag = useColorGraphNodeDrag({
    canvasRef: graphCanvasRef,
    getNodes: () => graphNodes,
    getEdges: () => graphEdges,
    zoom: workspace ? workspaceViewport.zoom : 1,
    onDragStart: nodeId => {
      setSelectedEdgeId(null);
      clearMarqueeSelection();
      selectColorNode(clipId, nodeId);
      startBatch('Move color node');
    },
    onDragEnd: (nodeId, position) => {
      if (position) moveColorNode(clipId, nodeId, position);
      endBatch();
    },
  });

  if (!clip) {
    return <div className="panel-empty"><p>Select a clip for color correction</p></div>;
  }

  const activeVersion = activeColorVersion!;
  const colorGraph = getNodeGraphView(buildClipNodeGraphDocument(clip), 'color');
  const clipMediaId = getClipMediaFileId(clip);
  const thumbnailUrl = clip.thumbnails?.[0]
    ?? (clipMediaId ? mediaFiles.find(file => file.id === clipMediaId)?.thumbnailUrl : undefined);
  const editableNodes = getEditableColorNodes(colorState);
  const selectedNode =
    activeVersion.nodes.find(node => node.id === colorState.ui.selectedNodeId) ??
    editableNodes[0];
  const renderedViewMode: ColorViewMode = workspace || surface === 'nodes'
    ? 'nodes'
    : colorState.ui.viewMode;
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
    trackEditorControlCommitted({
      area: 'color',
      controlId: `${config.id}.wheel`,
      controlKind: 'button',
      inputMethod: 'reset',
      interaction: 'reset',
      itemId: config.id,
      itemKind: 'property',
    });
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
    config: WheelControlConfig,
    sensitivity = 1,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const pad = event.currentTarget;
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const padRect = pad.getBoundingClientRect();
    const padRadius = Math.max(1, Math.min(padRect.width, padRect.height) / 2);
    const rDef = getWheelParamDef(WHEEL_COLOR_PARAM_DEFS, config.rKey);
    const startPoint = getWheelPuckPosition(config, {
      r: getAnimatedParamValue(node, config.rKey, rDef.defaultValue),
      g: getAnimatedParamValue(node, config.gKey, getWheelParamDef(WHEEL_COLOR_PARAM_DEFS, config.gKey).defaultValue),
      b: getAnimatedParamValue(node, config.bKey, getWheelParamDef(WHEEL_COLOR_PARAM_DEFS, config.bKey).defaultValue),
    }, rDef.defaultValue);
    handleBatchStart();
    if (sensitivity >= 1) {
      applyWheelPadPoint(node.id, config, pad, event.clientX, event.clientY);
    }

    let finished = false;
    const handleMove = (moveEvent: PointerEvent) => {
      if (sensitivity >= 1) {
        applyWheelPadPoint(node.id, config, pad, moveEvent.clientX, moveEvent.clientY);
        return;
      }
      let x = startPoint.x + (moveEvent.clientX - startClientX) / padRadius * sensitivity;
      let y = startPoint.y - (moveEvent.clientY - startClientY) / padRadius * sensitivity;
      const radius = Math.hypot(x, y);
      if (radius > 1) {
        x /= radius;
        y /= radius;
      }
      setWheelChannelValues(
        node.id,
        config,
        getWheelValuesFromPoint(config, WHEEL_COLOR_PARAM_DEFS, x, y),
      );
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      handleBatchEnd();
      trackEditorControlCommitted({
        area: 'color',
        controlId: `${config.id}.wheel`,
        controlKind: 'drag',
        inputMethod: 'drag',
        interaction: 'change',
        itemId: config.id,
        itemKind: 'property',
      });
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

  const startConnectionDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    node: ColorEditorNode,
    port: ColorEditorPort,
  ) => {
    if (event.button !== 0 || !node.outputs?.length) return;

    event.preventDefault();
    event.stopPropagation();
    setSelectedEdgeId(null);
    startBatch('Rewire color connection');

    const start = {
      x: getColorGraphPortX(node, 'output', workspace ? workspaceViewport.zoom : 1),
      y: getColorGraphPortY(node, 'output', port.id, workspace ? workspaceViewport.zoom : 1),
    };
    setConnectionDrag({
      fromNodeId: node.id,
      fromPortId: port.id,
      type: port.type,
      start,
      current: toGraphPoint(event),
    });

    const resolveValidTarget = (pointerEvent: PointerEvent) => {
      const target = document
        .elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)
        ?.closest('[data-color-port-direction="input"]') as HTMLElement | null;
      const nodeId = target?.dataset.colorNodeId;
      const portId = target?.dataset.colorPortId;
      const portType = target?.dataset.colorPortType;
      return nodeId && portId && portType === port.type && nodeId !== node.id
        ? { nodeId, portId }
        : undefined;
    };

    const handleMove = (moveEvent: PointerEvent) => {
      setConnectionDrag(current => current
        ? {
            ...current,
            current: toGraphPoint(moveEvent),
            validTarget: resolveValidTarget(moveEvent),
          }
        : current
      );
    };

    const finish = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);

      const target = resolveValidTarget(upEvent);
      if (target) {
        connectColorNodes(clipId, node.id, target.nodeId, port.id, target.portId);
      }

      setConnectionDrag(null);
      endBatch();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const graphNodes: ColorEditorNode[] = colorGraph.nodes.map((node) => ({
    id: node.id,
    type: node.binding?.kind === 'color-node' ? node.binding.nodeType : node.kind,
    name: node.label,
    enabled: node.params?.enabled !== false,
    params: node.params ?? {},
    position: node.layout,
    inputs: node.inputs.map(port => ({ id: port.id, label: port.label, type: port.type })),
    outputs: node.outputs.map(port => ({ id: port.id, label: port.label, type: port.type })),
  }));
  const graphEdges = colorGraph.edges;
  const updateWorkspaceZoom = (nextZoom: number) => {
    setColorWorkspaceViewport(clipId, {
      ...workspaceViewport,
      zoom: Math.max(0.25, Math.min(2, Number(nextZoom.toFixed(2)))),
    });
  };
  const zoomGraphToWindow = () => {
    const canvasRect = graphCanvasRef.current?.getBoundingClientRect();
    if (!canvasRect || graphNodes.length === 0) return;
    const bounds = getColorGraphBounds(graphNodes);
    if (!bounds) return;
    setColorWorkspaceViewport(
      clipId,
      getColorGraphFitViewport(bounds, canvasRect.width, canvasRect.height),
    );
  };
  const showGraphAtOriginalSize = () => {
    setColorWorkspaceViewport(
      clipId,
      getColorGraphOriginalSizeViewport(workspaceViewport),
    );
  };
  const resetNodePositions = () => {
    const canvasRect = graphCanvasRef.current?.getBoundingClientRect();
    if (!canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) return;
    initializeColorNodeGraphLayout(clipId, canvasRect.width, canvasRect.height, true);
    setColorWorkspaceViewport(clipId, workspaceViewport);
  };
  const addGraphNode = (type: ColorNodeType) => {
    clearMarqueeSelection();
    setSelectedEdgeId(null);
    addColorNode(clipId, type);
  };
  const selectedEdge = graphEdges.find(edge => edge.id === selectedEdgeId);
  const showGraphSurface = surface !== 'controls';
  const showControlSurface = surface !== 'nodes';
  const showEditorChrome = surface === 'full';
  const useWheelControls = controlSet === 'wheels'
    || (controlSet === 'auto' && selectedNode?.type === 'wheels');
  const editorClassName = [
    'color-editor',
    workspace ? 'color-editor-workspace' : 'color-editor-compact',
    `color-editor-surface-${surface}`,
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
      {showEditorChrome && (
        <>
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
        </>
      )}

      <div className="color-main">
        {showGraphSurface && <div className="color-view">
          {renderedViewMode === 'nodes' ? (
            <ColorGraphView
              canvasRef={graphCanvasRef}
              nodes={graphNodes}
              edges={graphEdges}
              workspace={workspace}
              isPanning={isPanning}
              selectedNodeId={selectedNode?.id}
              selectedNodeIds={marqueeSelectedNodeIds}
              selectedEdgeId={selectedEdgeId}
              connectionDrag={connectionDrag}
              marquee={marquee}
              viewport={workspaceViewport}
              thumbnailUrl={thumbnailUrl}
              nodeDisplayMode={colorState.ui.nodeDisplayMode ?? 'thumbnail'}
              addNodeDisabled={addNodeDisabled}
              onCanvasPointerDown={startCanvasInteraction}
              onCanvasWheel={scrollCanvas}
              onCanvasClick={() => setSelectedEdgeId(null)}
              onResetAll={() => resetColorCorrection(clipId)}
              onResetNodeStackLayers={() => resetColorNodeStackLayers(clipId)}
              onAddNode={addGraphNode}
              onZoomIn={() => updateWorkspaceZoom(workspaceViewport.zoom * 1.2)}
              onZoomOut={() => updateWorkspaceZoom(workspaceViewport.zoom / 1.2)}
              onZoomToWindow={zoomGraphToWindow}
              onOriginalSize={showGraphAtOriginalSize}
              onToggleDisplayMode={() => setColorNodeDisplayMode(
                clipId,
                colorState.ui.nodeDisplayMode === 'label' ? 'thumbnail' : 'label',
              )}
              onResetNodePositions={resetNodePositions}
              onNodeRemove={(nodeId) => {
                clearMarqueeSelection();
                removeColorNode(clipId, nodeId);
              }}
              onNodePointerDown={startNodeDrag}
              onNodeSelect={(nodeId) => {
                setSelectedEdgeId(null);
                clearMarqueeSelection();
                selectColorNode(clipId, nodeId);
              }}
              onNodeEnabledChange={(nodeId, enabled) => setColorNodeEnabled(clipId, nodeId, enabled)}
              onConnectionStart={startConnectionDrag}
              onEdgeSelect={(edgeId) => {
                clearMarqueeSelection();
                setSelectedEdgeId(edgeId);
              }}
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
        </div>}

        {showControlSurface && <div className="color-inspector">
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

              {useWheelControls
                ? (
                  <WheelColorControls
                    clipId={clipId}
                    node={selectedNode}
                    wheelParamDefs={WHEEL_COLOR_PARAM_DEFS}
                    resolveLayout={surface === 'controls'}
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
        </div>}
      </div>
    </div>
  );
}
