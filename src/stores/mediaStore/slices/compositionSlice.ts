// Composition CRUD and tab management

import type { Composition, MediaSliceCreator, MediaState } from '../types';
import type { CompositionTimelineData, SerializableClip, TimelineClip } from '../../../types';
import { generateId } from '../helpers/importPipeline';
import { useTimelineStore } from '../../timeline';
import { useSettingsStore } from '../../settingsStore';
import { compositionRenderer } from '../../../services/compositionRenderer';
import { playheadState } from '../../../services/layerBuilder';

export interface CompositionSwitchOptions {
  skipAnimation?: boolean;
  playFromStart?: boolean;
}

export interface CompositionActions {
  createComposition: (name: string, settings?: Partial<Composition>) => Composition;
  duplicateComposition: (id: string) => Composition | null;
  removeComposition: (id: string) => void;
  updateComposition: (id: string, updates: Partial<Composition>) => void;
  setActiveComposition: (id: string | null) => void;
  getActiveComposition: () => Composition | undefined;
  openCompositionTab: (id: string, options?: CompositionSwitchOptions) => void;
  closeCompositionTab: (id: string) => void;
  getOpenCompositions: () => Composition[];
  reorderCompositionTabs: (fromIndex: number, toIndex: number) => void;
  assignMediaFileToSlot: (mediaFileId: string, slotIndex: number) => void;
  setPreviewComposition: (id: string | null) => void;
  setSourceMonitorFile: (id: string | null) => void;
}

const DURATION_SYNC_EPSILON = 0.0001;
const AUTO_TIMELINE_MIN_DURATION = 60;
const AUTO_TIMELINE_PADDING_SECONDS = 10;

type NestedCompReferenceClip = Pick<SerializableClip, 'isComposition' | 'compositionId' | 'inPoint' | 'outPoint' | 'duration'> &
  Partial<Pick<SerializableClip, 'sourceType' | 'naturalDuration' | 'waveform'>> &
  Partial<Pick<TimelineClip, 'source'>>;

function clampTimelineBounds(
  duration: number,
  playheadPosition: number,
  inPoint: number | null,
  outPoint: number | null
): Pick<CompositionTimelineData, 'playheadPosition' | 'inPoint' | 'outPoint'> {
  const clampedPlayhead = Math.max(0, Math.min(playheadPosition, duration));
  const clampedInPoint = inPoint === null ? null : Math.max(0, Math.min(inPoint, duration));
  const clampedOutPoint = outPoint === null ? null : Math.max(clampedInPoint ?? 0, Math.min(outPoint, duration));

  return {
    playheadPosition: clampedPlayhead,
    inPoint: clampedInPoint,
    outPoint: clampedOutPoint,
  };
}

function calculateUnlockedTimelineDuration(clips: Array<Pick<SerializableClip, 'startTime' | 'duration'>>): number {
  if (clips.length === 0) {
    return AUTO_TIMELINE_MIN_DURATION;
  }

  const maxEnd = Math.max(...clips.map((clip) => clip.startTime + clip.duration));
  return Math.max(AUTO_TIMELINE_MIN_DURATION, maxEnd + AUTO_TIMELINE_PADDING_SECONDS);
}

function syncNestedCompReferenceClip<T extends NestedCompReferenceClip>(
  clip: T,
  compositionId: string,
  previousDuration: number,
  nextDuration: number,
  options?: { clearWaveform?: boolean }
): T {
  if (!clip.isComposition || clip.compositionId !== compositionId) {
    return clip;
  }

  const reachesPreviousCompEnd =
    previousDuration <= DURATION_SYNC_EPSILON ||
    Math.abs(clip.outPoint - previousDuration) <= DURATION_SYNC_EPSILON;
  const nextOutPoint = reachesPreviousCompEnd
    ? nextDuration
    : Math.min(clip.outPoint, nextDuration);
  const nextInPoint = Math.min(clip.inPoint, nextOutPoint);
  const nextClipDuration = Math.max(0, nextOutPoint - nextInPoint);

  const nextNaturalDuration = nextDuration;
  const currentNaturalDuration = 'source' in clip
    ? clip.source?.naturalDuration
    : clip.naturalDuration;
  const needsUpdate =
    clip.inPoint !== nextInPoint ||
    clip.outPoint !== nextOutPoint ||
    clip.duration !== nextClipDuration ||
    currentNaturalDuration !== nextNaturalDuration;

  if (!needsUpdate) {
    return clip;
  }

  const updatedClip: T = {
    ...clip,
    inPoint: nextInPoint,
    outPoint: nextOutPoint,
    duration: nextClipDuration,
  };

  if ('source' in clip) {
    updatedClip.source = clip.source
      ? { ...clip.source, naturalDuration: nextNaturalDuration }
      : clip.source;
  } else {
    updatedClip.naturalDuration = nextNaturalDuration;
    if (options?.clearWaveform && clip.sourceType === 'audio') {
      updatedClip.waveform = undefined;
    }
  }

  return updatedClip;
}

