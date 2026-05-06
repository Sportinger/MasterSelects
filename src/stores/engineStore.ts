// Engine state store - GPU/WebGPU status and stats
// Extracted from mixerStore during VJ mode removal

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { EngineStats } from '../types';
import type { SceneCameraConfig, SceneGizmoAxis, SceneGizmoMode } from '../engine/scene/types';

export interface SceneCameraLiveOverride {
  position?: Partial<{ x: number; y: number; z: number }>;
  scale?: Partial<{ all: number; x: number; y: number; z: number }>;
  rotation?: Partial<{ x: number; y: number; z: number }>;
}

export type GaussianSplatLoadPhase =
  | 'fetching'
  | 'reading'
  | 'parsing'
  | 'normalizing'
  | 'uploading'
  | 'complete'
  | 'error';

export interface GaussianSplatLoadProgressEntry {
  sceneKey: string;
  clipId?: string;
  fileName: string;
  phase: GaussianSplatLoadPhase;
  percent: number;
  loadedBytes?: number;
  totalBytes?: number;
  message?: string;
  updatedAt: number;
}

export type GaussianSplatLoadProgressUpdate = Omit<
  GaussianSplatLoadProgressEntry,
  'updatedAt' | 'percent'
> & {
  percent?: number;
};

interface EngineState {
  // Engine status
  isEngineReady: boolean;
  engineInitFailed: boolean;
  engineInitError: string | null;
  engineStats: EngineStats;
  gpuInfo: { vendor: string; device: string; description: string } | null;
  linuxVulkanWarning: boolean;
  sceneNavClipId: string | null;
  sceneNavFpsMode: boolean;
  sceneNavFpsMoveSpeed: number;
  sceneNavNoKeyframes: boolean;
  sceneCameraLiveOverrides: Record<string, SceneCameraLiveOverride>;
  previewCameraOverride: SceneCameraConfig | null;
  sceneGizmoVisible: boolean;
  sceneGizmoMode: SceneGizmoMode;
  sceneGizmoHoveredAxis: SceneGizmoAxis | null;
  sceneGizmoClipIdOverride: string | null;
  gaussianSplatLoadProgress: Record<string, GaussianSplatLoadProgressEntry>;

  // Actions
  setEngineReady: (ready: boolean) => void;
  setEngineInitFailed: (failed: boolean, error?: string) => void;
  setEngineStats: (stats: EngineStats) => void;
  setGpuInfo: (info: { vendor: string; device: string; description: string } | null) => void;
  setLinuxVulkanWarning: (show: boolean) => void;
  dismissLinuxVulkanWarning: () => void;
  setSceneNavClipId: (clipId: string | null) => void;
  setSceneNavFpsMode: (enabled: boolean) => void;
  setSceneNavFpsMoveSpeed: (speed: number) => void;
  setSceneNavNoKeyframes: (enabled: boolean) => void;
  setSceneCameraLiveOverride: (clipId: string, override: SceneCameraLiveOverride) => void;
  clearSceneCameraLiveOverride: (clipId: string) => void;
  clearSceneCameraLiveOverrides: () => void;
  setPreviewCameraOverride: (camera: SceneCameraConfig | null) => void;
  setSceneGizmoVisible: (visible: boolean) => void;
  setSceneGizmoMode: (mode: SceneGizmoMode) => void;
  setSceneGizmoHoveredAxis: (axis: SceneGizmoAxis | null) => void;
  setSceneGizmoClipIdOverride: (clipId: string | null) => void;
  setGaussianSplatLoadProgress: (progress: GaussianSplatLoadProgressUpdate) => void;
  clearGaussianSplatLoadProgress: (sceneKey: string) => void;
}

export const SCENE_NAV_FPS_MOVE_SPEED_STEPS = [
  0.1, 0.2, 0.3, 0.4, 0.5,
  0.6, 0.7, 0.8, 0.9, 1,
  1.5, 2, 3, 4, 5, 6, 7, 8,
] as const;

export function getSceneNavFpsMoveSpeedStepIndex(speed: number): number {
  const targetSpeed = Number.isFinite(speed) ? speed : 1;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < SCENE_NAV_FPS_MOVE_SPEED_STEPS.length; i += 1) {
    const distance = Math.abs(SCENE_NAV_FPS_MOVE_SPEED_STEPS[i] - targetSpeed);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = i;
    }
  }

  return nearestIndex;
}

export function snapSceneNavFpsMoveSpeed(speed: number): number {
  return SCENE_NAV_FPS_MOVE_SPEED_STEPS[getSceneNavFpsMoveSpeedStepIndex(speed)] ?? 1;
}

export function stepSceneNavFpsMoveSpeed(speed: number, direction: -1 | 1): number {
  const currentIndex = getSceneNavFpsMoveSpeedStepIndex(speed);
  const nextIndex = Math.max(
    0,
    Math.min(SCENE_NAV_FPS_MOVE_SPEED_STEPS.length - 1, currentIndex + direction),
  );
  return SCENE_NAV_FPS_MOVE_SPEED_STEPS[nextIndex] ?? 1;
}

function clampProgressPercent(percent: number | undefined): number {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    return 0;
  }
  return Math.max(0, Math.min(1, percent));
}

