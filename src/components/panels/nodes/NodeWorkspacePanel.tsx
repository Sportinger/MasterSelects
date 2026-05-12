import { useCallback, useMemo, useState } from 'react';
import type { NodeGraphLayout, NodeGraphNode, NodeGraphPort } from '../../../services/nodeGraph';
import { useDockStore } from '../../../stores/dockStore';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { AnimatableProperty, BlendMode, TimelineClip } from '../../../types';
import { EditableDraggableNumber as DraggableNumber } from '../../common/EditableDraggableNumber';
import { BLEND_MODE_GROUPS, formatBlendModeName } from '../properties/sharedConstants';
import { NodeGraphCanvas } from './NodeGraphCanvas';
import { useNodeGraphSubject } from './useNodeGraphSubject';
import './NodeWorkspacePanel.css';

const CLIP_SPEED_MIN_PERCENT = -10000;
const CLIP_SPEED_MAX_PERCENT = 10000;

function formatParamValue(value: string | number | boolean): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
  }
  return String(value);
}

interface NumericParamEditorProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  defaultValue: number;
  decimals?: number;
  suffix?: string;
  min?: number;
  max?: number;
  sensitivity?: number;
}

function NumericParamEditor({
  label,
  value,
  onChange,
  defaultValue,
  decimals = 2,
  suffix,
  min,
  max,
  sensitivity = 1,
}: NumericParamEditorProps) {
  return (
    <div className="node-workspace-param node-workspace-param-editable">
      <span>{label}</span>
      <DraggableNumber
        value={value}
        onChange={onChange}
        defaultValue={defaultValue}
        decimals={decimals}
        suffix={suffix}
        min={min}
        max={max}
        sensitivity={sensitivity}
        onDragStart={() => startBatch('Adjust node parameter')}
        onDragEnd={() => endBatch()}
      />
    </div>
  );
}

