// Shared props for the layout-agnostic synth panel sections (#298, plan §6C).
//
// Each section takes (instrument, onChange) and knows nothing about where it is
// mounted — the properties tab stacks them today; a future dedicated synth editor
// re-hosts the SAME components in a signal-flow layout with no rewrite. `onChange`
// carries a partial patch that the host maps to setTrackMidiInstrument; because
// that action shallow-merges, sections always pass COMPLETE nested objects
// (filter, filterEnv, lfos, modMatrix) when changing one field.

import type { SimpleSynthInstrument } from '../../../../types/midiClip';

export interface SynthSectionProps {
  instrument: SimpleSynthInstrument;
  onChange: (patch: Partial<SimpleSynthInstrument>) => void;
}
