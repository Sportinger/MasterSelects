// Generic effect parameter rows in the shared Resolve inspector design (AGENTS.md section 9):
// slider + number + reset for numbers, InspectorSelect for choices. Effects opt in through
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

/** Few enough decimals that a value with its unit (" EV", "°") fits the field. */
const decimalsFor = (step: number) => step >= 1 ? 0 : step >= 0.1 ? 1 : 2;

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
  if (definition.type !== 'number') return null;
  if (sourceTarget && clipId) return <ParameterSourceNumberRow clipId={clipId} property={property} />;
  const min = definition.min ?? 0, max = definition.max ?? 1, number = typeof value === 'number' ? value : Number(definition.default);
  // Shown in display units (e.g. degrees for turns); typing may go beyond the slider up to the rendered range.
  const scale = definition.displayScale ?? 1, shown = (stored: number) => stored * scale;
  return <ResolveInspectorNumberRow label={definition.label} value={shown(number)} defaultValue={shown(Number(definition.default))}
    min={shown(min)} max={shown(max)} step={shown(definition.step ?? 0.01)} sensitivity={Math.max(0.5, shown(max - min) / 100)}
    numberMin={shown(definition.renderMin ?? min)} numberMax={shown(definition.renderMax ?? max)} suffix={definition.unit}
    decimals={definition.unit ? decimalsFor(shown(definition.step ?? 0.01)) : undefined}
    persistenceKey={`effect.${clipId ?? 'global'}.${effect.id}.${paramName}`}
    midiTarget={clipId ? { clipId, property: createEffectProperty(effect.id, paramName), label: definition.label, currentValue: number, min, max } : null}
    onChange={next => set(next / scale)} onDragStart={onDragStart} onDragEnd={onDragEnd} onCommit={method => onParamCommit?.(paramName, 'number', method)}
    keyframeToggle={definition.animatable && clipId
      ? <EffectKeyframeToggle clipId={clipId} effectId={effect.id} paramName={paramName} value={number} /> : undefined} />;
}