function TransformNodeParameters({ clip }: { clip: TimelineClip }) {
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const updateClipTransform = useTimelineStore((state) => state.updateClipTransform);
  const toggleClipReverse = useTimelineStore((state) => state.toggleClipReverse);

  const setTransformProperty = useCallback((property: AnimatableProperty, value: number) => {
    setPropertyValue(clip.id, property, value);
  }, [clip.id, setPropertyValue]);

  const opacityPct = clip.transform.opacity * 100;
  const speedPct = (clip.speed ?? 1) * 100;
  const scaleXPct = clip.transform.scale.x * 100;
  const scaleYPct = clip.transform.scale.y * 100;
  const reversed = clip.reversed === true;

  return (
    <div className="node-workspace-param-list">
      <NumericParamEditor
        label="Opacity"
        value={opacityPct}
        onChange={(value) => setTransformProperty('opacity', Math.max(0, Math.min(100, value)) / 100)}
        defaultValue={100}
        decimals={1}
        suffix="%"
        min={0}
        max={100}
      />
      <NumericParamEditor
        label="Position X"
        value={clip.transform.position.x}
        onChange={(value) => setTransformProperty('position.x', value)}
        defaultValue={0}
        decimals={3}
        sensitivity={0.2}
      />
      <NumericParamEditor
        label="Position Y"
        value={clip.transform.position.y}
        onChange={(value) => setTransformProperty('position.y', value)}
        defaultValue={0}
        decimals={3}
        sensitivity={0.2}
      />
      <NumericParamEditor
        label="Scale X"
        value={scaleXPct}
        onChange={(value) => setTransformProperty('scale.x', value / 100)}
        defaultValue={100}
        decimals={1}
        suffix="%"
        min={0}
      />
      <NumericParamEditor
        label="Scale Y"
        value={scaleYPct}
        onChange={(value) => setTransformProperty('scale.y', value / 100)}
        defaultValue={100}
        decimals={1}
        suffix="%"
        min={0}
      />
      <NumericParamEditor
        label="Rotation"
        value={clip.transform.rotation.z}
        onChange={(value) => setTransformProperty('rotation.z', value)}
        defaultValue={0}
        decimals={1}
        suffix="deg"
        sensitivity={0.5}
      />
      <NumericParamEditor
        label="Speed"
        value={speedPct}
        onChange={(value) => setTransformProperty('speed', value / 100)}
        defaultValue={100}
        decimals={0}
        suffix="%"
        min={CLIP_SPEED_MIN_PERCENT}
        max={CLIP_SPEED_MAX_PERCENT}
      />
      <label className="node-workspace-param node-workspace-param-editable">
        <span>Blend</span>
        <select
          value={clip.transform.blendMode}
          onChange={(event) => updateClipTransform(clip.id, { blendMode: event.target.value as BlendMode })}
        >
          {BLEND_MODE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.modes.map((mode) => (
                <option key={mode} value={mode}>{formatBlendModeName(mode)}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="node-workspace-param node-workspace-param-editable node-workspace-param-checkbox">
        <span>Reversed</span>
        <input
          type="checkbox"
          checked={reversed}
          onChange={(event) => {
            if (event.target.checked !== reversed) {
              toggleClipReverse(clip.id);
            }
          }}
        />
      </label>
    </div>
  );
}

function PortList({ title, ports }: { title: string; ports: NodeGraphPort[] }) {
  return (
    <div className="node-workspace-inspector-section">
      <div className="node-workspace-inspector-section-title">{title}</div>
      {ports.length > 0 ? (
        <div className="node-workspace-inspector-ports">
          {ports.map((port) => (
            <div key={port.id} className="node-workspace-inspector-port">
              <span>{port.label}</span>
              <span>{port.type}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="node-workspace-inspector-empty">None</div>
      )}
    </div>
  );
}

function NodeInspector({
  node,
  clip,
  onOpenProperties,
}: {
  node: NodeGraphNode | null;
  clip: TimelineClip | null;
  onOpenProperties: () => void;
}) {
  const params = Object.entries(node?.params ?? {});
  const canEditTransform = !!clip && node?.id === 'transform';

  if (!node) {
    return (
      <aside className="node-workspace-inspector">
        <div className="node-workspace-inspector-empty">Select a node</div>
      </aside>
    );
  }

  return (
    <aside className="node-workspace-inspector">
      <div className="node-workspace-inspector-header">
        <span>{node.kind}</span>
        <h3>{node.label}</h3>
        <p>{node.description}</p>
      </div>

      <div className="node-workspace-inspector-meta">
        <div>
          <span>Runtime</span>
          <strong>{node.runtime}</strong>
        </div>
        {node.sourceType && (
          <div>
            <span>Source</span>
            <strong>{node.sourceType}</strong>
          </div>
        )}
      </div>

      <PortList title="Inputs" ports={node.inputs} />
      <PortList title="Outputs" ports={node.outputs} />

      <div className="node-workspace-inspector-section">
        <div className="node-workspace-inspector-section-title">Parameters</div>
        {canEditTransform ? (
          <TransformNodeParameters clip={clip} />
        ) : params.length > 0 ? (
          <div className="node-workspace-param-list">
            {params.map(([key, value]) => (
              <div key={key} className="node-workspace-param">
                <span>{key}</span>
                <strong>{formatParamValue(value)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="node-workspace-inspector-empty">None</div>
        )}
      </div>

      <button type="button" className="node-workspace-primary-action" onClick={onOpenProperties}>
        Open Properties
      </button>
    </aside>
  );
}

export function NodeWorkspacePanel() {
  const subject = useNodeGraphSubject();
  const moveClipNodeGraphNode = useTimelineStore((state) => state.moveClipNodeGraphNode);
  const [selection, setSelection] = useState<{ graphId: string | null; nodeId: string | null }>({
    graphId: null,
    nodeId: null,
  });
  const selectedNodeId = selection.graphId === subject?.graph.id
    ? selection.nodeId
    : subject?.graph.nodes[0]?.id ?? null;

  const selectedNode = useMemo(() => {
    if (!subject) return null;
    return subject.graph.nodes.find((node) => node.id === selectedNodeId) ?? subject.graph.nodes[0] ?? null;
  }, [selectedNodeId, subject]);

  const selectNode = useCallback((nodeId: string) => {
    setSelection({
      graphId: subject?.graph.id ?? null,
      nodeId,
    });
  }, [subject?.graph.id]);

  const openProperties = useCallback(() => {
    useDockStore.getState().activatePanelType('clip-properties');
  }, []);

  const moveNode = useCallback((nodeId: string, layout: NodeGraphLayout) => {
    if (!subject || subject.kind !== 'clip') return;
    moveClipNodeGraphNode(subject.id, nodeId, layout);
  }, [moveClipNodeGraphNode, subject]);

  if (!subject) {
    return (
      <div className="node-workspace-panel">
        <div className="node-workspace-empty-state">
          <h3>Nodes</h3>
          <p>Select a timeline clip</p>
        </div>
      </div>
    );
  }

  return (
    <div className="node-workspace-panel">
      <div className="node-workspace-main">
        <NodeGraphCanvas
          graph={subject.graph}
          selectedNodeId={selectedNode?.id ?? null}
          onSelectNode={selectNode}
          onMoveNode={moveNode}
        />
      </div>
      <NodeInspector node={selectedNode} clip={subject.clip} onOpenProperties={openProperties} />
    </div>
  );
}
