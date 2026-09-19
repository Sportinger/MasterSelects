import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { renderHostPort } from '../services/render/renderHostPort';

export interface SplitCompareSettings {
  enabled: boolean;
  position: number;
  feather: number;
}

interface SplitCompareStore extends SplitCompareSettings {
  setEnabled: (enabled: boolean) => void;
  setPosition: (position: number) => void;
  setFeather: (feather: number) => void;
}

function requestPreview(): void {
  renderHostPort.requestRender();
}

export const useSplitCompareStore = create<SplitCompareStore>()(
  subscribeWithSelector((set) => ({
    enabled: false,
    position: 0.5,
    feather: 0.006,
    setEnabled: (enabled) => {
      set({ enabled });
      requestPreview();
    },
    setPosition: (position) => {
      set({ position: Math.min(0.98, Math.max(0.02, position)) });
      requestPreview();
    },
    setFeather: (feather) => {
      set({ feather: Math.min(0.05, Math.max(0, feather)) });
      requestPreview();
    },
  })),
);

export function getSplitCompareSettings(): SplitCompareSettings {
  const { enabled, position, feather } = useSplitCompareStore.getState();
  return { enabled, position, feather };
}
