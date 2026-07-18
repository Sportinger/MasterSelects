// LFO rack (#298): add/remove LFOs and edit each one's target, shape, rate, depth,
// and per-LFO global toggle. LFOs carry a STABLE id (the mod-matrix refers to it),
// so reordering/removing never rots a routing. `depth`'s unit follows the target
// (cents / Hz / 0–1), surfaced from SYNTH_LFO_TARGET_OPTIONS.

import {
  SYNTH_LFO_SHAPE_OPTIONS,
  SYNTH_LFO_TARGET_OPTIONS,
  createDefaultSynthLfo,
  type SynthLfo,
  type SynthLfoShape,
  type SynthLfoTarget,
} from '../../../../types/midiClip';
import { generateSynthLfoId } from '../../../../stores/timeline/helpers/idGenerator';
import { SynthSlider } from './SynthSlider';
import type { SynthSectionProps } from './synthSectionTypes';

export function LfoSection({ instrument, onChange }: SynthSectionProps) {
  const lfos = instrument.lfos ?? [];
  const commit = (next: SynthLfo[]) => onChange({ lfos: next });
  const patchLfo = (id: string, patch: Partial<SynthLfo>) =>
    commit(lfos.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  return (
    <div className="properties-section">
      <div className="audio-bus-control-row audio-bus-control-row-compact">
        <h4 style={{ margin: 0 }}>LFOs</h4>
        <button type="button" onClick={() => commit([...lfos, createDefaultSynthLfo(generateSynthLfoId())])}>
          + Add LFO
        </button>
      </div>
      {lfos.length === 0 && <p className="properties-hint">No LFOs. Add one for vibrato, filter wobble, or tremolo.</p>}
      {lfos.map((lfo, index) => {
        const targetOption = SYNTH_LFO_TARGET_OPTIONS.find((t) => t.value === lfo.target);
        return (
          <div key={lfo.id} className="synth-lfo-row">
            <div className="audio-bus-control-row audio-bus-control-row-compact">
              <span>LFO {index + 1}</span>
              <button type="button" onClick={() => commit(lfos.filter((l) => l.id !== lfo.id))}>Remove</button>
            </div>
            <label className="audio-bus-control-row audio-bus-control-row-compact">
              <span>Target</span>
              <select value={lfo.target} onChange={(e) => patchLfo(lfo.id, { target: e.currentTarget.value as SynthLfoTarget })}>
                {SYNTH_LFO_TARGET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="audio-bus-control-row audio-bus-control-row-compact">
              <span>Shape</span>
              <select value={lfo.shape} onChange={(e) => patchLfo(lfo.id, { shape: e.currentTarget.value as SynthLfoShape })}>
                {SYNTH_LFO_SHAPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <SynthSlider label="Rate" unit="Hz" value={lfo.rate} min={0.01} max={20} scale="log"
              onChange={(rate) => patchLfo(lfo.id, { rate })} />
            <SynthSlider label="Depth" unit={targetOption?.depthUnit}
              value={lfo.depth} min={0} max={lfo.target === 'amp' ? 1 : lfo.target === 'pitch' ? 100 : 5000}
              step={lfo.target === 'amp' ? 0.01 : 1}
              scale={lfo.target === 'filter' ? 'power' : 'linear'}
              paramId={lfo.target === 'pitch' ? `lfo.${lfo.id}.depth` : undefined}
              onChange={(depth) => patchLfo(lfo.id, { depth })} />
            <label className="audio-bus-control-row audio-bus-control-row-compact">
              <span>Global (shared)</span>
              <input type="checkbox" checked={lfo.global} onChange={(e) => patchLfo(lfo.id, { global: e.currentTarget.checked })} />
            </label>
          </div>
        );
      })}
    </div>
  );
}
