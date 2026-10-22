// Generic effect parameter rows in the shared Resolve inspector design (AGENTS.md section 9):
// slider + number + reset for numbers, InspectorSelect for choices, a checkbox for switches and
// swatch + hex + reset for colours (ResolveInspectorColorRow). Effects opt in through
// RESOLVE_ROW_EFFECTS (resolveEffectRows.ts) as their inspector is revised.
import { useTimelineStore } from '../../../stores/timeline';
import { createEffectProperty } from '../../../types/animationProperties';
import type { EffectParam } from '../../../effects/types';
import { getParameterSourceTarget } from '../../../services/parameterSources/parameterSourceTargets';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ParameterSourceNumberRow } from './ParameterSourceNumberRow';
import { ResolveInspectorColorRow } from './resolveInspector/ResolveInspectorColorRow';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorRow } from './resolveInspector/ResolveInspectorPrimitives';
import { EffectKeyframeToggle } from './shared';
import { effectParamDisplay } from '../../../effects/paramDisplay';
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

/**
 * One parameter row for the types `hasResolveEffectParamRow` accepts (callers check it first). A
 * parameter that acts only in another parameter's mode is dimmed (still keyframeable), with the
 * reason as a small line under it, so touch users see it too.
 */
export function ResolveEffectParamRow(props: ResolveEffectParamRowProps) {
  const when = props.definition.activeWhen, controller = when ? props.effect.params[when.param] : undefined;
  const inactive = !!when && controller !== undefined && !when.values.includes(controller);
  const row = <ResolveEffectParamControl {...props} inactive={inactive} />;
  return inactive && when ? <>{row}<div className="resolve-effect-row-note">{when.note}</div></> : row;
}

function ResolveEffectParamControl({ paramName, definition, value, effect, clipId, onChange, onDragStart, onDragEnd, onParamCommit, inactive }:
  ResolveEffectParamRowProps & { inactive: boolean }) {
  const property = `effect.${effect.id}.${paramName}`;
  // A parameter that can take a node source gets the source-aware row.
  const sourceTarget = useTimelineStore(state => {
    const clip = clipId && definition.type === 'number' ? state.clips.find(item => item.id === clipId) : undefined;
    return !!clip && !!getParameterSourceTarget(clip, property);
  });
  const set = (next: Value) => onChange({ ...effect.params, [paramName]: next });
  const title = inactive ? definition.activeWhen?.note : undefined;
  if (definition.type === 'select') return <ResolveInspectorRow label={definition.label} disabled={inactive} title={title}>
    <InspectorSelect ariaLabel={definition.label} value={String(value)} options={definition.options ?? []}
      onChange={next => { set(next); onParamCommit?.(paramName, 'select', 'select'); }} />
  </ResolveInspectorRow>;
  // Pointer focus on the checkbox is cleared by the Effects tab; the colour swatch blurs itself after a pointer pick.
  if (definition.type === 'boolean') return <ResolveInspectorRow label={definition.label} disabled={inactive} title={title}>
    <input type="checkbox" className="resolve-effect-checkbox" aria-label={definition.label} checked={value === true}
      onChange={event => { set(event.target.checked); onParamCommit?.(paramName, 'checkbox', 'click'); }} />
  </ResolveInspectorRow>;
  if (definition.type === 'color') return <ResolveInspectorColorRow label={definition.label} value={String(value)}
    defaultValue={String(definition.default)} disabled={inactive} title={title} onChange={set}
    onCommit={method => onParamCommit?.(paramName, 'select', method === 'type' ? 'type' : method)} />;
  if (definition.type !== 'number') return null;
  const min = definition.min ?? 0, max = definition.max ?? 1, number = typeof value === 'number' ? value : Number(definition.default);
  // Shown in display units (radians as whole degrees, turns as degrees, " EV"); the stored unit
  // stays (keyframes, tools, MIDI). Typing may go beyond the slider up to the rendered range.
  const display = effectParamDisplay(definition, number), scale = display.scale, shown = (stored: number) => stored * scale;
  const unitRow = definition.displayUnit !== undefined || definition.displayScale !== undefined || definition.unit !== undefined;
  if (sourceTarget && clipId) return <ParameterSourceNumberRow clipId={clipId} property={property} display={unitRow ? display : undefined} />;
  return <ResolveInspectorNumberRow label={definition.label} value={shown(number)} defaultValue={shown(Number(definition.default))}
    min={shown(min)} max={shown(max)} step={display.step ?? shown(definition.step ?? 0.01)} sensitivity={Math.max(0.5, shown(max - min) / 100)}
    numberMin={definition.wraps ? -Infinity : shown(definition.renderMin ?? min)} numberMax={definition.wraps ? Infinity : shown(definition.renderMax ?? max)} suffix={display.suffix}
    decimals={display.decimals} disabled={inactive} title={title}
    persistenceKey={`effect.${clipId ?? 'global'}.${effect.id}.${paramName}`}
    midiTarget={clipId ? { clipId, property: createEffectProperty(effect.id, paramName), label: definition.label, currentValue: number, min, max } : null}
    onChange={next => set(next / scale)} onDragStart={onDragStart} onDragEnd={onDragEnd} onCommit={method => onParamCommit?.(paramName, 'number', method)}
    keyframeToggle={definition.animatable && clipId
      ? <EffectKeyframeToggle clipId={clipId} effectId={effect.id} paramName={paramName} value={number} /> : undefined} />;
}
