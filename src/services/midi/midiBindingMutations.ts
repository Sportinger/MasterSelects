import { useMIDIStore } from '../../stores/midiStore';
import { useTimelineStore } from '../../stores/timeline';
import type {
  MarkerMIDIBinding,
  MarkerMIDIAction,
  MIDINoteBinding,
  MIDITransportAction,
} from '../../types/midi';
import { midiBindingsMatch } from '../../types/midi';

interface ConflictOptions {
  transportAction?: MIDITransportAction;
  markerId?: string;
  markerAction?: MarkerMIDIAction;
  slotIndex?: number;
}

function updateMarkerBindings(markerId: string, bindings: MarkerMIDIBinding[]): void {
  useTimelineStore.getState().updateMarker(markerId, {
    midiBindings: bindings.length > 0 ? bindings : undefined,
  });
}

export function removeConflictingMIDIBinding(
  binding: MIDINoteBinding,
  options?: ConflictOptions
): void {
  const midiStore = useMIDIStore.getState();
  const timelineStore = useTimelineStore.getState();

  const transportBindings = midiStore.transportBindings;
  (Object.keys(transportBindings) as MIDITransportAction[]).forEach((action) => {
    const existingBinding = transportBindings[action];
    const isSameTarget = options?.transportAction === action;
    if (existingBinding && !isSameTarget && midiBindingsMatch(existingBinding, binding)) {
      midiStore.setTransportBinding(action, null);
    }
  });

  Object.entries(midiStore.slotBindings).forEach(([slotKey, existingBinding]) => {
    const slotIndex = Number(slotKey);
    const isSameTarget = options?.slotIndex === slotIndex;
    if (existingBinding && !isSameTarget && midiBindingsMatch(existingBinding, binding)) {
      midiStore.setSlotBinding(slotIndex, null);
    }
  });

  timelineStore.markers.forEach((marker) => {
    if (!marker.midiBindings || marker.midiBindings.length === 0) {
      return;
    }

    const nextBindings = marker.midiBindings.filter((existingBinding) => {
      const isSameTarget =
        options?.markerId === marker.id && options?.markerAction === existingBinding.action;

      if (isSameTarget) {
        return true;
      }

      return !midiBindingsMatch(existingBinding, binding);
    });

    if (nextBindings.length !== marker.midiBindings.length) {
      updateMarkerBindings(marker.id, nextBindings);
    }
  });
}

export function setTransportMIDIBinding(
  action: MIDITransportAction,
  binding: MIDINoteBinding | null
): void {
  const midiStore = useMIDIStore.getState();

  if (!binding) {
    midiStore.setTransportBinding(action, null);
    return;
  }

  removeConflictingMIDIBinding(binding, { transportAction: action });
  midiStore.setTransportBinding(action, binding);
}

export function setMarkerMIDIBinding(
  markerId: string,
  action: MarkerMIDIAction,
  binding: MIDINoteBinding | null
): void {
  const getMarker = () => useTimelineStore.getState().markers.find((candidate) => candidate.id === markerId);
  const marker = getMarker();
  if (!marker) {
    return;
  }

  if (!binding) {
    const nextBindings = (marker.midiBindings ?? []).filter((existingBinding) => existingBinding.action !== action);
    updateMarkerBindings(markerId, nextBindings);
    return;
  }

  removeConflictingMIDIBinding(binding, {
    markerId,
    markerAction: action,
  });

  const nextBindings = (getMarker()?.midiBindings ?? []).filter(
    (existingBinding) => existingBinding.action !== action
  );
  nextBindings.push({
    ...binding,
    action,
  });
  updateMarkerBindings(markerId, nextBindings);
}

export function setSlotMIDIBinding(
  slotIndex: number,
  binding: MIDINoteBinding | null
): void {
  const midiStore = useMIDIStore.getState();

  if (!Number.isInteger(slotIndex) || slotIndex < 0) {
    return;
  }

  if (!binding) {
    midiStore.setSlotBinding(slotIndex, null);
    return;
  }

  removeConflictingMIDIBinding(binding, { slotIndex });
  midiStore.setSlotBinding(slotIndex, binding);
}

export function moveMarkerMIDIBinding(params: {
  fromMarkerId: string;
  toMarkerId: string;
  action: MarkerMIDIAction;
  binding: MIDINoteBinding;
}): void {
  const { fromMarkerId, toMarkerId, action, binding } = params;

  if (fromMarkerId === toMarkerId) {
    setMarkerMIDIBinding(toMarkerId, action, binding);
    return;
  }

  setMarkerMIDIBinding(fromMarkerId, action, null);
  setMarkerMIDIBinding(toMarkerId, action, binding);
}
