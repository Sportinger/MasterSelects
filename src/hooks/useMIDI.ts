import { useCallback, useEffect, useState } from 'react';
import { useMIDIStore } from '../stores/midiStore';
import type {
  MIDILearnTarget,
  MIDINoteBinding,
  MIDIParameterBindings,
  MIDIPermissionState,
  MIDITransportAction,
  MarkerMIDIAction,
} from '../types/midi';

type MIDIPermissionDescriptor = PermissionDescriptor & {
  name: 'midi';
  sysex?: boolean;
};

async function queryMIDIPermissionState(): Promise<MIDIPermissionState> {
  if (!navigator.requestMIDIAccess) {
    return 'unsupported';
  }

  if (!navigator.permissions?.query) {
    return 'unknown';
  }

  try {
    const status = await navigator.permissions.query({
      name: 'midi',
      sysex: false,
    } as MIDIPermissionDescriptor);
    return status.state;
  } catch {
    return 'unknown';
  }
}

export function useMIDI() {
  const {
    isSupported,
    isEnabled,
    connectionStatus,
    connectionError,
    devices,
    lastMessage,
    learnTarget,
    transportBindings,
    slotBindings,
    parameterBindings,
    activeMappingIds,
    setSupported,
    setEnabled,
    setConnectionStatus,
    setTransportBinding,
    startLearning,
    cancelLearning,
  } = useMIDIStore();
  const [permissionState, setPermissionState] = useState<MIDIPermissionState | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadPermissionState = async () => {
      const nextState = await queryMIDIPermissionState();
      if (!cancelled) {
        setPermissionState(nextState);
      }
    };

    void loadPermissionState();

    return () => {
      cancelled = true;
    };
  }, [connectionStatus, isEnabled]);

  const enableMIDI = useCallback(async () => {
    if (!navigator.requestMIDIAccess) {
      setPermissionState('unsupported');
      setSupported(false);
      setEnabled(false);
      setConnectionStatus('error', 'Web MIDI API is not supported in this browser.');
      return false;
    }

    const currentPermissionState = await queryMIDIPermissionState();
    setPermissionState(currentPermissionState);
    setSupported(true);

    if (currentPermissionState === 'denied') {
      setEnabled(false);
      setConnectionStatus('error', 'Browser MIDI permission is blocked for this site.');
      return false;
    }

    setConnectionStatus('requesting');

    try {
      await navigator.requestMIDIAccess();
      setPermissionState(await queryMIDIPermissionState());
      setEnabled(true);
      return true;
    } catch (error) {
      const nextPermissionState = await queryMIDIPermissionState();
      setPermissionState(nextPermissionState);
      setEnabled(false);
      setConnectionStatus(
        'error',
        nextPermissionState === 'denied'
          ? 'Browser MIDI permission is blocked for this site.'
          : error instanceof Error
            ? error.message
            : 'Failed to access MIDI devices.'
      );
      return false;
    }
  }, [setConnectionStatus, setEnabled, setSupported]);

  const disableMIDI = useCallback(() => {
    setEnabled(false);
    cancelLearning();
  }, [cancelLearning, setEnabled]);

  const startLearningTransportBinding = useCallback((action: MIDITransportAction) => {
    startLearning({
      kind: 'transport',
      action,
    });
  }, [startLearning]);

  const startLearningMarkerBinding = useCallback((
    markerId: string,
    markerLabel: string,
    action: MarkerMIDIAction,
    sourceMarkerId?: string
  ) => {
    startLearning({
      kind: 'marker',
      markerId,
      markerLabel,
      action,
      sourceMarkerId,
    });
  }, [startLearning]);

  const startLearningSlotBinding = useCallback((
    slotIndex: number,
    slotLabel: string,
    compositionId?: string,
    compositionName?: string
  ) => {
    startLearning({
      kind: 'slot',
      slotIndex,
      slotLabel,
      compositionId,
      compositionName,
    });
  }, [startLearning]);

  const clearTransportBinding = useCallback((action: MIDITransportAction) => {
    setTransportBinding(action, null);
  }, [setTransportBinding]);

  return {
    isSupported,
    isEnabled,
    connectionStatus,
    connectionError,
    permissionState,
    devices,
    lastMessage,
    learnTarget: learnTarget as MIDILearnTarget | null,
    transportBindings: transportBindings as Record<MIDITransportAction, MIDINoteBinding | null>,
    slotBindings: slotBindings as Record<number, MIDINoteBinding | null>,
    parameterBindings: parameterBindings as MIDIParameterBindings,
    activeMappingIds,
    enableMIDI,
    disableMIDI,
    startLearningTransportBinding,
    startLearningMarkerBinding,
    startLearningSlotBinding,
    clearTransportBinding,
    cancelLearning,
  };
}
