// Engine state store - GPU/WebGPU status and stats
// Extracted from mixerStore during VJ mode removal

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { EngineStats } from '../types';

interface EngineState {
  // Engine status
  isEngineReady: boolean;
  engineInitFailed: boolean;
  engineInitError: string | null;
  engineStats: EngineStats;
  gpuInfo: { vendor: string; device: string; description: string } | null;
  linuxVulkanWarning: boolean;
  gaussianSplatNavClipId: string | null;
  gaussianSplatNavFpsMode: boolean;

  // Actions
  setEngineReady: (ready: boolean) => void;
  setEngineInitFailed: (failed: boolean, error?: string) => void;
  setEngineStats: (stats: EngineStats) => void;
  setGpuInfo: (info: { vendor: string; device: string; description: string } | null) => void;
  setLinuxVulkanWarning: (show: boolean) => void;
  dismissLinuxVulkanWarning: () => void;
  setGaussianSplatNavClipId: (clipId: string | null) => void;
  setGaussianSplatNavFpsMode: (enabled: boolean) => void;
}

// Check if Linux Vulkan warning was already dismissed
const LINUX_VULKAN_DISMISSED_KEY = 'linux-vulkan-warning-dismissed';

export const useEngineStore = create<EngineState>()(
  subscribeWithSelector((set) => ({
    // Initial state
    isEngineReady: false,
    engineInitFailed: false,
    engineInitError: null,
    gpuInfo: null,
    linuxVulkanWarning: false,
    gaussianSplatNavClipId: null,
    gaussianSplatNavFpsMode: false,
    engineStats: {
      fps: 0,
      frameTime: 0,
      gpuMemory: 0,
      timing: { rafGap: 0, importTexture: 0, renderPass: 0, submit: 0, total: 0 },
      drops: { count: 0, lastSecond: 0, reason: 'none' },
      layerCount: 0,
      targetFps: 60,
      decoder: 'none',
      audio: { playing: 0, drift: 0, status: 'silent' },
      isIdle: false,
    },

    // Actions
    setEngineReady: (ready: boolean) => {
      set({ isEngineReady: ready });
    },

    setEngineInitFailed: (failed: boolean, error?: string) => {
      set({ engineInitFailed: failed, engineInitError: error ?? null });
    },

    setGpuInfo: (info: { vendor: string; device: string; description: string } | null) => {
      set({ gpuInfo: info });
    },

    setEngineStats: (stats: EngineStats) => {
      set({ engineStats: stats });
    },

    setLinuxVulkanWarning: (show: boolean) => {
      // Don't show if already dismissed
      if (show && localStorage.getItem(LINUX_VULKAN_DISMISSED_KEY)) {
        return;
      }
      set({ linuxVulkanWarning: show });
    },

    dismissLinuxVulkanWarning: () => {
      localStorage.setItem(LINUX_VULKAN_DISMISSED_KEY, 'true');
      set({ linuxVulkanWarning: false });
    },

    setGaussianSplatNavClipId: (clipId: string | null) => {
      set({ gaussianSplatNavClipId: clipId });
    },

    setGaussianSplatNavFpsMode: (enabled: boolean) => {
      set({ gaussianSplatNavFpsMode: enabled });
    },
  }))
);
