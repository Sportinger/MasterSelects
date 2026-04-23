import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import type {
  MIDIDeviceInfo,
  MIDILastMessage,
  MIDILearnTarget,
  MIDINoteBinding,
  MIDITransportAction,
} from '../types/midi';

type MIDIConnectionStatus = 'idle' | 'requesting' | 'connected' | 'error';

type MIDITransportBindings = Record<MIDITransportAction, MIDINoteBinding | null>;

interface MIDIStoreState {
  isSupported: boolean;
  isEnabled: boolean;
  connectionStatus: MIDIConnectionStatus;
  connectionError: string | null;
  devices: MIDIDeviceInfo[];
  lastMessage: MIDILastMessage | null;
  learnTarget: MIDILearnTarget | null;
  transportBindings: MIDITransportBindings;
  setSupported: (supported: boolean) => void;
  setEnabled: (enabled: boolean) => void;
  setConnectionStatus: (status: MIDIConnectionStatus, error?: string | null) => void;
  setDevices: (devices: MIDIDeviceInfo[]) => void;
  setLastMessage: (message: MIDILastMessage | null) => void;
  setTransportBinding: (action: MIDITransportAction, binding: MIDINoteBinding | null) => void;
  startLearning: (target: MIDILearnTarget) => void;
  cancelLearning: () => void;
  resetRuntimeState: () => void;
}

const initialTransportBindings: MIDITransportBindings = {
  playPause: null,
  stop: null,
};

export const useMIDIStore = create<MIDIStoreState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        isSupported: false,
        isEnabled: false,
        connectionStatus: 'idle',
        connectionError: null,
        devices: [],
        lastMessage: null,
        learnTarget: null,
        transportBindings: initialTransportBindings,
        setSupported: (isSupported) => set({ isSupported }),
        setEnabled: (isEnabled) => set({ isEnabled }),
        setConnectionStatus: (connectionStatus, connectionError = null) =>
          set({ connectionStatus, connectionError }),
        setDevices: (devices) => set({ devices }),
        setLastMessage: (lastMessage) => set({ lastMessage }),
        setTransportBinding: (action, binding) =>
          set((state) => ({
            transportBindings: {
              ...state.transportBindings,
              [action]: binding,
            },
          })),
        startLearning: (learnTarget) => set({ learnTarget }),
        cancelLearning: () => set({ learnTarget: null }),
        resetRuntimeState: () =>
          set({
            connectionStatus: 'idle',
            connectionError: null,
            devices: [],
            lastMessage: null,
            learnTarget: null,
          }),
      }),
      {
        name: 'masterselects-midi',
        partialize: (state) => ({
          isEnabled: state.isEnabled,
          transportBindings: state.transportBindings,
        }),
      }
    )
  )
);
