import { useEffect } from 'react';
import { useTimelineStore } from '../stores/timeline';
import { useMIDIStore } from '../stores/midiStore';
import {
  getMIDINoteName,
  midiBindingsMatch,
  type MIDIDeviceInfo,
  type MIDINoteBinding,
} from '../types/midi';
import {
  triggerMarkerMIDIBinding,
  triggerMIDITransportAction,
  triggerSlotMIDIAction,
} from '../services/midi/midiCommands';
import {
  moveMarkerMIDIBinding,
  setMarkerMIDIBinding,
  setSlotMIDIBinding,
  setTransportMIDIBinding,
} from '../services/midi/midiBindingMutations';

function buildDeviceList(access: MIDIAccess): MIDIDeviceInfo[] {
  const devices: MIDIDeviceInfo[] = [];

  access.inputs.forEach((input) => {
    devices.push({
      id: input.id,
      name: input.name || 'Unknown',
      manufacturer: input.manufacturer || 'Unknown',
    });
  });

  return devices;
}

export function useMIDIRuntime() {
  const isEnabled = useMIDIStore((state) => state.isEnabled);

  useEffect(() => {
    if (!navigator.requestMIDIAccess) {
      useMIDIStore.getState().setSupported(false);
      return;
    }

    useMIDIStore.getState().setSupported(true);

    if (!isEnabled) {
      useMIDIStore.getState().resetRuntimeState();
      return;
    }

    let cancelled = false;
    let midiAccess: MIDIAccess | null = null;

    const attachInputListeners = (access: MIDIAccess) => {
      const handleMessage = (event: MIDIMessageEvent) => {
        const [status = 0, data1 = 0, data2 = 0] = Array.from(event.data ?? []);
        const messageType = status & 0xf0;
        const channel = (status & 0x0f) + 1;

        if (messageType === 0x90 && data2 > 0) {
          const learnedBinding: MIDINoteBinding = {
            channel,
            note: data1,
          };

          useMIDIStore.getState().setLastMessage({
            channel,
            type: 'note-on',
            note: data1,
            noteName: getMIDINoteName(data1),
            velocity: data2,
          });

          const midiStore = useMIDIStore.getState();
          const learnTarget = midiStore.learnTarget;
          if (learnTarget) {
            if (learnTarget.kind === 'transport') {
              setTransportMIDIBinding(learnTarget.action, learnedBinding);
            } else if (learnTarget.kind === 'marker') {
              if (learnTarget.sourceMarkerId && learnTarget.sourceMarkerId !== learnTarget.markerId) {
                moveMarkerMIDIBinding({
                  fromMarkerId: learnTarget.sourceMarkerId,
                  toMarkerId: learnTarget.markerId,
                  action: learnTarget.action,
                  binding: learnedBinding,
                });
              } else {
                setMarkerMIDIBinding(
                  learnTarget.markerId,
                  learnTarget.action,
                  learnedBinding
                );
              }
            } else {
              setSlotMIDIBinding(learnTarget.slotIndex, learnedBinding);
            }
            midiStore.cancelLearning();
            return;
          }

          const matchedTransportAction = (Object.entries(midiStore.transportBindings) as Array<[
            'playPause' | 'stop',
            MIDINoteBinding | null,
          ]>).find(([, binding]) => binding && midiBindingsMatch(binding, learnedBinding))?.[0];

          if (matchedTransportAction) {
            void triggerMIDITransportAction(matchedTransportAction);
            return;
          }

          const markerBinding = useTimelineStore.getState().markers
            .flatMap((marker) => marker.midiBindings ?? [])
            .find((binding) => midiBindingsMatch(binding, learnedBinding));

          if (markerBinding) {
            void triggerMarkerMIDIBinding(markerBinding);
            return;
          }

          const slotBindingEntry = Object.entries(midiStore.slotBindings)
            .find(([, binding]) => binding && midiBindingsMatch(binding, learnedBinding));

          if (slotBindingEntry) {
            void triggerSlotMIDIAction(Number(slotBindingEntry[0]));
          }
          return;
        }

        if (messageType === 0x80 || (messageType === 0x90 && data2 === 0)) {
          useMIDIStore.getState().setLastMessage({
            channel,
            type: 'note-off',
            note: data1,
            noteName: getMIDINoteName(data1),
            velocity: data2,
          });
          return;
        }

        if (messageType === 0xb0) {
          useMIDIStore.getState().setLastMessage({
            channel,
            type: 'control-change',
            control: data1,
            value: data2,
          });
        }
      };

      access.inputs.forEach((input) => {
        input.onmidimessage = handleMessage;
      });
    };

    const refreshDevices = (access: MIDIAccess) => {
      useMIDIStore.getState().setDevices(buildDeviceList(access));
      attachInputListeners(access);
    };

    useMIDIStore.getState().setConnectionStatus('requesting');

    navigator.requestMIDIAccess().then(
      (access) => {
        if (cancelled) {
          access.inputs.forEach((input) => {
            input.onmidimessage = null;
          });
          return;
        }

        midiAccess = access;
        useMIDIStore.getState().setConnectionStatus('connected');
        refreshDevices(access);

        access.onstatechange = () => {
          if (!cancelled) {
            refreshDevices(access);
          }
        };
      },
      (error) => {
        if (cancelled) {
          return;
        }

        useMIDIStore.getState().setConnectionStatus(
          'error',
          error instanceof Error ? error.message : 'Failed to access MIDI devices.'
        );
      }
    );

    return () => {
      cancelled = true;

      if (midiAccess) {
        midiAccess.onstatechange = null;
        midiAccess.inputs.forEach((input) => {
          input.onmidimessage = null;
        });
      }

      useMIDIStore.getState().setDevices([]);
    };
  }, [isEnabled]);
}