function lockTimelineDuration(
  timelineData: CompositionTimelineData | undefined,
  duration: number
): CompositionTimelineData | undefined {
  if (!timelineData) {
    return timelineData;
  }

  const clampedBounds = clampTimelineBounds(
    duration,
    timelineData.playheadPosition,
    timelineData.inPoint,
    timelineData.outPoint
  );

  return {
    ...timelineData,
    duration,
    durationLocked: true,
    ...clampedBounds,
  };
}

function syncTimelineDataNestedCompReferences(
  timelineData: CompositionTimelineData | undefined,
  compositionId: string,
  previousDuration: number,
  nextDuration: number
): CompositionTimelineData | undefined {
  if (!timelineData) {
    return timelineData;
  }

  let changed = false;
  const updatedClips = timelineData.clips.map((clip) => {
    const updatedClip = syncNestedCompReferenceClip(
      clip,
      compositionId,
      previousDuration,
      nextDuration,
      { clearWaveform: true }
    );
    if (updatedClip !== clip) {
      changed = true;
    }
    return updatedClip;
  });

  if (!changed) {
    return timelineData;
  }

  const duration = timelineData.durationLocked
    ? timelineData.duration
    : calculateUnlockedTimelineDuration(updatedClips);
  const clampedBounds = clampTimelineBounds(
    duration,
    timelineData.playheadPosition,
    timelineData.inPoint,
    timelineData.outPoint
  );

  return {
    ...timelineData,
    clips: updatedClips,
    duration,
    ...clampedBounds,
  };
}

function syncActiveTimelineNestedCompReferences(
  activeCompositionId: string | null,
  compositionId: string,
  previousDuration: number,
  nextDuration: number
): void {
  if (!activeCompositionId || activeCompositionId === compositionId) {
    return;
  }

  const timelineStore = useTimelineStore.getState();
  const audioClipIds: string[] = [];
  let changed = false;

  const updatedClips = timelineStore.clips.map((clip) => {
    const updatedClip = syncNestedCompReferenceClip(
      clip,
      compositionId,
      previousDuration,
      nextDuration
    );
    if (updatedClip !== clip) {
      changed = true;
      if (updatedClip.source?.type === 'audio') {
        audioClipIds.push(updatedClip.id);
      }
    }
    return updatedClip;
  });

  if (!changed) {
    return;
  }

  useTimelineStore.setState({ clips: updatedClips });

  const refreshedTimelineStore = useTimelineStore.getState();
  refreshedTimelineStore.updateDuration();
  refreshedTimelineStore.invalidateCache();
  void refreshedTimelineStore.refreshCompClipNestedData(compositionId);

  for (const clipId of audioClipIds) {
    void refreshedTimelineStore.generateWaveformForClip(clipId);
  }
}

