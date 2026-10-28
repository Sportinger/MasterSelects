// Generic effect parameter rows in the shared Resolve inspector design (AGENTS.md section 9):
// slider + number + reset for numbers, InspectorSelect for choices, a checkbox + reset for switches,
// swatch + hex + reset for colours (ResolveInspectorColorRow) and a text field + reset for typed text. Effects opt in through
// RESOLVE_ROW_EFFECTS (resolveEffectRows.ts) as their inspector is revised.
import { useMemo } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { createEffectProperty } from '../../../types/animationProperties';
import type { EffectParam } from '../../../effects/types';
import { getParameterSourceTarget, type ParameterSourceClip } from '../../../services/parameterSources/parameterSourceTargets';
import type { TimelineClip } from '../../../types/timeline';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ParameterSourceNumberRow } from './ParameterSourceNumberRow';
import { ResolveInspectorColorRow } from './resolveInspector/ResolveInspectorColorRow';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { ResolveWrappingNumberRow } from './ResolveWrappingNumberRow';
import { ResolveInspectorIconButton, ResolveInspectorRow, ResolveResetIcon } from './resolveInspector/ResolveInspectorPrimitives';
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
  /** The inactive note is already shown once above the row (a folded section of inactive rows). */
  noteShown?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onParamCommit?: (paramName: string, controlKind: 'checkbox' | 'number' | 'select',
    inputMethod: 'click' | 'drag' | 'keyboard' | 'reset' | 'select' | 'type') => void;
}

type StoredEffect = TimelineClip['effects'][number];
// One wrapper per stored effect version, shared by all its rows: parameterSourceTargets caches per
// wrapper object, so an operator-graph effect lists (compiles) its targets once per change, not per row.
const singleEffectSourceClips = new WeakMap<StoredEffect, ParameterSourceClip>();
function singleEffectSourceClip(effect: StoredEffect): ParameterSourceClip {
  let clip = singleEffectSourceClips.get(effect);
  if (!clip) {
    clip = { effects: [effect], colorCorrection: undefined, nodeGraph: undefined, startTime: 0 };
    singleEffectSourceClips.set(effect, clip);
  }
  return clip;
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
  return inactive && when && !props.noteShown ? <>{row}<div className="resolve-effect-row-note">{when.note}</div></> : row;
}

