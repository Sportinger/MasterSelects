// Synth-flavored Knob: the general common/Knob bound to the live-param bus (plan
// §14). Mirrors SynthSlider's ergonomics — pass `paramId` and the knob's
// automation overlay tracks that parameter's live value during playback, without
// re-rendering the panel. Everything else is the general Knob.

import { useCallback } from 'react';
import { Knob, type KnobProps } from '../../../common/Knob';
import { liveParamBus } from '../../../../services/midi/instrumentParams/liveParamBus';

type SynthKnobProps = Omit<KnobProps, 'subscribeLive'> & { paramId?: string };

export function SynthKnob({ paramId, ...knobProps }: SynthKnobProps) {
  const subscribeLive = useCallback(
    (cb: (value: number | undefined) => void) =>
      paramId ? liveParamBus.subscribe(paramId, cb) : () => {},
    [paramId],
  );
  return <Knob {...knobProps} subscribeLive={paramId ? subscribeLive : undefined} />;
}