export const createCompositionSlice: MediaSliceCreator<CompositionActions> = (set, get) => ({
  createComposition: (name: string, settings?: Partial<Composition>) => {
    const { outputResolution } = useSettingsStore.getState();
    const duration = settings?.duration ?? 60;
    const comp: Composition = {
      id: generateId(),
      name,
      type: 'composition',
      parentId: settings?.parentId ?? null,
      createdAt: Date.now(),
      width: settings?.width ?? outputResolution.width,
      height: settings?.height ?? outputResolution.height,
      frameRate: settings?.frameRate ?? 30,
      duration,
      backgroundColor: settings?.backgroundColor ?? '#000000',
      timelineData: settings?.timelineData ?? {
        tracks: [
          { id: `video-1-${generateId()}`, name: 'Video 1', type: 'video' as const, height: 60, muted: false, visible: true, solo: false },
          { id: `audio-1-${generateId()}`, name: 'Audio 1', type: 'audio' as const, height: 40, muted: false, visible: true, solo: false },
        ],
        clips: [],
        playheadPosition: 0,
        duration,
        zoom: 50,
        scrollX: 0,
        inPoint: null,
        outPoint: null,
        loopPlayback: false,
      },
    };

    set((state) => ({ compositions: [...state.compositions, comp] }));
    return comp;
  },

  duplicateComposition: (id: string) => {
    const original = get().compositions.find((c) => c.id === id);
    if (!original) return null;

    const duplicate: Composition = {
      ...original,
      id: generateId(),
      name: `${original.name} Copy`,
      createdAt: Date.now(),
    };

    set((state) => ({ compositions: [...state.compositions, duplicate] }));
    return duplicate;
  },

  removeComposition: (id: string) => {
    set((state) => {
      const newAssignments = { ...state.slotAssignments };
      delete newAssignments[id];
      return {
        compositions: state.compositions.filter((c) => c.id !== id),
        selectedIds: state.selectedIds.filter((sid) => sid !== id),
        activeCompositionId: state.activeCompositionId === id ? null : state.activeCompositionId,
        openCompositionIds: state.openCompositionIds.filter((cid) => cid !== id),
        slotAssignments: newAssignments,
      };
    });
  },

  updateComposition: (id: string, updates: Partial<Composition>) => {
    const oldComp = get().compositions.find((c) => c.id === id);
    if (!oldComp) {
      return;
    }

    const normalizedUpdates: Partial<Composition> = { ...updates };
    const previousDuration = oldComp.timelineData?.duration ?? oldComp.duration;
    const nextDuration = updates.duration !== undefined
      ? Math.max(1, updates.duration)
      : previousDuration;
    const durationChanged = updates.duration !== undefined && nextDuration !== previousDuration;

    if (oldComp && (updates.width !== undefined || updates.height !== undefined)) {
      const newW = updates.width ?? oldComp.width;
      const newH = updates.height ?? oldComp.height;
      if (newW !== oldComp.width || newH !== oldComp.height) {
        adjustClipTransformsOnResize(get, id, oldComp.width, oldComp.height, newW, newH, normalizedUpdates);
      }
    }

    if (durationChanged) {
      normalizedUpdates.duration = nextDuration;
      normalizedUpdates.timelineData = lockTimelineDuration(
        normalizedUpdates.timelineData ?? oldComp.timelineData,
        nextDuration
      );
    }

    set((state) => ({
      compositions: state.compositions.map((c) =>
        c.id === id
          ? { ...c, ...normalizedUpdates }
          : !durationChanged
            ? c
          : c.id === state.activeCompositionId
            ? c
            : {
                ...c,
                timelineData: durationChanged
                  ? syncTimelineDataNestedCompReferences(c.timelineData, id, previousDuration, nextDuration)
                  : c.timelineData,
              }
      ),
    }));

    if (durationChanged) {
      syncActiveTimelineNestedCompReferences(get().activeCompositionId, id, previousDuration, nextDuration);
      compositionRenderer.invalidateCompositionAndParents(id);
    }
  },

  setActiveComposition: (id: string | null) => {
    const { activeCompositionId, compositions } = get();
    doSetActiveComposition(set, get, activeCompositionId, id, compositions);
  },

  getActiveComposition: () => {
    const { compositions, activeCompositionId } = get();
    return compositions.find((c) => c.id === activeCompositionId);
  },

  openCompositionTab: (id: string, options?: CompositionSwitchOptions) => {
    const { openCompositionIds, activeCompositionId, compositions } = get();
    if (!openCompositionIds.includes(id)) {
      set({ openCompositionIds: [...openCompositionIds, id] });
    }
    // Same comp already active + playFromStart → just restart playback (no reload)
    if (id === activeCompositionId && options?.playFromStart) {
      const ts = useTimelineStore.getState();
      // Stop first to reset everything cleanly, then restart
      ts.pause();
      ts.setPlayheadPosition(0);
      // Reset the high-frequency playhead and audio master
      playheadState.position = 0;
      playheadState.hasMasterAudio = false;
      playheadState.masterAudioElement = null;
      playheadState.playbackJustStarted = true;
      // Seek all video/audio elements back to their in-points
      for (const clip of ts.clips) {
        if (clip.source?.videoElement) {
          clip.source.videoElement.currentTime = clip.inPoint;
        }
        if (clip.source?.audioElement) {
          clip.source.audioElement.currentTime = clip.inPoint;
        }
      }
      ts.play();
      return;
    }
    // Inline setActiveComposition logic
    doSetActiveComposition(set, get, activeCompositionId, id, compositions, options);
  },

  closeCompositionTab: (id: string) => {
    const { openCompositionIds, activeCompositionId, compositions } = get();
    const newOpenIds = openCompositionIds.filter((cid) => cid !== id);
    set({ openCompositionIds: newOpenIds });

    if (activeCompositionId === id && newOpenIds.length > 0) {
      const closedIndex = openCompositionIds.indexOf(id);
      const newActiveIndex = Math.min(closedIndex, newOpenIds.length - 1);
      doSetActiveComposition(set, get, activeCompositionId, newOpenIds[newActiveIndex], compositions);
    } else if (newOpenIds.length === 0) {
      doSetActiveComposition(set, get, activeCompositionId, null, compositions);
    }
  },

  getOpenCompositions: () => {
    const { compositions, openCompositionIds } = get();
    return openCompositionIds
      .map((id) => compositions.find((c) => c.id === id))
      .filter((c): c is Composition => c !== undefined);
  },

  reorderCompositionTabs: (fromIndex: number, toIndex: number) => {
    const { openCompositionIds } = get();
    if (fromIndex < 0 || fromIndex >= openCompositionIds.length) return;
    if (toIndex < 0 || toIndex >= openCompositionIds.length) return;
    if (fromIndex === toIndex) return;

    const newOrder = [...openCompositionIds];
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);
    set({ openCompositionIds: newOrder });
  },

  assignMediaFileToSlot: (mediaFileId: string, slotIndex: number) => {
    const { files } = get();
    const mediaFile = files.find(f => f.id === mediaFileId);
    if (!mediaFile) return;

    // Create composition from media file (inline createComposition logic)
    const { outputResolution } = useSettingsStore.getState();
    const nameWithoutExt = mediaFile.name.replace(/\.[^.]+$/, '');
    const comp: Composition = {
      id: generateId(),
      name: nameWithoutExt,
      type: 'composition',
      parentId: null,
      createdAt: Date.now(),
      width: mediaFile.width || outputResolution.width,
      height: mediaFile.height || outputResolution.height,
      frameRate: 30,
      duration: mediaFile.duration || 60,
      backgroundColor: '#000000',
    };
    set((state) => ({ compositions: [...state.compositions, comp] }));

    // Assign to slot (inline moveSlot logic)
    const { slotAssignments } = get();
    const newAssignments = { ...slotAssignments };
    for (const [id, idx] of Object.entries(newAssignments)) {
      if (idx === slotIndex && id !== comp.id) {
        delete newAssignments[id];
        break;
      }
    }
    newAssignments[comp.id] = slotIndex;
    set({ slotAssignments: newAssignments });

    // Open the composition tab (loads empty timeline)
    const { activeCompositionId, compositions } = get();
    if (!get().openCompositionIds.includes(comp.id)) {
      set({ openCompositionIds: [...get().openCompositionIds, comp.id] });
    }
    doSetActiveComposition(set, get, activeCompositionId, comp.id, compositions, { skipAnimation: true });

    // After short delay (let loadState settle for empty comp), add media as a clip
    // then flush timeline state back to composition so MiniTimeline shows correct preview
    setTimeout(async () => {
      const ts = useTimelineStore.getState();
      const videoTrack = ts.tracks.find(t => t.type === 'video');
      const audioTrack = ts.tracks.find(t => t.type === 'audio');

      if (mediaFile.file) {
        if ((mediaFile.type === 'video' || mediaFile.type === 'image') && videoTrack) {
          await ts.addClip(videoTrack.id, mediaFile.file, 0, mediaFile.duration, mediaFile.id);
        } else if (mediaFile.type === 'audio' && audioTrack) {
          await ts.addClip(audioTrack.id, mediaFile.file, 0, mediaFile.duration, mediaFile.id);
        }
      }

      // Save timeline state back to composition's timelineData for MiniTimeline preview
      const timelineData = useTimelineStore.getState().getSerializableState();
      set((state) => ({
        compositions: state.compositions.map((c) =>
          c.id === comp.id ? { ...c, timelineData } : c
        ),
      }));
    }, 100);
  },

  setPreviewComposition: (id: string | null) => {
    set({ previewCompositionId: id });
  },

  setSourceMonitorFile: (id: string | null) => {
    set({ sourceMonitorFileId: id });
  },

});

