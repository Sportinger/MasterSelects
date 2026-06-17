import type { MediaSliceCreator } from '../../types';
import type { CompositionActions } from '../compositionSlice';

export const createCompositionMonitorActions: MediaSliceCreator<Pick<
  CompositionActions,
  | 'setPreviewComposition'
  | 'setSourceMonitorFile'
  | 'openSourceMonitorCrop'
  | 'setSourceMonitorInPoint'
  | 'setSourceMonitorOutPoint'
  | 'clearSourceMonitorInOut'
>> = (set) => ({
  setPreviewComposition: (id: string | null) => {
    set({ previewCompositionId: id });
  },

  setSourceMonitorFile: (id: string | null) => {
    set((state) => ({
      sourceMonitorFileId: id,
      sourceMonitorInPoint: null,
      sourceMonitorOutPoint: null,
      sourceMonitorPlaybackRequestId: id === null
        ? state.sourceMonitorPlaybackRequestId
        : state.sourceMonitorPlaybackRequestId + 1,
    }));
  },

  openSourceMonitorCrop: (id: string) => {
    set((state) => ({
      sourceMonitorFileId: id,
      sourceMonitorInPoint: null,
      sourceMonitorOutPoint: null,
      sourceMonitorPlaybackRequestId: state.sourceMonitorFileId === id
        ? state.sourceMonitorPlaybackRequestId
        : state.sourceMonitorPlaybackRequestId + 1,
      sourceMonitorCropRequestId: state.sourceMonitorCropRequestId + 1,
    }));
  },

  setSourceMonitorInPoint: (time: number | null) => {
    set((state) => {
      const inPoint = time === null ? null : Math.max(0, time);
      const outPoint = inPoint !== null && state.sourceMonitorOutPoint !== null
        ? Math.max(inPoint, state.sourceMonitorOutPoint)
        : state.sourceMonitorOutPoint;
      return {
        sourceMonitorInPoint: inPoint,
        sourceMonitorOutPoint: outPoint,
      };
    });
  },

  setSourceMonitorOutPoint: (time: number | null) => {
    set((state) => {
      const outPoint = time === null ? null : Math.max(0, time);
      const inPoint = outPoint !== null && state.sourceMonitorInPoint !== null
        ? Math.min(state.sourceMonitorInPoint, outPoint)
        : state.sourceMonitorInPoint;
      return {
        sourceMonitorInPoint: inPoint,
        sourceMonitorOutPoint: outPoint,
      };
    });
  },

  clearSourceMonitorInOut: () => {
    set({ sourceMonitorInPoint: null, sourceMonitorOutPoint: null });
  },
});
