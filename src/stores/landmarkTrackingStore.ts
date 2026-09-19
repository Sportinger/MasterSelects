import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { LandmarkSeries } from '../services/landmarkTracking/types';

export interface LandmarkTrackingSummary {
  status: 'idle' | 'loading' | 'tracking' | 'ready' | 'error';
  progress: number;
  frameCount: number;
  message?: string;
}

interface LandmarkTrackingStore {
  faceOverlay: Record<string, boolean>;
  faceSmoothing: number;
  setFaceOverlay: (clipId: string, visible: boolean) => void;
  setFaceSmoothing: (value: number) => void;
  summaries: Record<string, LandmarkTrackingSummary>;
  setSummary: (clipId: string, summary: Partial<LandmarkTrackingSummary>) => void;
  setReady: (series: LandmarkSeries) => void;
}

const EMPTY: LandmarkTrackingSummary = { status: 'idle', progress: 0, frameCount: 0 };

export const useLandmarkTrackingStore = create<LandmarkTrackingStore>()(
  subscribeWithSelector((set) => ({
    faceOverlay: {},
    faceSmoothing: 0,
    setFaceOverlay: (clipId, visible) => set(state => ({ faceOverlay: { ...state.faceOverlay, [clipId]: visible } })),
    setFaceSmoothing: (value) => set({ faceSmoothing: Math.max(0, Math.min(1, value)) }),
    summaries: {},
    setSummary: (clipId, summary) => set((state) => ({
      summaries: { ...state.summaries, [clipId]: { ...(state.summaries[clipId] ?? EMPTY), ...summary } },
    })),
    setReady: (series) => set((state) => ({
      summaries: {
        ...state.summaries,
        [series.clipId]: { status: 'ready', progress: 1, frameCount: series.frames.length },
      },
    })),
  })),
);