/**
 * Adjust clip transforms when a composition is resized so content stays at
 * the same pixel position (more canvas space around it, no scaling).
 *
 * Position is in normalized space (1.0 = full canvas). When canvas grows,
 * the same normalized position maps to a different pixel location.
 * Rescale position by oldRes/newRes to keep pixel coords stable.
 */
function adjustClipTransformsOnResize(
  get: () => MediaState,
  compId: string,
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
  updates: Partial<Composition>
): void {
  const scaleX = oldW / newW;
  const scaleY = oldH / newH;

  const { activeCompositionId } = get();

  if (compId === activeCompositionId) {
    // Active comp: modify live timeline store
    const timelineStore = useTimelineStore.getState();
    const { clips, clipKeyframes } = timelineStore;

    const updatedClips = clips.map(clip => ({
      ...clip,
      transform: {
        ...clip.transform,
        position: {
          x: clip.transform.position.x * scaleX,
          y: clip.transform.position.y * scaleY,
          z: clip.transform.position.z,
        },
        scale: {
          x: clip.transform.scale.x * scaleX,
          y: clip.transform.scale.y * scaleY,
        },
      },
    }));

    // Adjust keyframes for position and scale properties
    const updatedKeyframes = new Map<string, import('../../../types').Keyframe[]>();
    clipKeyframes.forEach((keyframes: import('../../../types').Keyframe[], clipId: string) => {
      updatedKeyframes.set(clipId, keyframes.map(kf => {
        if (kf.property === 'position.x' || kf.property === 'scale.x') {
          return { ...kf, value: kf.value * scaleX };
        }
        if (kf.property === 'position.y' || kf.property === 'scale.y') {
          return { ...kf, value: kf.value * scaleY };
        }
        return kf;
      }));
    });

    useTimelineStore.setState({ clips: updatedClips, clipKeyframes: updatedKeyframes });
  } else {
    // Non-active comp: modify serialized timelineData via the updates object
    // so the subsequent set() in updateComposition picks it up
    const comp = get().compositions.find(c => c.id === compId);
    if (!comp?.timelineData) return;

    const updatedClips = comp.timelineData.clips.map(clip => ({
      ...clip,
      transform: {
        ...clip.transform,
        position: {
          x: clip.transform.position.x * scaleX,
          y: clip.transform.position.y * scaleY,
          z: clip.transform.position.z,
        },
        scale: {
          x: clip.transform.scale.x * scaleX,
          y: clip.transform.scale.y * scaleY,
        },
      },
      keyframes: clip.keyframes?.map(kf => {
        if (kf.property === 'position.x' || kf.property === 'scale.x') {
          return { ...kf, value: kf.value * scaleX };
        }
        if (kf.property === 'position.y' || kf.property === 'scale.y') {
          return { ...kf, value: kf.value * scaleY };
        }
        return kf;
      }),
    }));

    // Fold adjusted timelineData into the updates object
    updates.timelineData = { ...comp.timelineData, clips: updatedClips };
  }
}

