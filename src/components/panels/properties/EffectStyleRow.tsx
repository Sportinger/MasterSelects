import { useState } from 'react';
import { changeEffectStyle, effectStyleGroups } from '../../../services/effects/effectStyles';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorRow } from './resolveInspector/ResolveInspectorPrimitives';

/**
 * Switches between looks of one effect engine without re-adding the effect. The menu lists the
 * effect's own picker group first; after a switch the row names what changed beyond the card
 * (a value brought into the new range, a changed control that started at its default, kept
 * keyframes, reset node graph edits).
 */
export function EffectStyleRow({ clipId, effect }: { clipId: string; effect: { id: string; type: string } }) {
  const [message, setMessage] = useState<{ type: string; text: string; error: boolean } | null>(null);
  const groups = effectStyleGroups(effect.type);
  if (groups.reduce((count, group) => count + group.options.length, 0) < 2) return null;
  return <div className="effect-style-row" title="Controls you changed keep their values and keyframes when the new look has the same control; the rest start at the new look's defaults, and node graph edits are reset">
    <ResolveInspectorRow label="Style">
      <InspectorSelect ariaLabel="Effect style" value={effect.type} groups={groups} onChange={type => {
        try { setMessage({ type, text: changeEffectStyle(clipId, effect.id, type).join(' '), error: false }); }
        catch (error) { setMessage({ type: effect.type, text: error instanceof Error ? error.message : String(error), error: true }); }
      }} />
    </ResolveInspectorRow>
    {message?.text && message.type === effect.type && <p role={message.error ? 'alert' : 'status'} className="face-cable-hint">{message.text}</p>}
  </div>;
}
