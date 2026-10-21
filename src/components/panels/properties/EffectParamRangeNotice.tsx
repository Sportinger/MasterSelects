import { getEffect } from '../../../effects';
import { paramRangeNotes } from '../../../effects/paramRangeNotes';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';

/** Shown while a value at the playhead (keyframe overshoot, tool call, node driver) is clamped for rendering. */
export function EffectParamRangeNotice({ effectType, params, graph }: { effectType: string; params: Record<string, unknown>;
  graph?: EffectOperatorGraph }) {
  const definitions = getEffect(effectType)?.params;
  // In the units the rows show (Horizon in %, Line Width as the full px width).
  const notes = definitions ? paramRangeNotes(definitions, params, graph, { display: true }) : [];
  if (!notes.length) return null;
  return <div className="effect-quality-warning effect-param-range-notice" role="status">
    {notes.map(note => <div key={note.param}>{note.message}</div>)}
  </div>;
}
