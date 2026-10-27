// Commands of the phone source monitor. The source and its marks are the editor's own source-monitor
// state (mediaStore.sourceMonitorFileId / sourceMonitorInPoint / sourceMonitorOutPoint), and placing
// runs the editor's placement command (services/timelinePlacementCommands), so the phone never has a
// second implementation of insert, overwrite, replace, fit-to-fill, append, on-top or ripple overwrite.
import { Logger } from '../../../services/logger';
import {
  resolveTimelinePlacementCommandPreview, runTimelinePlacementCommand,
} from '../../../services/timelinePlacementCommands';
import { useMediaStore } from '../../../stores/mediaStore';
import type { MediaFile } from '../../../stores/mediaStore/types';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineToolPreview } from '../../../stores/timeline/types';
import type { PhoneActionResult } from '../contracts';
import { usePhoneUiStore } from '../state/phoneUiStore';
import type { PhoneSourceMode } from './phoneSourceModel';

const log = Logger.create('PhoneSource');

/** Media kinds the source monitor shows. */
export function isPhoneSourceFile(file: Pick<MediaFile, 'type'>): boolean {
  return file.type === 'video' || file.type === 'image' || file.type === 'audio';
}

/** Opens the source sheet showing `fileId` (or the source picker when null). */
export function openPhoneSource(fileId: string | null): void {
  useMediaStore.getState().setSourceMonitorFile(fileId);
  usePhoneUiStore.getState().openSheet('source');
}

/** Leaves the source monitor: later placements use the library selection again, like the desktop. */
export function closePhoneSource(): void {
  if (useMediaStore.getState().sourceMonitorFileId !== null) useMediaStore.getState().setSourceMonitorFile(null);
}

export function phoneSourcePreview(mode: PhoneSourceMode): TimelineToolPreview | null {
  return resolveTimelinePlacementCommandPreview(mode);
}

/** A clip of the source's track type is selected (target of Replace, Fit to fill, Ripple overwrite). */
export function phoneSourceTargetClip(trackType: 'video' | 'audio'): { id: string; name: string } | null {
  const state = useTimelineStore.getState();
  for (const id of state.selectedClipIds) {
    const clip = state.clips.find((candidate) => candidate.id === id);
    const track = clip ? state.tracks.find((candidate) => candidate.id === clip.trackId) : undefined;
    if (clip && track?.type === trackType && track.locked !== true) return { id: clip.id, name: clip.name };
  }
  return null;
}

/** Selects the topmost unlocked clip of `trackType` under the playhead (selection is not an undo step). */
export function selectPhoneSourceTargetUnderPlayhead(trackType: 'video' | 'audio'): PhoneActionResult {
  const state = useTimelineStore.getState();
  const time = state.playheadPosition;
  const clip = state.tracks
    .filter((track) => track.type === trackType && track.locked !== true && track.visible !== false)
    .flatMap((track) => state.clips.filter((candidate) => candidate.trackId === track.id))
    .find((candidate) => time >= candidate.startTime - 1e-6 && time < candidate.startTime + candidate.duration - 1e-6);
  if (!clip) return { ok: false, message: `No ${trackType} clip is under the playhead. Move the playhead onto the clip to replace.` };
  state.selectClip(clip.id);
  return { ok: true, message: `Target: ${clip.name}.` };
}

/** Places the current source with `mode` through the editor's placement command. Call inside an edit session. */
export async function placePhoneSource(mode: PhoneSourceMode): Promise<PhoneActionResult> {
  try {
    // Fit, like the phone's media import: a picture with another aspect stays whole in the canvas.
    const result = await runTimelinePlacementCommand(mode, { visualScaleMode: 'fit' });
    if (!result.success) {
      log.warn('Source placement refused', { mode, reason: result.reason });
      return { ok: false, message: result.reason ?? 'The source could not be placed.' };
    }
    return { ok: true, message: 'Placed.' };
  } catch (error) {
    log.error('Source placement failed', { mode, error });
    return { ok: false, message: `Placing failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function phoneTrackName(trackId: string): string {
  return useTimelineStore.getState().tracks.find((track) => track.id === trackId)?.name ?? 'a track';
}
