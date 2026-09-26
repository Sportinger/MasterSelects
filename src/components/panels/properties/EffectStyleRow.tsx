import { useState } from 'react';
import type { Effect } from '../../../types/effects';
import { changeEffectStyle, effectStyleOptions } from '../../../services/effects/effectStyles';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorRow } from './resolveInspector/ResolveInspectorPrimitives';

/** Switches between looks of one effect engine without re-adding the effect. */
export function EffectStyleRow({ clipId, effect }: { clipId: string; effect: { id: string; type: string; operatorGraph?: Effect['operatorGraph'] } }) {
  const [message, setMessage] = useState('');
  const options = effectStyleOptions(effect.type);
  if (options.length < 2) return null;
  return <div className="effect-style-row" title={effect.operatorGraph ? 'Switching the style resets edits to this effect\'s node graph' : 'Same controls and keyframes, different look'}>
    <ResolveInspectorRow label="Style">
      <InspectorSelect ariaLabel="Effect style" value={effect.type} options={options} onChange={type => {
        try { changeEffectStyle(clipId, effect.id, type); setMessage(''); }
        catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
      }} />
    </ResolveInspectorRow>
    {message && <p role="alert" className="face-cable-hint">{message}</p>}
  </div>;
}
