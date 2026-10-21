// Generic effect parameter rows in the shared Resolve inspector design (AGENTS.md section 9):
// slider + number + reset for numbers, InspectorSelect for choices, a checkbox for switches and the
// native colour input for colours. Effects opt in through
// RESOLVE_ROW_EFFECTS (resolveEffectRows.ts) as their inspector is revised.
import { useTimelineStore } from '../../../stores/timeline';
import { createEffectProperty } from '../../../types/animationProperties';
import type { EffectParam } from '../../../effects/types';
import { getParameterSourceTarget } from '../../../services/parameterSources/parameterSourceTargets';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ParameterSourceNumberRow } from './ParameterSourceNumberRow';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorRow } from './resolveInspector/ResolveInspectorPrimitives';
import { EffectKeyframeToggle } from './shared';
import './effectResolveRows.css';

type Value = number | boolean | string;
interface ResolveEffectParamRowProps {
  paramName: string;
  definition: EffectParam;
  value: Value;
  effect: { id: string; params: Record<string, Value> };
  clipId?: string;
  onChange: (params: Record<string, Value>) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onParamCommit?: (paramName: string, controlKind: 'checkbox' | 'number' | 'select',
    inputMethod: 'click' | 'drag' | 'keyboard' | 'reset' | 'select' | 'type') => void;
}

/** `#rrggbb` for the native colour input (stored colours may carry alpha or be missing). */
const pickerColor = (value: Value, fallback: EffectParam['default']) => {
  const color = typeof value === 'string' ? value : String(fallback);
  return /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7) : '#ffffff';
};

/** One parameter row for the types `hasResolveEffectParamRow` accepts (callers check it first). */
export function ResolveEffectParamRow({ paramName, definition, value, effect, clipId, onChange, onDragStart, onDragEnd, onParamCommit }: ResolveEffectParamRowProps) {
  const property = `effect.${effect.id}.${paramName}`;
  // A parameter that can take a node source gets the source-aware row.
  const sourceTarget = useTimelineStore(state => {
    const clip = clipId && definition.type === 'number' ? state.clips.find(item => item.id === clipId) : undefined;
    return !!clip && !!getParameterSourceTarget(clip, property);
  });
  const set = (next: Value) => onChange({ ...effect.params, [paramName]: next });
  if (definition.type === 'select') return <ResolveInspectorRow label={definition.label}>
    <InspectorSelect ariaLabel={definition.label} value={String(value)} options={definition.options ?? []}
      onChange={next => { set(next); onParamCommit?.(paramName, 'select', 'select'); }} />
  </ResolveInspectorRow>;
  if (definition.type === 'boolean') return <ResolveInspectorRow label={definition.label}>
    <input type="checkbox" aria-label={definition.label} checked={value === true}
      onChange={event => { set(event.target.checked); onParamCommit?.(paramName, 'checkbox', 'click'); }} />
  </ResolveInspectorRow>;
  // Picking in the native colour dialog sends many changes: one undo step from focus to blur.
  if (definition.type === 'color') return <ResolveInspectorRow label={definition.label}>
    <input type="color" aria-label={definition.label} value={pickerColor(value, definition.default)} onFocus={onDragStart}
      onChange={event => set(event.target.value)} onBlur={() => { onDragEnd?.(); onParamCommit?.(paramName, 'select', 'select'); }} />
  </ResolveInspectorRow>;
  if (definition.type !== 'number') return null;
  if (sourceTarget && clipId) return <ParameterSourceNumberRow clipId={clipId} property={property} />;
  const min = definition.min ?? 0, max = definition.max ?? 1, number = typeof value === 'number' ? value : Number(definition.default);
  return <ResolveInspectorNumberRow label={definition.label} value={number} defaultValue={Number(definition.default)}
    min={min} max={max} step={definition.step ?? 0.01} sensitivity={Math.max(0.5, (max - min) / 100)}
    persistenceKey={`effect.${clipId ?? 'global'}.${effect.id}.${paramName}`}
    midiTarget={clipId ? { clipId, property: createEffectProperty(effect.id, paramName), label: definition.label, currentValue: number, min, max } : null}
    onChange={set} onDragStart={onDragStart} onDragEnd={onDragEnd} onCommit={method => onParamCommit?.(paramName, 'number', method)}
    keyframeToggle={definition.animatable && clipId
      ? <EffectKeyframeToggle clipId={clipId} effectId={effect.id} paramName={paramName} value={number} /> : undefined} />;
}
