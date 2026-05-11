import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { useDockStore } from '../../../stores/dockStore';
import {
  MAX_RUNTIME_PRIMARY_NODES,
  PRIMARY_COLOR_PARAM_DEFS,
  WHEEL_COLOR_PARAM_DEFS,
  createColorProperty,
  ensureColorCorrectionState,
  getActiveColorVersion,
  getEditableColorNodes,
  type ColorNode,
  type ColorParamDefinition,
  type ColorViewMode,
  type RuntimePrimaryColorParams,
} from '../../../types';
import type { AnimatableProperty } from '../../../types';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import { DraggableNumber, KeyframeToggle } from '../properties/shared';
import {
  getEffectiveEditableDraggableNumberSettings,
  useEditableDraggableNumberSettingsRevision,
} from '../../common/EditableDraggableNumberSettings';
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

type RuntimeColorParamKey = keyof RuntimePrimaryColorParams;

interface WheelControlConfig {
  id: 'lift' | 'gamma' | 'gain' | 'offset';
  label: string;
  rKey: RuntimeColorParamKey;
  gKey: RuntimeColorParamKey;
  bKey: RuntimeColorParamKey;
  yKey: RuntimeColorParamKey;
  chromaRange: number;
}

const WHEEL_PARAM_DEF_BY_KEY = new Map(
  WHEEL_COLOR_PARAM_DEFS.map(def => [def.key, def])
);

const WHEEL_CONTROL_CONFIGS: WheelControlConfig[] = [
  { id: 'lift', label: 'Lift', rKey: 'liftR', gKey: 'liftG', bKey: 'liftB', yKey: 'liftY', chromaRange: 0.35 },
  { id: 'gamma', label: 'Gamma', rKey: 'gammaR', gKey: 'gammaG', bKey: 'gammaB', yKey: 'gammaY', chromaRange: 0.65 },
  { id: 'gain', label: 'Gain', rKey: 'gainR', gKey: 'gainG', bKey: 'gainB', yKey: 'gainY', chromaRange: 0.65 },
  { id: 'offset', label: 'Offset', rKey: 'offsetR', gKey: 'offsetG', bKey: 'offsetB', yKey: 'offsetY', chromaRange: 0.45 },
];

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getWheelParamDef(key: RuntimeColorParamKey): ColorParamDefinition {
  const def = WHEEL_PARAM_DEF_BY_KEY.get(key);
  if (!def) {
    throw new Error(`Missing wheel color parameter definition for ${String(key)}`);
  }
  return def;
}

function getWheelPuckPosition(
  config: WheelControlConfig,
  values: { r: number; g: number; b: number }
): { x: number; y: number } {
  const neutral = getWheelParamDef(config.rKey).defaultValue;
  const rBias = values.r - neutral;
  const gBias = values.g - neutral;
  const bBias = values.b - neutral;
  const x = (rBias - bBias) / (2 * config.chromaRange);
  const y = (2 * gBias - rBias - bBias) / (3 * config.chromaRange);
  return {
    x: clampNumber(x, -1, 1),
    y: clampNumber(y, -1, 1),
  };
}

function getWheelValuesFromPoint(
  config: WheelControlConfig,
  x: number,
  y: number
): { r: number; g: number; b: number } {
  const neutral = getWheelParamDef(config.rKey).defaultValue;
  const rDef = getWheelParamDef(config.rKey);
  const gDef = getWheelParamDef(config.gKey);
  const bDef = getWheelParamDef(config.bKey);
  return {
    r: clampNumber(neutral + x * config.chromaRange - y * config.chromaRange * 0.5, rDef.min, rDef.max),
    g: clampNumber(neutral + y * config.chromaRange, gDef.min, gDef.max),
    b: clampNumber(neutral - x * config.chromaRange - y * config.chromaRange * 0.5, bDef.min, bDef.max),
  };
}

function getWheelPoint(pad: HTMLDivElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = pad.getBoundingClientRect();
  const rawX = ((clientX - rect.left) / rect.width - 0.5) * 2;
  const rawY = -(((clientY - rect.top) / rect.height - 0.5) * 2);
  const radius = Math.hypot(rawX, rawY);
  if (radius <= 1) {
    return { x: rawX, y: rawY };
  }
  return { x: rawX / radius, y: rawY / radius };
}

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

