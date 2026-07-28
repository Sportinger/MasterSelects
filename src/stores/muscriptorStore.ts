import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  MuscriptorDevice,
  MuscriptorModelVariant,
} from '../services/nativeHelper/protocol';

export type MuscriptorSetupStatus =
  | 'not-checked'
  | 'not-available'
  | 'not-installed'
  | 'installing'
  | 'model-needed'
  | 'downloading-model'
  | 'installed'
  | 'starting'
  | 'ready'
  | 'error';

export interface MuscriptorState {
  setupStatus: MuscriptorSetupStatus;
  setupProgress: number;
  setupStep: string | null;
  setupLog: string[];
  errorMessage: string | null;
  variant: MuscriptorModelVariant;
  device: MuscriptorDevice;
  instruments: string[];
  availableInstruments: string[];
  modelsDownloaded: MuscriptorModelVariant[];
  pythonVersion: string | null;
  cudaAvailable: boolean;
  cudaVersion: string | null;
  gpuName: string | null;
  vramMb: number | null;
  serverPort: number | null;
  isProcessing: boolean;
  jobId: string | null;
  jobProgress: number;
  noteCount: number;
}

export interface MuscriptorActions {
  setSetupStatus(status: MuscriptorSetupStatus): void;
  setSetupProgress(progress: number, step?: string, message?: string): void;
  clearSetupLog(): void;
  setError(message: string | null): void;
  setVariant(variant: MuscriptorModelVariant): void;
  setDevice(device: MuscriptorDevice): void;
  setInstruments(instruments: readonly string[]): void;
  setEnvironment(info: Partial<Pick<MuscriptorState,
    | 'availableInstruments'
    | 'modelsDownloaded'
    | 'pythonVersion'
    | 'cudaAvailable'
    | 'cudaVersion'
    | 'gpuName'
    | 'vramMb'
    | 'serverPort'
  >>): void;
  setJobState(state: Partial<Pick<MuscriptorState,
    'isProcessing' | 'jobId' | 'jobProgress' | 'noteCount'
  >>): void;
  reset(): void;
}

export type MuscriptorStore = MuscriptorState & MuscriptorActions;

function createInitialState(): MuscriptorState {
  return {
    setupStatus: 'not-checked',
    setupProgress: 0,
    setupStep: null,
    setupLog: [],
    errorMessage: null,
    variant: 'small',
    device: 'auto',
    instruments: [],
    availableInstruments: [],
    modelsDownloaded: [],
    pythonVersion: null,
    cudaAvailable: false,
    cudaVersion: null,
    gpuName: null,
    vramMb: null,
    serverPort: null,
    isProcessing: false,
    jobId: null,
    jobProgress: 0,
    noteCount: 0,
  };
}

export function createMuscriptorStore() {
  return create<MuscriptorStore>()(
    subscribeWithSelector((set, get) => ({
      ...createInitialState(),
      setSetupStatus: (setupStatus) => set({
        setupStatus,
        errorMessage: setupStatus === 'error' ? get().errorMessage : null,
      }),
      setSetupProgress: (setupProgress, setupStep, message) => set((state) => ({
        setupProgress: Number.isFinite(setupProgress)
          ? Math.max(0, Math.min(100, setupProgress))
          : state.setupProgress,
        ...(setupStep !== undefined ? { setupStep } : {}),
        ...(message ? { setupLog: [...state.setupLog, message] } : {}),
      })),
      clearSetupLog: () => set({ setupLog: [] }),
      setError: (errorMessage) => set({ errorMessage }),
      setVariant: (variant) => set({ variant }),
      setDevice: (device) => set({ device }),
      setInstruments: (instruments) => set({
        instruments: [...new Set(instruments.map(value => value.trim()).filter(Boolean))],
      }),
      setEnvironment: (info) => set({
        ...info,
        ...(info.availableInstruments ? { availableInstruments: [...info.availableInstruments] } : {}),
        ...(info.modelsDownloaded ? { modelsDownloaded: [...info.modelsDownloaded] } : {}),
      }),
      setJobState: (state) => set({
        ...state,
        ...(state.jobProgress !== undefined ? {
          jobProgress: Number.isFinite(state.jobProgress)
            ? Math.max(0, Math.min(100, state.jobProgress))
            : 0,
        } : {}),
        ...(state.noteCount !== undefined ? {
          noteCount: Number.isFinite(state.noteCount)
            ? Math.max(0, Math.round(state.noteCount))
            : 0,
        } : {}),
      }),
      reset: () => set(createInitialState()),
    })),
  );
}

type MuscriptorStoreApi = ReturnType<typeof createMuscriptorStore>;
const existingStore = import.meta.hot?.data?.muscriptorStore as MuscriptorStoreApi | undefined;

export const useMuscriptorStore = existingStore ?? createMuscriptorStore();

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    data.muscriptorStore = useMuscriptorStore;
  });
}
