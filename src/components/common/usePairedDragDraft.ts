import { useState } from 'react';

/**
 * Shared drag draft of a slider and the number field next to it. Each control keeps its own draft
 * while it is dragged, so it paints every pointer sample at once; the store commit follows once per
 * frame. Its partner only sees the store value, one frame (or more on a loaded host) behind. Pass
 * the returned value to both controls and the setter as their `onDraftChange`: the partner then
 * paints the same sample in the same flush. The draft is dropped after the release flush, so the
 * store value (clamped or rejected) wins afterwards.
 */
export function usePairedDragDraft(value: number): readonly [number, (draft: number | null) => void] {
  const [draft, setDraft] = useState<number | null>(null);
  return [draft ?? value, setDraft];
}
