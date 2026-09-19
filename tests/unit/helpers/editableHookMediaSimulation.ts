// Media-store simulation for editable-hook tests. Hooks are wrapped in their own
// named subcomposition, so tests need a media store that can create
// compositions and switch the active composition tab (persisting the parent
// timeline and loading the nested one) on top of the global mediaStore mock.

import { vi } from 'vitest';
import { useMediaStore, type Composition } from '../../../src/stores/mediaStore';
import { useTimelineStore } from '../../../src/stores/timeline';
import type { TimelineClip } from '../../../src/types/timeline';

type MediaState = ReturnType<typeof useMediaStore.getState>;

export interface EditableHookMediaSimulation {
  /** All clips of a hook, whether they live in the active timeline or a stored composition. */
  getHookClips(hookId: string): TimelineClip[];
  getState(): MediaState;
  /** Activates the composition that contains the hook so its clips are in the timeline store. */
  openHookComposition(hookId: string): Promise<void>;
  restore(): void;
}

export function installEditableHookMediaSimulation(
  root: Composition,
  extra: Partial<MediaState> = {},
): EditableHookMediaSimulation {
  const initialMediaState = useMediaStore.getState();
  let compositionSequence = 0;
  let mediaState: MediaState;

  const setMediaState = (update: unknown) => {
    const partial = typeof update === 'function'
      ? (update as (state: MediaState) => Partial<MediaState>)(mediaState)
      : update as Partial<MediaState>;
    mediaState = { ...mediaState, ...partial };
  };
  const createComposition = (name: string, settings?: Partial<Composition>): Composition => {
    compositionSequence += 1;
    const created: Composition = {
      id: `hook-subcomposition-${compositionSequence}`,
      name,
      type: 'composition',
      parentId: settings?.parentId ?? null,
      createdAt: compositionSequence + 1,
      width: settings?.width ?? root.width,
      height: settings?.height ?? root.height,
      frameRate: settings?.frameRate ?? root.frameRate,
      duration: settings?.duration ?? root.duration,
      backgroundColor: settings?.backgroundColor ?? root.backgroundColor,
      timelineData: settings?.timelineData,
    };
    mediaState = { ...mediaState, compositions: [...mediaState.compositions, created] };
    return created;
  };
  const openCompositionTab = async (id: string) => {
    const currentId = mediaState.activeCompositionId;
    if (currentId && currentId !== id) {
      const timelineData = useTimelineStore.getState().getSerializableState();
      mediaState = {
        ...mediaState,
        compositions: mediaState.compositions.map((candidate) => (
          candidate.id === currentId ? { ...candidate, timelineData } : candidate
        )),
      };
    }
    const target = mediaState.compositions.find((candidate) => candidate.id === id);
    if (!target) throw new Error(`Composition not found: ${id}`);
    mediaState = {
      ...mediaState,
      activeCompositionId: id,
      openCompositionIds: mediaState.openCompositionIds.includes(id)
        ? mediaState.openCompositionIds
        : [...mediaState.openCompositionIds, id],
    };
    await useTimelineStore.getState().loadState(target.timelineData);
  };

  mediaState = {
    ...initialMediaState,
    ...extra,
    compositions: [root],
    activeCompositionId: root.id,
    openCompositionIds: [root.id],
    createComposition,
    openCompositionTab,
  } as MediaState;
  mediaState.getActiveComposition = () => (
    mediaState.compositions.find((candidate) => candidate.id === mediaState.activeCompositionId) ?? null
  );

  vi.mocked(useMediaStore.getState).mockImplementation(() => mediaState);
  vi.mocked(useMediaStore.setState).mockImplementation(setMediaState as never);
  vi.mocked(useMediaStore).mockImplementation(((selector: (state: MediaState) => unknown) => (
    selector(mediaState)
  )) as typeof useMediaStore);

  return {
    getHookClips(hookId) {
      for (const composition of mediaState.compositions) {
        const clips = composition.id === mediaState.activeCompositionId
          ? useTimelineStore.getState().clips
          : (composition.timelineData?.clips as TimelineClip[] | undefined) ?? [];
        const matches = clips.filter((clip) => clip.editableHook?.id === hookId);
        if (matches.length > 0) return matches;
      }
      return [];
    },
    getState: () => mediaState,
    async openHookComposition(hookId) {
      if (useTimelineStore.getState().clips.some((clip) => clip.editableHook?.id === hookId)) return;
      const composition = mediaState.compositions.find((candidate) => (
        candidate.timelineData?.clips.some((clip) => clip.editableHook?.id === hookId)
      ));
      if (!composition) throw new Error(`Hook composition not found: ${hookId}`);
      await openCompositionTab(composition.id);
    },
    restore() {
      vi.mocked(useMediaStore.getState).mockReturnValue(initialMediaState);
      vi.mocked(useMediaStore.setState).mockReset();
    },
  };
}
