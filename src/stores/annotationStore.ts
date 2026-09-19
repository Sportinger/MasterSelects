import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface SourceAnnotationPlaybackState {
  fileId: string;
  time: number;
  duration: number;
  fps: number;
}

export interface SourceAnnotationSeekRequest {
  id: number;
  fileId: string;
  time: number;
}

interface AnnotationState {
  rulerAnnotationsVisible: boolean;
  sourcePlayback: SourceAnnotationPlaybackState | null;
  sourceSeekRequest: SourceAnnotationSeekRequest | null;
  toggleRulerAnnotations: () => void;
  reportSourcePlayback: (playback: SourceAnnotationPlaybackState) => void;
  clearSourcePlayback: (fileId: string) => void;
  requestSourceSeek: (fileId: string, time: number) => void;
}

export const useAnnotationStore = create<AnnotationState>()(
  subscribeWithSelector((set) => ({
    rulerAnnotationsVisible: true,
    sourcePlayback: null,
    sourceSeekRequest: null,
    toggleRulerAnnotations: () => set((state) => ({
      rulerAnnotationsVisible: !state.rulerAnnotationsVisible,
    })),
    reportSourcePlayback: (playback) => set({ sourcePlayback: playback }),
    clearSourcePlayback: (fileId) => set((state) => (
      state.sourcePlayback?.fileId === fileId ? { sourcePlayback: null } : state
    )),
    requestSourceSeek: (fileId, time) => set((state) => ({
      sourceSeekRequest: {
        id: (state.sourceSeekRequest?.id ?? 0) + 1,
        fileId,
        time,
      },
    })),
  })),
);
