import { useCallback, useMemo, useState } from 'react';
import type { NodeGraphLayout, NodeGraphNode, NodeGraphPort } from '../../../services/nodeGraph';
import { EFFECT_REGISTRY, getCategoriesWithEffects } from '../../../effects';
import type { EffectParam } from '../../../effects';
import { useDockStore } from '../../../stores/dockStore';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { useTimelineStore } from '../../../stores/timeline';
import { createEffectProperty } from '../../../types';
import type { AnimatableProperty, BlendMode, Effect, TimelineClip } from '../../../types';
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
  persistenceKey?: string;
  onContextMenu?: () => void;
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
  persistenceKey,
  onContextMenu,
}: NumericParamEditorProps) {
  return (
    <div
      className="node-workspace-param node-workspace-param-editable"
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onContextMenu();
      }}
    >
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
        persistenceKey={persistenceKey}
        onDragStart={() => startBatch('Adjust node parameter')}
        onDragEnd={() => endBatch()}
      />
    </div>
  );
}

function EffectParamEditor({
  clip,
  effect,
  paramName,
  paramDef,
  value,
}: {
  clip: TimelineClip;
  effect: Effect;
  paramName: string;
  paramDef: EffectParam;
  value: number | boolean | string;
}) {
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const updateClipEffect = useTimelineStore((state) => state.updateClipEffect);

  if (paramDef.type === 'number') {
    const min = paramDef.min ?? 0;
    const max = paramDef.max ?? 1;
    const range = max - min;
    const decimals = paramDef.step && paramDef.step >= 1 ? 0 : paramDef.step && paramDef.step >= 0.1 ? 1 : 2;
    const numericValue = typeof value === 'number' ? value : Number(paramDef.default);
    const defaultValue = typeof paramDef.default === 'number' ? paramDef.default : 0;

    return (
      <NumericParamEditor
        label={paramDef.label}
        value={numericValue}
        onChange={(nextValue) => {
          setPropertyValue(clip.id, createEffectProperty(effect.id, paramName) as AnimatableProperty, Math.max(min, nextValue));
        }}
        onContextMenu={() => setPropertyValue(clip.id, createEffectProperty(effect.id, paramName) as AnimatableProperty, defaultValue)}
        defaultValue={defaultValue}
        decimals={decimals}
        min={min}
        max={paramDef.quality ? undefined : max}
        sensitivity={Math.max(0.5, range / 100)}
        persistenceKey={`node.effect.${clip.id}.${effect.id}.${paramName}`}
      />
    );
  }

  if (paramDef.type === 'boolean') {
    const checked = typeof value === 'boolean' ? value : Boolean(paramDef.default);
    return (
      <label className="node-workspace-param node-workspace-param-editable node-workspace-param-checkbox">
        <span>{paramDef.label}</span>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => updateClipEffect(clip.id, effect.id, { [paramName]: event.target.checked })}
        />
      </label>
    );
  }

  if (paramDef.type === 'select') {
    return (
      <label className="node-workspace-param node-workspace-param-editable">
        <span>{paramDef.label}</span>
        <select
          value={String(value ?? paramDef.default)}
          onChange={(event) => updateClipEffect(clip.id, effect.id, { [paramName]: event.target.value })}
        >
          {paramDef.options?.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="node-workspace-param">
      <span>{paramDef.label}</span>
      <strong>{formatParamValue(value)}</strong>
    </div>
  );
}

function EffectNodeParameters({ clip, node }: { clip: TimelineClip; node: NodeGraphNode }) {
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const getInterpolatedEffects = useTimelineStore((state) => state.getInterpolatedEffects);
  const setClipEffectEnabled = useTimelineStore((state) => state.setClipEffectEnabled);
  const effectId = node.id.startsWith('effect-') ? node.id.slice('effect-'.length) : '';
  const effect = clip.effects.find((candidate) => candidate.id === effectId);

  if (!effect) {
    return <div className="node-workspace-inspector-empty">Effect not found</div>;
  }

  const clipLocalTime = playheadPosition - clip.startTime;
  const interpolatedEffect = getInterpolatedEffects(clip.id, clipLocalTime).find((candidate) => candidate.id === effect.id) ?? effect;
  const effectDef = EFFECT_REGISTRY.get(effect.type);
  const params = Object.entries(effectDef?.params ?? {});

  return (
    <div className="node-workspace-param-list">
      <label className="node-workspace-param node-workspace-param-editable node-workspace-param-checkbox">
        <span>Enabled</span>
        <input
          type="checkbox"
          checked={effect.enabled !== false}
          onChange={(event) => setClipEffectEnabled(clip.id, effect.id, event.target.checked)}
        />
      </label>
      {effectDef ? (
        params.length > 0 ? (
          params.map(([paramName, paramDef]) => (
            <EffectParamEditor
              key={paramName}
              clip={clip}
              effect={effect}
              paramName={paramName}
              paramDef={paramDef}
              value={interpolatedEffect.params[paramName] ?? paramDef.default}
            />
          ))
        ) : (
          <div className="node-workspace-inspector-empty">No parameters</div>
        )
      ) : (
        <div className="node-workspace-inspector-empty">Unknown effect type: {effect.type}</div>
      )}
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
  onSelectNode,
  onOpenProperties,
}: {
  node: NodeGraphNode | null;
  clip: TimelineClip | null;
  onSelectNode: (nodeId: string) => void;
  onOpenProperties: () => void;
}) {
  const params = Object.entries(node?.params ?? {});
  const canEditTransform = !!clip && node?.id === 'transform';
  const canEditEffect = !!clip && node?.id.startsWith('effect-');
  const canEditCustom = !!clip && node?.kind === 'custom';

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
        ) : canEditEffect ? (
          <EffectNodeParameters clip={clip} node={node} />
        ) : canEditCustom ? (
          <CustomNodeParameters clip={clip} node={node} />
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

      {clip && <ClipNodeActions clip={clip} onSelectNode={onSelectNode} />}

      <button type="button" className="node-workspace-primary-action" onClick={onOpenProperties}>
        Open Properties
      </button>
    </aside>
  );
}

