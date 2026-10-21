import { useState } from 'react';
import type { EffectParamOwner } from '../../../services/operators/effectParamVisibility';
import { applyEffectPreset, effectPresetNotice, effectPresets, matchingEffectPreset } from '../../../services/effects/effectPresets';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorRow } from './resolveInspector/ResolveInspectorPrimitives';

const NONE = '';

/**
 * "Preset" row of an effect card: picks one of the effect's named starting points (EffectPreset) and
 * applies it in one undo step. It names the preset the values match; controls with keyframes or a
 * driving node keep their animation, and the row says which.
 */
export function EffectPresetRow({ clipId, effect }: { clipId: string; effect: EffectParamOwner & { id: string } }) {
  const [notice, setNotice] = useState<{ text: string; alert: boolean } | null>(null);
  const presets = effectPresets(effect.type);
  if (!presets.length) return null;
  const current = matchingEffectPreset(effect)?.id ?? NONE;
  const options = [{ value: NONE, label: 'Apply preset…', disabled: true }, ...presets.map(preset => ({ value: preset.id, label: preset.name }))];
  return <div className="effect-preset-row">
    <ResolveInspectorRow label="Preset">
      <InspectorSelect ariaLabel="Effect preset" value={current} options={options} onChange={presetId => {
        try {
          const text = effectPresetNotice(applyEffectPreset(clipId, effect.id, presetId));
          setNotice(text ? { text, alert: false } : null);
        } catch (error) { setNotice({ text: error instanceof Error ? error.message : String(error), alert: true }); }
      }} />
    </ResolveInspectorRow>
    {notice && <p role={notice.alert ? 'alert' : 'status'} className="effect-preset-notice">{notice.text}</p>}
  </div>;
}
