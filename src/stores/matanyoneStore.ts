// Zustand store for MatAnyone2 video matting state

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type MatAnyoneSetupStatus =
  | 'not-checked'
  | 'not-available'      // Native helper not connected
  | 'not-installed'      // Not set up yet
  | 'installing'         // Setup in progress
  | 'model-needed'       // Deps installed but no model
  | 'downloading-model'  // Model download in progress
  | 'installed'          // Ready but server not running
  | 'starting'           // Server starting
  | 'ready'              // Server running, can accept jobs
  | 'error';

interface MatAnyoneState {
  // Setup
  setupStatus: MatAnyoneSetupStatus;
  setupProgress: number;
  setupStep: string | null;
  setupLog: string[];
  errorMessage: string | null;

  // Environment info (from status check)
  pythonVersion: string | null;
  cudaAvailable: boolean;
  cudaVersion: string | null;
  gpuName: string | null;
  vramMb: number | null;
  modelDownloaded: boolean;

  // Job state
  isProcessing: boolean;
  jobId: string | null;
  jobProgress: number;
  currentFrame: number;
  totalFrames: number;

  // Results
  lastResult: {
    foregroundPath: string;
    alphaPath: string;
    sourceClipId: string;
  } | null;
}

interface MatAnyoneActions {
  setSetupStatus: (status: MatAnyoneSetupStatus) => void;
  setSetupProgress: (progress: number, step?: string, message?: string) => void;
  appendSetupLog: (line: string) => void;
  clearSetupLog: () => void;
  setError: (message: string | null) => void;
  setEnvInfo: (info: Partial<Pick<MatAnyoneState, 'pythonVersion' | 'cudaAvailable' | 'cudaVersion' | 'gpuName' | 'vramMb' | 'modelDownloaded'>>) => void;
  setJobState: (state: Partial<Pick<MatAnyoneState, 'isProcessing' | 'jobId' | 'jobProgress' | 'currentFrame' | 'totalFrames'>>) => void;
  setLastResult: (result: MatAnyoneState['lastResult']) => void;
  reset: () => void;
}

const initialState: MatAnyoneState = {
  setupStatus: 'not-checked',
  setupProgress: 0,
  setupStep: null,
  setupLog: [],
  errorMessage: null,

  pythonVersion: null,
  cudaAvailable: false,
  cudaVersion: null,
  gpuName: null,
  vramMb: null,
  modelDownloaded: false,

  isProcessing: false,
  jobId: null,
  jobProgress: 0,
  currentFrame: 0,
  totalFrames: 0,

  lastResult: null,
};

export const useMatAnyoneStore = create<MatAnyoneState & MatAnyoneActions>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // Setup actions
    setSetupStatus: (status) => set({
      setupStatus: status,
      errorMessage: status === 'error' ? get().errorMessage : null,
    }),

    setSetupProgress: (progress, step, message) => {
      const updates: Partial<MatAnyoneState> = { setupProgress: progress };
      if (step !== undefined) updates.setupStep = step;
      if (message !== undefined) {
        updates.setupLog = [...get().setupLog, message];
      }
      set(updates);
    },

    appendSetupLog: (line) => set((state) => ({
      setupLog: [...state.setupLog, line],
    })),

    clearSetupLog: () => set({ setupLog: [] }),

    setError: (message) => set({
      errorMessage: message,
      setupStatus: message ? 'error' : get().setupStatus,
    }),

    setEnvInfo: (info) => set(info),

    setJobState: (state) => set(state),

    setLastResult: (result) => set({ lastResult: result }),

    // Reset
    reset: () => set({ ...initialState }),
  }))
);
