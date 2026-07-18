// Playhead-driven driver for the motorized-fader read-out (plan §14.3 piece 3).
//
// Mounted by the instrument panel. While playing, a single rAF loop reads the
// smooth live playhead time (getPlayheadPosition — the same source the timeline's
// live playhead uses), finds the MIDI clip under the playhead on this track,
// re-derives each parameter's live value with the pure evaluator, and publishes
// it to the liveParamBus. The animated controls subscribe to the bus and update
// their own DOM, so the properties panel never re-renders per frame.
//
// This reads nothing from the DSP — it re-derives from patch + clip automation —
// so it is deterministic, matches export, and survives the DSP swap (plan §3a).

import { useEffect } from 'react';
import { getPlayheadPosition } from '../../../../services/layerBuilder';
import { useTimelineStore } from '../../../../stores/timeline';
import type { MidiInstrument } from '../../../../types/midiClip';
import { evaluateParamAt, getInstrumentParamModel } from '../../../../services/midi/instrumentParams';
import { liveParamBus } from '../../../../services/midi/instrumentParams/liveParamBus';
import { activeMidiClipAt, clipContentTimeAt } from '../../../../services/midi/instrumentParams/activeMidiClip';

export function useLiveInstrumentParams(
  trackId: string,
  instrument: MidiInstrument | undefined,
  isPlaying: boolean,
): void {
  useEffect(() => {
    if (!isPlaying || !instrument) {
      liveParamBus.reset();
      return;
    }
    const descriptors = getInstrumentParamModel(instrument);
    if (descriptors.length === 0) return;

    let rafId = 0;
    const tick = () => {
      const state = useTimelineStore.getState();
      const globalTime = getPlayheadPosition(state.playheadPosition);
      const clip = activeMidiClipAt(state.clips, trackId, globalTime);
      const contentTime = clip ? clipContentTimeAt(clip, globalTime) : 0;
      for (const descriptor of descriptors) {
        const value = clip
          ? evaluateParamAt(descriptor, instrument, clip.automation, contentTime)
          : undefined;
        liveParamBus.publish(descriptor.id, value);
      }
      rafId = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(rafId);
      liveParamBus.reset();
    };
  }, [trackId, instrument, isPlaying]);
}