function CustomNodeParameters({ clip, node }: { clip: TimelineClip; node: NodeGraphNode }) {
  const updateClipAICustomNode = useTimelineStore((state) => state.updateClipAICustomNode);
  const definition = clip.nodeGraph?.customNodes?.find((candidate) => candidate.id === node.id);

  if (!definition) {
    return <div className="node-workspace-inspector-empty">Custom node not found</div>;
  }

  return (
    <div className="node-workspace-param-list">
      <label className="node-workspace-field">
        <span>Name</span>
        <input
          value={definition.label}
          onChange={(event) => updateClipAICustomNode(clip.id, definition.id, { label: event.target.value })}
        />
      </label>
      <label className="node-workspace-field">
        <span>Description</span>
        <input
          value={definition.description ?? ''}
          onChange={(event) => updateClipAICustomNode(clip.id, definition.id, { description: event.target.value })}
        />
      </label>
      <label className="node-workspace-field">
        <span>Status</span>
        <select
          value={definition.status}
          onChange={(event) => updateClipAICustomNode(clip.id, definition.id, {
            status: event.target.value === 'ready' ? 'ready' : 'draft',
          })}
        >
          <option value="draft">Draft</option>
          <option value="ready">Ready</option>
        </select>
      </label>
      <label className="node-workspace-field">
        <span>Prompt</span>
        <textarea
          value={definition.ai.prompt}
          rows={5}
          onChange={(event) => updateClipAICustomNode(clip.id, definition.id, {
            ai: { prompt: event.target.value },
          })}
        />
      </label>
      <label className="node-workspace-field">
        <span>Generated Code</span>
        <textarea
          value={definition.ai.generatedCode ?? ''}
          rows={7}
          spellCheck={false}
          onChange={(event) => updateClipAICustomNode(clip.id, definition.id, {
            ai: { generatedCode: event.target.value },
          })}
        />
      </label>
    </div>
  );
}

function ClipNodeActions({ clip, onSelectNode }: { clip: TimelineClip; onSelectNode: (nodeId: string) => void }) {
  const addClipEffect = useTimelineStore((state) => state.addClipEffect);
  const addClipAICustomNode = useTimelineStore((state) => state.addClipAICustomNode);
  const effectCategories = useMemo(() => getCategoriesWithEffects(), []);

  return (
    <div className="node-workspace-inspector-section">
      <div className="node-workspace-inspector-section-title">Add Node</div>
      <button
        type="button"
        className="node-workspace-secondary-action"
        onClick={() => {
          startBatch('Add AI node');
          try {
            const nodeId = addClipAICustomNode(clip.id);
            if (nodeId) onSelectNode(nodeId);
          } finally {
            endBatch();
          }
        }}
      >
        AI Node
      </button>
      <select
        className="node-workspace-add-node-select"
        defaultValue=""
        onChange={(event) => {
          const effectType = event.target.value;
          if (!effectType) return;
          startBatch('Add effect node');
          try {
            addClipEffect(clip.id, effectType);
          } finally {
            endBatch();
          }
          event.target.value = '';
        }}
      >
        <option value="" disabled>Effect...</option>
        {effectCategories.map(({ category, effects }) => (
          <optgroup key={category} label={category.charAt(0).toUpperCase() + category.slice(1)}>
            {effects.map((effect) => (
              <option key={effect.id} value={effect.id}>{effect.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
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
      <NodeInspector
        node={selectedNode}
        clip={subject.clip}
        onSelectNode={selectNode}
        onOpenProperties={openProperties}
      />
    </div>
  );
}