function SetAllKeyframesIcon() {
  return (
    <svg className="color-keyframe-all-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 2.5 6.4 5 4 7.5 1.6 5 4 2.5Z" />
      <path d="M4 8.5 6.4 11 4 13.5 1.6 11 4 8.5Z" />
      <path d="M10 2.5 12.4 5 10 7.5 7.6 5 10 2.5Z" />
      <path d="M12 9.2v5.2M9.4 11.8h5.2" />
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

  const getAnimatedParamValue = (node: ColorNode, key: RuntimeColorParamKey, defaultValue: number) => {
    const baseValue = typeof node.params[key] === 'number'
      ? node.params[key] as number
      : defaultValue;
    const property = createColorProperty(activeVersion.id, node.id, key) as AnimatableProperty;
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
    setParam(nodeId, config.rKey, getWheelParamDef(config.rKey).defaultValue);
    setParam(nodeId, config.gKey, getWheelParamDef(config.gKey).defaultValue);
    setParam(nodeId, config.bKey, getWheelParamDef(config.bKey).defaultValue);
    setParam(nodeId, config.yKey, getWheelParamDef(config.yKey).defaultValue);
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
    setWheelChannelValues(nodeId, config, getWheelValuesFromPoint(config, point.x, point.y));
  };

  const startWheelDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    node: ColorNode,
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
            const persistenceKey = `color.${clipId}.${node.id}.${def.key}`;
            const sliderSettings = getEffectiveEditableDraggableNumberSettings({
              persistenceKey,
              min: def.min,
              max: def.max,
              defaultValue: def.defaultValue,
            });
            const sliderMin = sliderSettings.min ?? def.min;
            const sliderMax = sliderSettings.max ?? def.max;

            return (
              <div className="control-row color-control-row" key={def.key}>
                <KeyframeToggle clipId={clipId} property={property} value={value} />
                <MIDIParameterLabel as="label" target={midiTarget}>{def.label}</MIDIParameterLabel>
                <input
                  type="range"
                  min={sliderMin}
                  max={sliderMax}
                  step={def.step}
                  value={clampNumber(value, sliderMin, sliderMax)}
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
                  persistenceKey={persistenceKey}
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

  const renderWheelControls = (node: ColorNode) => (
    <div className="properties-section color-control-section color-wheel-section">
      <div className="color-wheels-grid">
        {WHEEL_CONTROL_CONFIGS.map(config => {
          const rDef = getWheelParamDef(config.rKey);
          const gDef = getWheelParamDef(config.gKey);
          const bDef = getWheelParamDef(config.bKey);
          const yDef = getWheelParamDef(config.yKey);
          const values = {
            r: getAnimatedParamValue(node, config.rKey, rDef.defaultValue),
            g: getAnimatedParamValue(node, config.gKey, gDef.defaultValue),
            b: getAnimatedParamValue(node, config.bKey, bDef.defaultValue),
          };
          const yProperty = createColorProperty(activeVersion.id, node.id, config.yKey) as AnimatableProperty;
          const yValue = getAnimatedParamValue(node, config.yKey, yDef.defaultValue);
          const yPersistenceKey = `color.${clipId}.${node.id}.${config.yKey}`;
          const ySliderSettings = getEffectiveEditableDraggableNumberSettings({
            persistenceKey: yPersistenceKey,
            min: yDef.min,
            max: yDef.max,
            defaultValue: yDef.defaultValue,
          });
          const ySliderMin = ySliderSettings.min ?? yDef.min;
          const ySliderMax = ySliderSettings.max ?? yDef.max;
          const puck = getWheelPuckPosition(config, values);
          const padStyle = {
            '--puck-x': `${50 + puck.x * 43}%`,
            '--puck-y': `${50 - puck.y * 43}%`,
          } as CSSProperties;
          const channelControls = [
            { label: 'R', key: config.rKey, def: rDef, value: values.r },
            { label: 'G', key: config.gKey, def: gDef, value: values.g },
            { label: 'B', key: config.bKey, def: bDef, value: values.b },
          ];

          return (
            <div className="color-wheel-control" key={config.id}>
              <div className="color-wheel-title">
                <span>{config.label}</span>
                <button
                  type="button"
                  className="color-wheel-reset"
                  onClick={() => resetWheel(node.id, config)}
                >
                  Reset
                </button>
              </div>
              <div
                className={`color-wheel-pad color-wheel-pad-${config.id}`}
                style={padStyle}
                onPointerDown={(event) => startWheelDrag(event, node, config)}
                role="presentation"
              >
                <span className="color-wheel-puck" />
              </div>

              <div className="color-wheel-luma-row">
                <KeyframeToggle clipId={clipId} property={yProperty} value={yValue} />
                <MIDIParameterLabel
                  as="label"
                  target={{
                    clipId,
                    property: yProperty,
                    label: `Color ${config.label} Y`,
                    currentValue: yValue,
                    min: yDef.min,
                    max: yDef.max,
                  }}
                >
                  Y
                </MIDIParameterLabel>
                <input
                  type="range"
                  min={ySliderMin}
                  max={ySliderMax}
                  step={yDef.step}
                  value={clampNumber(yValue, ySliderMin, ySliderMax)}
                  onChange={(rangeEvent) => setParam(node.id, config.yKey, Number(rangeEvent.target.value))}
                />
                <DraggableNumber
                  value={yValue}
                  onChange={(nextValue) => setParam(node.id, config.yKey, nextValue)}
                  defaultValue={yDef.defaultValue}
                  sensitivity={Math.max(0.5, (yDef.max - yDef.min) / 80)}
                  decimals={yDef.decimals}
                  min={yDef.min}
                  max={yDef.max}
                  persistenceKey={yPersistenceKey}
                  onDragStart={handleBatchStart}
                  onDragEnd={handleBatchEnd}
                />
              </div>

              <div className="color-wheel-channel-grid">
                {channelControls.map(({ label, key, def, value }) => {
                  const property = createColorProperty(activeVersion.id, node.id, key) as AnimatableProperty;
                  return (
                    <div className="color-wheel-channel-row" key={key}>
                      <KeyframeToggle clipId={clipId} property={property} value={value} />
                      <MIDIParameterLabel
                        as="label"
                        target={{
                          clipId,
                          property,
                          label: `Color ${config.label} ${label}`,
                          currentValue: value,
                          min: def.min,
                          max: def.max,
                        }}
                      >
                        {label}
                      </MIDIParameterLabel>
                      <DraggableNumber
                        value={value}
                        onChange={(nextValue) => setParam(node.id, key, nextValue)}
                        defaultValue={def.defaultValue}
                        sensitivity={Math.max(0.5, (def.max - def.min) / 80)}
                        decimals={def.decimals}
                        min={def.min}
                        max={def.max}
                        persistenceKey={`color.${clipId}.${node.id}.${key}`}
                        onDragStart={handleBatchStart}
                        onDragEnd={handleBatchEnd}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
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
          className="color-keyframe-all-button"
          onClick={handleSetAllColorKeyframes}
          title="Enable all color stopwatches and set keyframes at the playhead"
          aria-label="Enable all color stopwatches and set keyframes at the playhead"
        >
          <SetAllKeyframesIcon />
        </button>

        <button
          type="button"
          onClick={() => addColorNode(clipId, 'primary')}
          disabled={addNodeDisabled}
          title={addNodeDisabled ? `Realtime graph limit is ${MAX_RUNTIME_PRIMARY_NODES} color nodes` : 'Add serial primary node'}
        >
          Add Primary
        </button>
        <button
          type="button"
          onClick={() => addColorNode(clipId, 'wheels')}
          disabled={addNodeDisabled}
          title={addNodeDisabled ? `Realtime graph limit is ${MAX_RUNTIME_PRIMARY_NODES} color nodes` : 'Add lift gamma gain wheels node'}
        >
          Add Wheels
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
                      {node.type !== 'input' && node.type !== 'output' && (
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

              {selectedNode.type === 'wheels'
                ? renderWheelControls(selectedNode)
                : renderPrimaryControls(selectedNode)}
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