/**
 * Calculate synced playhead for nested composition navigation.
 */
function calculateSyncedPlayhead(
  fromCompId: string | null,
  toCompId: string | null,
  compositions: Composition[],
  timelineStore: ReturnType<typeof useTimelineStore.getState>
): number | null {
  if (!fromCompId || !toCompId) return null;

  const currentPlayhead = timelineStore.playheadPosition;
  const currentClips = timelineStore.clips;

  // Check if navigating into nested comp
  const nestedClip = currentClips.find(
    (c) => c.isComposition && c.compositionId === toCompId
  );
  if (nestedClip) {
    const clipStart = nestedClip.startTime;
    const clipEnd = clipStart + nestedClip.duration;
    const inPoint = nestedClip.inPoint || 0;

    if (currentPlayhead >= clipStart && currentPlayhead < clipEnd) {
      return (currentPlayhead - clipStart) + inPoint;
    }
  }

  // Check if navigating to parent comp
  const toComp = compositions.find((c) => c.id === toCompId);
  if (toComp?.timelineData?.clips) {
    const parentClip = toComp.timelineData.clips.find(
      (c: { isComposition?: boolean; compositionId?: string; startTime: number; inPoint?: number }) =>
        c.isComposition && c.compositionId === fromCompId
    );
    if (parentClip) {
      return parentClip.startTime + (currentPlayhead - (parentClip.inPoint || 0));
    }
  }

  return null;
}

