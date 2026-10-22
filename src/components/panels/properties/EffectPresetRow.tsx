import { useState } from 'react';
import type { EffectParamOwner } from '../../../services/operators/effectParamVisibility';
import { applyEffectPreset, effectPresetNotice, effectPresets, matchingEffectPreset } from '../../../services/effects/effectPresets';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorRow } from './resolveInspector/ResolveInspectorPrimitives';

const NONE = '';

type Notice = { text: string; alert: boolean; upgrade?: string };

/**
 * "Preset" row of an effect card: picks one of the effect's named starting points (EffectPreset) and
 * applies it in one undo step. It names the preset the values match; controls with keyframes or a
 * driving node keep their animation, and the row says which. A preset that changed nothing, or named
 * controls the effect's saved node graph lacks, says so; when the effect's current graph has them, the
 * note offers "Use current graph", which swaps that graph in and applies the preset (Undo takes both back).
 */
export function EffectPresetRow({ clipId, effect }: { clipId: string; effect: EffectParamOwner & { id: string } }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const presets = effectPresets(effect.type);
  if (!presets.length) return null;
  const current = matchingEffectPreset(effect)?.id ?? NONE;
  const options = [{ value: NONE, label: 'Apply preset…', disabled: true }, ...presets.map(preset => ({ value: preset.id, label: preset.name }))];
  const apply = (presetId: string, currentGraph = false) => {
    try {
      const result = applyEffectPreset(clipId, effect.id, presetId, { currentGraph });
      const text = effectPresetNotice(result);
      setNotice(text ? { text, alert: false, ...result.upgradable ? { upgrade: presetId } : {} } : null);
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : String(error), alert: true }); }
  };
  return <div className="effect-preset-row">
    <ResolveInspectorRow label="Preset">
      <InspectorSelect ariaLabel="Effect preset" value={current} options={options} onChange={presetId => apply(presetId)} />
    </ResolveInspectorRow>
    {notice && <p role={notice.alert ? 'alert' : 'status'} className="effect-preset-notice">
      {notice.text}
      {notice.upgrade && <> <button type="button" className="effect-preset-upgrade"
        title="Replaces the saved node graph with this effect's current one and applies the preset; Undo brings the old graph back."
        onClick={event => { if (event.detail > 0) event.currentTarget.blur(); apply(notice.upgrade!, true); }}>Use current graph</button></>}
    </p>}
  </div>;
}
