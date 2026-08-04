import { useCallback } from 'react';
import { EFFECT_REGISTRY } from '../../../../effects';
import type { EffectParam } from '../../../../effects';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import { useTimelineStore } from '../../../../stores/timeline';
import type { Effect, TimelineClip } from '../../../../stores/timeline/types';
import type { NodeGraphNode } from '../../../../services/nodeGraph';
import { EditableDraggableNumber as DraggableNumber } from '../../../common/EditableDraggableNumber';
import { BLEND_MODE_GROUPS, formatBlendModeName } from '../../properties/sharedConstants';
import {
  createEffectPropertyKey,
  formatParamValue,
} from './nodeWorkspaceUtils';
import {
  CLIP_SPEED_MAX_PERCENT,
  CLIP_SPEED_MIN_PERCENT,
} from '../../../../stores/timeline/helpers/linkedClipSpeed';

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

function coerceEffectEditorValue(value: unknown, fallback: number | boolean | string): number | boolean | string {
  return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string'
    ? value
    : fallback;
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
    const property = createEffectPropertyKey(effect.id, paramName);

    return (
      <NumericParamEditor
        label={paramDef.label}
        value={numericValue}
        onChange={(nextValue) => {
          setPropertyValue(clip.id, property, Math.max(min, nextValue));
        }}
        onContextMenu={() => setPropertyValue(clip.id, property, defaultValue)}
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

export function EffectNodeParameters({ clip, node }: { clip: TimelineClip; node: NodeGraphNode }) {
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
              value={coerceEffectEditorValue(interpolatedEffect.params[paramName], paramDef.default)}
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

export function TransformNodeParameters({ clip }: { clip: TimelineClip }) {
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const updateClipTransform = useTimelineStore((state) => state.updateClipTransform);
  const toggleClipReverse = useTimelineStore((state) => state.toggleClipReverse);

  const setTransformProperty = useCallback((property: Parameters<typeof setPropertyValue>[1], value: number) => {
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
          onChange={(event) => updateClipTransform(clip.id, { blendMode: event.target.value as TimelineClip['transform']['blendMode'] })}
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
