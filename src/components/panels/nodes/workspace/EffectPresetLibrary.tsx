import { useEffect, useState } from 'react';
import type { Effect } from '../../../../types/effects';
import { useTimelineStore } from '../../../../stores/timeline';
import { readTimelineRuntimeState } from '../../../../services/timeline/timelineRuntimeCoordinator';
import { listEffectPresets, saveEffectPreset, removeEffectPreset, type EffectPreset } from '../../../../services/nodeGraph/effectPresetLibrary';
import { applyEffectPreset } from '../../../../services/nodeGraph/applyEffectPreset';
import { ResolveInspectorSection } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import './EffectPresetLibrary.css';

export function EffectPresetLibrary({ clipId, effect, width, locked, onSelectNode }: {
  clipId: string; effect?: Effect; width: number; locked: boolean; onSelectNode: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [presets, setPresets] = useState<EffectPreset[]>([]);
  useEffect(() => {
    const refresh = () => {
      try { setPresets(listEffectPresets()); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    };
    refresh();
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);
  const run = (action: () => string) => {
    try { const result = action(); setPresets(listEffectPresets()); setMessage(result); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  return <aside className="node-workspace-inspector effect-preset-library" style={{ width, minWidth: width }} aria-label="Effect presets"
    onClick={event => { if (event.detail > 0 && event.target instanceof HTMLButtonElement) event.target.blur(); }}>
    <div className="node-workspace-inspector-header"><h3>Effect presets</h3><p>Save a customized effect and reuse independent copies across projects in this browser.</p></div>
    <ResolveInspectorSection title="Save a copy" indicator="none">
      <p className="face-cable-hint">{effect ? `Selected: ${effect.name}` : 'Select an effect or a node inside its graph.'}</p>
      <form onSubmit={event => { event.preventDefault(); run(() => {
        const current = readTimelineRuntimeState(useTimelineStore).clips.find(clip => clip.id === clipId)?.effects.find(candidate => candidate.id === effect?.id);
        if (!current) throw new Error('Select an effect to save.');
        saveEffectPreset(current, name); setName(''); return 'Effect preset saved.';
      }); }}>
        <input className="operator-group-name" aria-label="Effect preset name" placeholder="Preset name" maxLength={80} value={name} onChange={event => setName(event.target.value)} />
        <button type="submit" disabled={!effect || !name.trim()}>Save effect copy</button>
      </form>
      <p className="face-cable-hint">Includes parameters and the internal node graph. Clip animation and external media are not copied.</p>
    </ResolveInspectorSection>
    <ResolveInspectorSection title="Saved effects" indicator="none">
      {!presets.length && <p className="face-cable-hint">No saved effects yet.</p>}
      {presets.map(preset => <div className="effect-preset-entry" key={preset.id}>
        <span title={preset.label}>{preset.label}</span>
        <button type="button" disabled={locked} aria-label={`Add ${preset.label}`} onClick={() => run(() => {
          onSelectNode(applyEffectPreset(clipId, preset)); return `Added ${preset.label}.`;
        })}>Add copy</button>
        <button type="button" aria-label={`Delete preset ${preset.label}`} onClick={() => run(() => {
          removeEffectPreset(preset.id); return 'Preset deleted. Existing copies are unchanged.';
        })}>Delete</button>
      </div>)}
    </ResolveInspectorSection>
    {message && <p className="face-cable-hint" role="status">{message}</p>}
  </aside>;
}