function ResolveEffectParamControl({ paramName, definition, value, effect, clipId, onChange, onDragStart, onDragEnd, onParamCommit, inactive }:
  ResolveEffectParamRowProps & { inactive: boolean }) {
  const property = `effect.${effect.id}.${paramName}`;
  // A parameter that can take a node source gets the source-aware row. Its effect.* targets come only
  // from this effect, so select just this row's stored effect: editing another effect or the transform
  // neither re-renders this row nor re-lists every effect's source targets on each store change.
  const storedEffect = useTimelineStore(state => (clipId && definition.type === 'number'
    ? state.clips.find(item => item.id === clipId)?.effects.find(item => item.id === effect.id)
    : undefined));
  const sourceTarget = useMemo(
    () => !!storedEffect && !!getParameterSourceTarget(singleEffectSourceClip(storedEffect), property),
    [property, storedEffect],
  );
  const set = (next: Value) => onChange({ ...effect.params, [paramName]: next });
  const title = inactive ? definition.activeWhen?.note : undefined;
  if (definition.type === 'select') return <ResolveInspectorRow label={definition.label} disabled={inactive} title={title}>
    <InspectorSelect ariaLabel={definition.label} value={String(value)} options={definition.options ?? []}
      onChange={next => { set(next); onParamCommit?.(paramName, 'select', 'select'); }} />
  </ResolveInspectorRow>;
  // Pointer focus on the checkbox is cleared by the Effects tab; the colour swatch and the reset buttons blur themselves after a pointer click.
  if (definition.type === 'boolean') return <ResolveInspectorRow label={definition.label} disabled={inactive} title={title}
    actions={<ResolveInspectorIconButton ariaLabel={`Reset ${definition.label}`} className="resolve-inspector-reset-button" disabled={inactive}
      onClick={event => { if (event.detail > 0) event.currentTarget.blur(); set(definition.default === true); onParamCommit?.(paramName, 'checkbox', 'reset'); }}>
      <ResolveResetIcon /></ResolveInspectorIconButton>}>
    <input type="checkbox" className="resolve-effect-checkbox" aria-label={definition.label} checked={value === true}
      onChange={event => { set(event.target.checked); onParamCommit?.(paramName, 'checkbox', 'click'); }} />
  </ResolveInspectorRow>;
  if (definition.type === 'color') return <ResolveInspectorColorRow label={definition.label} value={String(value)}
    defaultValue={String(definition.default)} disabled={inactive} title={title} onChange={set}
    onCommit={method => onParamCommit?.(paramName, 'select', method === 'type' ? 'type' : method)} />;
  // Typed text (a ramp of characters, a word): one undo step per edit, from focus to blur.
  if (definition.type === 'text') return <ResolveInspectorRow label={definition.label} disabled={inactive} title={title}
    actions={<ResolveInspectorIconButton ariaLabel={`Reset ${definition.label}`} className="resolve-inspector-reset-button"
      onClick={() => { set(String(definition.default)); onParamCommit?.(paramName, 'number', 'reset'); }}><ResolveResetIcon /></ResolveInspectorIconButton>}>
    <input type="text" className="resolve-inspector-text-input" aria-label={definition.label} value={String(value)}
      onFocus={onDragStart} onChange={event => set(event.target.value)}
      onBlur={() => { onDragEnd?.(); onParamCommit?.(paramName, 'number', 'type'); }} />
  </ResolveInspectorRow>;
  if (definition.type !== 'number') return null;
  const min = definition.min ?? 0, max = definition.max ?? 1, number = typeof value === 'number' ? value : Number(definition.default);
  // Shown in display units (radians as whole degrees, turns as degrees, " EV"); the stored unit
  // stays (keyframes, tools, MIDI). Typing may go beyond the slider up to the rendered range.
  const display = effectParamDisplay(definition, number), scale = display.scale, shown = (stored: number) => stored * scale;
  const unitRow = definition.displayUnit !== undefined || definition.displayScale !== undefined || definition.unit !== undefined;
  if (sourceTarget && clipId) return <ParameterSourceNumberRow clipId={clipId} property={property} display={unitRow ? display : undefined} />;
  const shared = { label: definition.label, value: shown(number), defaultValue: shown(Number(definition.default)),
    min: shown(min), max: shown(max), step: display.step ?? shown(definition.step ?? 0.01), sensitivity: Math.max(0.5, shown(max - min) / 100),
    suffix: display.suffix, decimals: display.decimals, disabled: inactive, title,
    persistenceKey: `effect.${clipId ?? 'global'}.${effect.id}.${paramName}`,
    midiTarget: clipId ? { clipId, property: createEffectProperty(effect.id, paramName), label: definition.label, currentValue: number, min, max } : null,
    onChange: (next: number) => set(next / scale), onDragStart, onDragEnd,
    onCommit: (method: Parameters<NonNullable<ResolveEffectParamRowProps['onParamCommit']>>[2]) => onParamCommit?.(paramName, 'number', method),
    keyframeToggle: definition.animatable && clipId
      ? <EffectKeyframeToggle clipId={clipId} effectId={effect.id} paramName={paramName} value={number} /> : undefined };
  // A cyclic value (Hue Shift) puts its handle at its place on one turn and types without a limit.
  if (definition.wraps) return <ResolveWrappingNumberRow {...shared} />;
  return <ResolveInspectorNumberRow {...shared}
    numberMin={shown(definition.renderMin ?? min)} numberMax={shown(definition.renderMax ?? max)} />;
}
