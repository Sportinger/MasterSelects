import { useEffect, useState } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { startBatch, endBatch } from '../../../stores/historyStore';
import {
  MAX_RUNTIME_PRIMARY_NODES,
  PRIMARY_COLOR_PARAM_DEFS,
  RUNTIME_COLOR_PARAM_DEFS,
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
import { ColorNodeCanvas } from './ColorNodeCanvas';
import { InspectorToggleIcon } from './ColorEditorIcons';
import { ColorNodeList } from './ColorNodeList';
import { ColorToolbar } from './ColorToolbar';
import { ColorVersionRow } from './ColorVersionRow';
import { PrimaryColorControls } from './PrimaryColorControls';
import { WheelColorControls } from './WheelColorControls';
import {
  getControlSections,
  getWheelParamDef,
  getWheelPoint,
  getWheelPuckPosition,
  getWheelValuesFromPoint,
  type WheelControlConfig,
} from './colorEditorMath';
import type { ColorEditorNode } from './colorEditorTypes';
import { trackEditorControlCommitted } from '../../../services/productAnalytics';
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
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
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
    deleteColorVersion,
    setColorNodeEnabled,
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

  const colorState = ensureColorCorrectionState(clip?.colorCorrection);
  const activeColorVersion = getActiveColorVersion(colorState);
  if (!clip) {
    return <div className="panel-empty"><p>Select a clip for color correction</p></div>;
  }

  const activeVersion = activeColorVersion!;
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
      return RUNTIME_COLOR_PARAM_DEFS.map(def => ({
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
            maxRuntimePrimaryNodes={MAX_RUNTIME_PRIMARY_NODES}
            onSwitchViewMode={switchViewMode}
            onToggleEnabled={() => setColorCorrectionEnabled(clipId, !colorState.enabled)}
            onSetAllKeyframes={handleSetAllColorKeyframes}
            onAddPrimary={() => addColorNode(clipId, 'primary')}
            onAddWheels={() => addColorNode(clipId, 'wheels')}
            onReset={() => resetColorCorrection(clipId)}
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
            <ColorNodeCanvas clip={clip} selectedNodeId={selectedNode?.id} addNodeDisabled={addNodeDisabled}
              onSelectNode={nodeId => selectColorNode(clipId, nodeId)} />
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