/**
 * Internal helper to set active composition (avoids calling get().setActiveComposition).
 * Handles exit/enter animations for smooth transitions.
 */
function doSetActiveComposition(
  set: (partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => void,
  get: () => MediaState,
  currentActiveId: string | null,
  newId: string | null,
  compositions: Composition[],
  options?: CompositionSwitchOptions
): void {
  const timelineStore = useTimelineStore.getState();
  const skipAnimation = options?.skipAnimation ?? false;

  // Calculate synced playhead for nested composition navigation
  const syncedPlayhead = calculateSyncedPlayhead(
    currentActiveId,
    newId,
    compositions,
    timelineStore
  );

  // Save current timeline to current composition
  const savedCompId = currentActiveId;
  if (currentActiveId) {
    // Sync high-frequency playhead position back to store before serializing
    // (rAF loop updates playheadState.position but not the Zustand store)
    // Always sync — even when paused, playheadState.position has the most recent value
    timelineStore.setPlayheadPosition(playheadState.position);
    const timelineData = timelineStore.getSerializableState();
    set((state) => ({
      compositions: state.compositions.map((c) =>
        c.id === currentActiveId ? { ...c, timelineData } : c
      ),
    }));
    compositionRenderer.invalidateCompositionAndParents(currentActiveId);
  }

  if (skipAnimation) {
    // Skip exit/enter animations entirely
    finishCompositionSwitch(set, get, newId, savedCompId, syncedPlayhead, options);
    return;
  }

  // Trigger exit animation for current clips
  const hasExistingClips = timelineStore.clips.length > 0;
  if (hasExistingClips && newId !== currentActiveId) {
    // Set exit animation phase
    timelineStore.setClipAnimationPhase('exiting');

    // Wait for exit animation, then load new composition
    setTimeout(async () => {
      await finishCompositionSwitch(set, get, newId, savedCompId, syncedPlayhead, options);
    }, 350); // Exit animation duration
  } else {
    // No existing clips or same comp, load immediately
    finishCompositionSwitch(set, get, newId, savedCompId, syncedPlayhead, options);
  }
}

/**
 * Complete the composition switch after exit animation
 */
async function finishCompositionSwitch(
  set: (partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => void,
  get: () => MediaState,
  newId: string | null,
  savedCompId: string | null,
  syncedPlayhead: number | null,
  options?: CompositionSwitchOptions
): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  const skipAnimation = options?.skipAnimation ?? false;
  const playFromStart = options?.playFromStart ?? false;

  // Update active composition
  set({ activeCompositionId: newId });

  // Load new composition's timeline
  if (newId) {
    const freshCompositions = get().compositions;
    const newComp = freshCompositions.find((c) => c.id === newId);
    await timelineStore.loadState(newComp?.timelineData);

    if (playFromStart) {
      timelineStore.setPlayheadPosition(0);
      timelineStore.play();
    } else if (syncedPlayhead !== null && syncedPlayhead >= 0) {
      timelineStore.setPlayheadPosition(syncedPlayhead);
    }
    // zoom and scrollX are restored by loadState() from composition's timelineData

    // Refresh nested clips in the NEW timeline that reference the OLD composition
    // This ensures comp clips show updated content when source composition changes
    if (savedCompId) {
      timelineStore.refreshCompClipNestedData(savedCompId);
    }

    if (skipAnimation) {
      // Skip entrance animation — go straight to idle
      timelineStore.setClipAnimationPhase('idle');
    } else {
      // Trigger entrance animation for new clips
      timelineStore.setClipAnimationPhase('entering');

      // Reset to idle after entrance animation completes
      setTimeout(() => {
        timelineStore.setClipAnimationPhase('idle');
      }, 700); // Entrance animation duration (0.6s + buffer)
    }
  } else {
    timelineStore.clearTimeline();
    timelineStore.setClipAnimationPhase('idle');
  }
}
