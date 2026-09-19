import type { TimelineTrack } from '../../../types';

export function buildCompositionSwitchTracks(
  currentTracks: TimelineTrack[],
  _targetTracks: TimelineTrack[] | null
): TimelineTrack[] {
  // Track snapshots are only animation metadata. Rendering snapshot rows makes
  // them look editable even though track actions operate on the live store.
  // Keep the rendered row set identical to the currently loaded composition.
  return currentTracks;
}
