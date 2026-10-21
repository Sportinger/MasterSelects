// Generic effect parameter rows in the shared Resolve inspector design (AGENTS.md section 9):
// slider + number + reset for numbers, InspectorSelect for choices, a checkbox for switches and a
// colour well for colours. Effects opt in through
// RESOLVE_ROW_EFFECTS (resolveEffectRows.ts) as their inspector is revised.
import { useTimelineStore } from '../../../stores/timeline';
import { createEffectProperty } from '../../../types/animationProperties';
import type { EffectParam } from '../../../effects/types';
import { getParameterSourceTarget } from '../../../services/parameterSources/parameterSourceTargets';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { OperatorColorInput } from '../nodes/workspace/OperatorColorInput';
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
  // Pointer focus on the checkbox is cleared by the Effects tab; the colour well blurs itself after a pointer pick.
  if (definition.type === 'boolean') return <ResolveInspectorRow label={definition.label}>
    <input type="checkbox" className="resolve-effect-checkbox" aria-label={definition.label} checked={value === true}
      onChange={event => { set(event.target.checked); onParamCommit?.(paramName, 'checkbox', 'click'); }} />
  </ResolveInspectorRow>;
  if (definition.type === 'color') return <ResolveInspectorRow label={definition.label}>
    <span className="resolve-effect-color">
      <OperatorColorInput ariaLabel={definition.label} value={String(value)} onChange={next => { set(next); onParamCommit?.(paramName, 'select', 'select'); }} />
    </span>
  </ResolveInspectorRow>;
  if (definition.type !== 'number') return null;
  // Radians stay the stored unit (keyframes, tools, MIDI); the rows read and edit whole degrees.
  const scale = definition.displayUnit === 'degrees' ? 180 / Math.PI : 1, degrees = scale !== 1;
  if (sourceTarget && clipId) return <ParameterSourceNumberRow clipId={clipId} property={property}
    display={degrees ? { scale, suffix: '°', decimals: 0, step: 1 } : undefined} />;
  const min = definition.min ?? 0, max = definition.max ?? 1, number = typeof value === 'number' ? value : Number(definition.default);
  return <ResolveInspectorNumberRow label={definition.label} value={number * scale} defaultValue={Number(definition.default) * scale}
    min={min * scale} max={max * scale} step={degrees ? 1 : definition.step ?? 0.01} sensitivity={Math.max(0.5, (max - min) * scale / 100)}
    suffix={degrees ? '°' : undefined} decimals={degrees ? 0 : undefined}
    persistenceKey={`effect.${clipId ?? 'global'}.${effect.id}.${paramName}`}
    midiTarget={clipId ? { clipId, property: createEffectProperty(effect.id, paramName), label: definition.label, currentValue: number, min, max } : null}
    onChange={next => set(next / scale)} onDragStart={onDragStart} onDragEnd={onDragEnd} onCommit={method => onParamCommit?.(paramName, 'number', method)}
    keyframeToggle={definition.animatable && clipId
      ? <EffectKeyframeToggle clipId={clipId} effectId={effect.id} paramName={paramName} value={number} /> : undefined} />;
}
