// Preset picker for the Simple Synth (#298, workstream D). Loads a built-in or
// user patch, and saves the current patch as a new user preset. Built-ins live in
// code; user presets persist in settingsStore. Loading applies the WHOLE patch
// (deep-cloned so the track never shares a reference with the stored preset).

import { useSettingsStore } from '../../../../stores/settingsStore';
import { SIMPLE_SYNTH_PRESETS, getSimpleSynthPreset } from '../../../../engine/audio/synth/simpleSynthPresets';
import type { SynthSectionProps } from './synthSectionTypes';

// Structural deep-equal that ignores object key ORDER (the live instrument's keys
// are ordered by the store's merge, not the preset literal) but respects ARRAY
// order (lfo/route order is meaningful). Values are plain JSON, so no epsilon.
function sameInstrument(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr || bArr) {
    if (!aArr || !bArr || a.length !== b.length) return false;
    return a.every((v, i) => sameInstrument(v, b[i]));
  }
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  return ak.every((k) =>
    Object.prototype.hasOwnProperty.call(b, k) &&
    sameInstrument((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function PresetSection({ instrument, onChange }: SynthSectionProps) {
  const userPresets = useSettingsStore((s) => s.simpleSynthUserPresets);
  const addPreset = useSettingsStore((s) => s.addSimpleSynthUserPreset);
  const removePreset = useSettingsStore((s) => s.removeSimpleSynthUserPreset);

  const load = (id: string) => {
    if (!id) return;
    const preset = getSimpleSynthPreset(id) ?? userPresets.find((p) => p.id === id);
    if (!preset) return;
    onChange(JSON.parse(JSON.stringify(preset.instrument)));
  };

  // Show the loaded preset's name in the dropdown while the patch matches it, and
  // fall back to the placeholder once the user tweaks a knob (it becomes "custom").
  const currentId =
    [...SIMPLE_SYNTH_PRESETS, ...userPresets].find((p) => sameInstrument(p.instrument, instrument))?.id ?? '';

  const save = () => {
    const name = window.prompt('Save preset as:')?.trim();
    if (name) addPreset(name, instrument);
  };

  return (
    <div className="properties-section">
      <div className="audio-bus-control-row audio-bus-control-row-compact">
        <span>Preset</span>
        <select value={currentId} onChange={(e) => load(e.currentTarget.value)}>
          <option value="">{currentId ? 'Load preset…' : 'Custom (unsaved)'}</option>
          <optgroup label="Built-in">
            {SIMPLE_SYNTH_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
          {userPresets.length > 0 && (
            <optgroup label="User">
              {userPresets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          )}
        </select>
        <button type="button" onClick={save} title="Save current patch as a user preset">Save…</button>
      </div>
      {userPresets.length > 0 && (
        <div className="synth-preset-chips">
          {userPresets.map((p) => (
            <span key={p.id} className="synth-preset-chip">
              <button type="button" onClick={() => load(p.id)} title="Load">{p.name}</button>
              <button type="button" className="synth-preset-chip-x" onClick={() => removePreset(p.id)} title="Delete preset">✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