export function selectSceneNavClipId(
  state: Pick<EngineState, 'sceneNavClipId'>,
): string | null {
  return state.sceneNavClipId ?? null;
}

export function selectSceneNavFpsMode(
  state: Pick<EngineState, 'sceneNavFpsMode'>,
): boolean {
  return state.sceneNavFpsMode ?? false;
}

export function selectSceneNavFpsMoveSpeed(
  state: Pick<EngineState, 'sceneNavFpsMoveSpeed'>,
): number {
  return state.sceneNavFpsMoveSpeed ?? 1;
}

export function selectSceneNavNoKeyframes(
  state: Pick<EngineState, 'sceneNavNoKeyframes'>,
): boolean {
  return state.sceneNavNoKeyframes ?? false;
}

export function selectActiveGaussianSplatLoadProgress(
  state: Pick<EngineState, 'gaussianSplatLoadProgress'>,
): GaussianSplatLoadProgressEntry | null {
  const entries = Object.values(state.gaussianSplatLoadProgress ?? {});
  if (entries.length === 0) {
    return null;
  }

  return entries.toSorted((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
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
    sceneNavClipId: null,
    sceneNavFpsMode: false,
    sceneNavFpsMoveSpeed: 1,
    sceneNavNoKeyframes: false,
    sceneCameraLiveOverrides: {},
    previewCameraOverride: null,
    sceneGizmoVisible: true,
    sceneGizmoMode: 'move',
    sceneGizmoHoveredAxis: null,
    sceneGizmoClipIdOverride: null,
    gaussianSplatLoadProgress: {},
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

    setSceneNavClipId: (clipId: string | null) => {
      set({ sceneNavClipId: clipId });
    },

    setSceneNavFpsMode: (enabled: boolean) => {
      set({ sceneNavFpsMode: enabled });
    },

    setSceneNavFpsMoveSpeed: (speed: number) => {
      set({ sceneNavFpsMoveSpeed: snapSceneNavFpsMoveSpeed(speed) });
    },

    setSceneNavNoKeyframes: (enabled: boolean) => {
      set({
        sceneNavNoKeyframes: enabled,
        ...(!enabled ? { sceneCameraLiveOverrides: {} } : {}),
      });
    },

    setSceneCameraLiveOverride: (clipId: string, override: SceneCameraLiveOverride) => {
      set((state) => ({
        sceneCameraLiveOverrides: {
          ...state.sceneCameraLiveOverrides,
          [clipId]: {
            position: {
              ...(state.sceneCameraLiveOverrides[clipId]?.position ?? {}),
              ...(override.position ?? {}),
            },
            scale: {
              ...(state.sceneCameraLiveOverrides[clipId]?.scale ?? {}),
              ...(override.scale ?? {}),
            },
            rotation: {
              ...(state.sceneCameraLiveOverrides[clipId]?.rotation ?? {}),
              ...(override.rotation ?? {}),
            },
          },
        },
      }));
    },

    clearSceneCameraLiveOverride: (clipId: string) => {
      set((state) => {
        if (!state.sceneCameraLiveOverrides[clipId]) {
          return {};
        }

        const nextOverrides = { ...state.sceneCameraLiveOverrides };
        delete nextOverrides[clipId];
        return { sceneCameraLiveOverrides: nextOverrides };
      });
    },

    clearSceneCameraLiveOverrides: () => {
      set({ sceneCameraLiveOverrides: {} });
    },

    setPreviewCameraOverride: (camera: SceneCameraConfig | null) => {
      set({ previewCameraOverride: camera });
    },

    setSceneGizmoVisible: (visible: boolean) => {
      set({
        sceneGizmoVisible: visible,
        ...(!visible ? { sceneGizmoHoveredAxis: null } : {}),
      });
    },

    setSceneGizmoMode: (mode: SceneGizmoMode) => {
      set({ sceneGizmoMode: mode });
    },

    setSceneGizmoHoveredAxis: (axis: SceneGizmoAxis | null) => {
      set({ sceneGizmoHoveredAxis: axis });
    },

    setSceneGizmoClipIdOverride: (clipId: string | null) => {
      set({ sceneGizmoClipIdOverride: clipId });
    },

    setGaussianSplatLoadProgress: (progress: GaussianSplatLoadProgressUpdate) => {
      set((state) => {
        const previous = state.gaussianSplatLoadProgress[progress.sceneKey];
        const nextPercent = Math.max(
          previous?.percent ?? 0,
          clampProgressPercent(progress.percent),
        );
        return {
          gaussianSplatLoadProgress: {
            ...state.gaussianSplatLoadProgress,
            [progress.sceneKey]: {
              ...previous,
              ...progress,
              percent: nextPercent,
              updatedAt: Date.now(),
            },
          },
        };
      });
    },

    clearGaussianSplatLoadProgress: (sceneKey: string) => {
      set((state) => {
        if (!state.gaussianSplatLoadProgress[sceneKey]) {
          return {};
        }
        const remaining = { ...state.gaussianSplatLoadProgress };
        delete remaining[sceneKey];
        return { gaussianSplatLoadProgress: remaining };
      });
    },
  }))
);
