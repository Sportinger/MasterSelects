import type { Composition, MediaSliceCreator, SlotDeckState } from '../../types';
import { useSettingsStore } from '../../../settingsStore';
import { useTimelineStore } from '../../../timeline';
import { flags } from '../../../../engine/featureFlags';
import { generateId } from '../../helpers/importPipeline';
import type { CompositionActions } from '../compositionSlice';
import { createWarmingSlotDeckState, resolveSlotDeckManager } from './slotDeckManager';
import { doSetActiveComposition } from './timelineSwitchBridge';

export const createCompositionSlotAssignmentActions: MediaSliceCreator<Pick<
  CompositionActions,
  'assignMediaFileToSlot'
>> = (set, get) => ({
  assignMediaFileToSlot: (mediaFileId: string, slotIndex: number) => {
    const { files } = get();
    const mediaFile = files.find(f => f.id === mediaFileId);
    if (!mediaFile) return;

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
    set((state) => ({
      compositions: [...state.compositions, comp],
      slotClipSettings: {
        ...state.slotClipSettings,
        [comp.id]: {
          trimIn: 0,
          trimOut: Math.max(mediaFile.duration || comp.duration || 60, 0.05),
          endBehavior: 'loop',
        },
      },
    }));

    const { slotAssignments } = get();
    const newAssignments = { ...slotAssignments };
    let displacedCompId: string | null = null;
    for (const [id, idx] of Object.entries(newAssignments)) {
      if (idx === slotIndex && id !== comp.id) {
        displacedCompId = id;
        delete newAssignments[id];
        break;
      }
    }
    newAssignments[comp.id] = slotIndex;
    set({ slotAssignments: newAssignments });

    if (flags.useWarmSlotDecks) {
      const setSlotDeckState = get().setSlotDeckState as
        | ((slotIndex: number, next: SlotDeckState) => void)
        | undefined;
      if (displacedCompId) {
        resolveSlotDeckManager()?.disposeSlot(slotIndex);
      }
      setSlotDeckState?.(slotIndex, createWarmingSlotDeckState(slotIndex, comp.id));
      resolveSlotDeckManager()?.prepareSlot(slotIndex, comp.id);
    }

    const { activeCompositionId, compositions } = get();
    if (!get().openCompositionIds.includes(comp.id)) {
      set({ openCompositionIds: [...get().openCompositionIds, comp.id] });
    }
    doSetActiveComposition(set, get, activeCompositionId, comp.id, compositions, { skipAnimation: true });

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

      const timelineData = useTimelineStore.getState().getSerializableState();
      set((state) => ({
        compositions: state.compositions.map((c) =>
          c.id === comp.id
            ? { ...c, duration: timelineData.duration, timelineData }
            : c
        ),
      }));
    }, 100);
  },
});
