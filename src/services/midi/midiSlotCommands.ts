import { useMediaStore } from '../../stores/mediaStore';
import type { SlotMIDIBinding } from '../../types/midi';

export async function triggerSlotMIDIAction(slotIndex: number): Promise<void> {
  const mediaStore = useMediaStore.getState();
  const slotEntry = Object.entries(mediaStore.slotAssignments ?? {})
    .find(([, assignedSlotIndex]) => assignedSlotIndex === slotIndex);
  const compositionId = slotEntry?.[0];

  if (!compositionId) {
    return;
  }

  const layerIndex = Math.floor(slotIndex / 12);
  mediaStore.triggerLiveSlot(compositionId, layerIndex);
}

export async function triggerSlotMIDIBinding(binding: SlotMIDIBinding): Promise<void> {
  await triggerSlotMIDIAction(binding.slotIndex);
}
