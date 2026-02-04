// Engine state store - GPU/WebGPU status and stats
// Extracted from mixerStore during VJ mode removal

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { EngineStats } from '../types';

interface EngineState {
  // Engine status
  isEngineReady: boolean;
  engineStats: EngineStats;
  gpuInfo: { vendor: string; device: string; description: string } | null;
  linuxVulkanWarning: boolean;

  // Actions
  setEngineReady: (ready: boolean) => void;
  setEngineStats: (stats: EngineStats) => void;
  setGpuInfo: (info: { vendor: string; device: string; description: string } | null) => void;
  setLinuxVulkanWarning: (show: boolean) => void;
  dismissLinuxVulkanWarning: () => void;
}

// Check if Linux Vulkan warning was already dismissed
const LINUX_VULKAN_DISMISSED_KEY = 'linux-vulkan-warning-dismissed';

export const useEngineStore = create<EngineState>()(
  subscribeWithSelector((set) => ({
    // Initial state
    isEngineReady: false,
    gpuInfo: null,
    linuxVulkanWarning: false,
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
  }))
);
