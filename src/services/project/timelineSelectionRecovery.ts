import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { projectFileService } from '../projectFileService';
import { isProjectStoreSyncInProgress } from './projectStoreSyncGuard';
import type { ProjectFile } from './types/project.types';

const STORAGE_KEY = 'masterselects.timelineSelectionReload';

interface TimelineSelectionRecovery {
  projectCreatedAt: string;
  compositionId: string;
  selectedClipIds: string[];
  primarySelectedClipId: string | null;
}

function saveTimelineSelectionForReload(): void {
  // A reload during hydration must not replace the previous selection with the
  // temporary empty timeline. Storage is tab-local and written synchronously.
  if (isProjectStoreSyncInProgress()) return;
  try {
    const project = projectFileService.getProjectData();
    const compositionId = useMediaStore.getState().activeCompositionId;
    if (!project || !compositionId) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    const timeline = useTimelineStore.getState();
    const recovery: TimelineSelectionRecovery = {
      projectCreatedAt: project.createdAt,
      compositionId,
      selectedClipIds: [...timeline.selectedClipIds],
      primarySelectedClipId: timeline.propertiesSelection?.kind === 'clip'
        ? timeline.propertiesSelection.clipId
        : timeline.primarySelectedClipId,
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(recovery));
  } catch {
    // Browser storage can be unavailable; selection recovery is best effort.
  }
}

export function setupTimelineSelectionReloadRecovery(): () => void {
  window.addEventListener('beforeunload', saveTimelineSelectionForReload);
  window.addEventListener('pagehide', saveTimelineSelectionForReload);
  return () => {
    window.removeEventListener('beforeunload', saveTimelineSelectionForReload);
    window.removeEventListener('pagehide', saveTimelineSelectionForReload);
  };
}

export function readTimelineSelectionRecovery(project: ProjectFile): TimelineSelectionRecovery | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const recovery: TimelineSelectionRecovery = JSON.parse(raw);
    if (
      recovery?.projectCreatedAt !== project.createdAt
      || !project.compositions.some(composition => composition.id === recovery.compositionId)
      || !Array.isArray(recovery.selectedClipIds)
      || !recovery.selectedClipIds.every(id => typeof id === 'string')
      || (recovery.primarySelectedClipId !== null && typeof recovery.primarySelectedClipId !== 'string')
    ) return null;
    return recovery;
  } catch {
    return null;
  }
}

export function restoreTimelineSelectionRecovery(recovery: TimelineSelectionRecovery | null): void {
  if (recovery && useMediaStore.getState().activeCompositionId === recovery.compositionId) {
    const timeline = useTimelineStore.getState();
    const existingIds = new Set(timeline.clips.map(clip => clip.id));
    const selectedClipIds = new Set(recovery.selectedClipIds.filter(id => existingIds.has(id)));
    const primarySelectedClipId = recovery.primarySelectedClipId && selectedClipIds.has(recovery.primarySelectedClipId)
      ? recovery.primarySelectedClipId
      : selectedClipIds.values().next().value ?? null;
    useTimelineStore.setState({
      selectedClipIds,
      primarySelectedClipId,
      propertiesSelection: primarySelectedClipId ? { kind: 'clip', clipId: primarySelectedClipId } : null,
    });
  }
  try {
    // Consume only after a successful load, so subsequent project opens do not
    // resurrect an old selection and a reload during loading can still retry.
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Selection remains usable when browser storage is blocked.
  }
}
