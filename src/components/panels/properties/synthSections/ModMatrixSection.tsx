// Additive mod-matrix editor (#298, plan §3): each row routes a source onto a typed
// destination with an amount, and they SUM. Destinations are a discriminated union
// (not dotted strings); lfoDepth/lfoRate need a stable lfoId, surfaced as a second
// picker. In the disposable JS DSP only a subset of routings is audible yet (see
// MidiSynthVoice); the routing DATA is fully durable regardless.

import {
  MOD_SOURCE_OPTIONS,
  MOD_DESTINATION_OPTIONS,
  type ModDestination,
  type ModMatrixRoute,
  type ModSource,
} from '../../../../types/midiClip';
import { Knob } from '../../../common/Knob';
import type { SynthSectionProps } from './synthSectionTypes';

export function ModMatrixSection({ instrument, onChange }: SynthSectionProps) {
  const routes = instrument.modMatrix ?? [];
  const lfos = instrument.lfos ?? [];
  const commit = (next: ModMatrixRoute[]) => onChange({ modMatrix: next });
  const patchRoute = (index: number, patch: Partial<ModMatrixRoute>) =>
    commit(routes.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const addRoute = () => commit([...routes, { source: 'velocity', destination: { kind: 'filterCutoff' }, amount: 1 }]);

  // Build a destination from a chosen kind, attaching the first LFO id when needed.
  const destinationForKind = (kind: ModDestination['kind']): ModDestination => {
    if (kind === 'lfoDepth' || kind === 'lfoRate') {
      return { kind, lfoId: lfos[0]?.id ?? '' };
    }
    return { kind };
  };

  return (
    <div className="properties-section">
      <div className="audio-bus-control-row audio-bus-control-row-compact">
        <h4 style={{ margin: 0 }}>Mod Matrix</h4>
        <button type="button" onClick={addRoute}>+ Add Route</button>
      </div>
      {routes.length === 0 && <p className="properties-hint">No routings. Add one to modulate a destination from a source.</p>}
      {routes.map((route, index) => {
        const needsLfo = route.destination.kind === 'lfoDepth' || route.destination.kind === 'lfoRate';
        return (
          <div key={index} className="synth-mod-row">
            <div className="audio-bus-control-row audio-bus-control-row-compact">
              <select value={route.source} onChange={(e) => patchRoute(index, { source: e.currentTarget.value as ModSource })}>
                {MOD_SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span aria-hidden>→</span>
              <select
                value={route.destination.kind}
                onChange={(e) => patchRoute(index, { destination: destinationForKind(e.currentTarget.value as ModDestination['kind']) })}
              >
                {MOD_DESTINATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button type="button" onClick={() => commit(routes.filter((_, i) => i !== index))}>✕</button>
            </div>
            {needsLfo && (
              <label className="audio-bus-control-row audio-bus-control-row-compact">
                <span>LFO</span>
                {lfos.length === 0 ? (
                  <span className="properties-hint">Add an LFO first</span>
                ) : (
                  <select
                    value={'lfoId' in route.destination ? route.destination.lfoId : ''}
                    onChange={(e) => patchRoute(index, { destination: { kind: route.destination.kind as 'lfoDepth' | 'lfoRate', lfoId: e.currentTarget.value } })}
                  >
                    {lfos.map((l, i) => <option key={l.id} value={l.id}>LFO {i + 1}</option>)}
                  </select>
                )}
              </label>
            )}
            <div className="synth-knob-row">
              <Knob label="Amount" value={route.amount} min={-1} max={1} step={0.01} defaultValue={1}
                onChange={(amount) => patchRoute(index, { amount })} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
