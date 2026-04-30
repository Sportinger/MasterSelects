import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import type {
  MIDIDeviceInfo,
  MIDILastMessage,
  MIDILearnTarget,
  MIDINoteBinding,
  MIDIParameterBinding,
  MIDIParameterBindings,
  MIDITransportAction,
} from '../types/midi';

type MIDIConnectionStatus = 'idle' | 'requesting' | 'connected' | 'error';

type MIDITransportBindings = Record<MIDITransportAction, MIDINoteBinding | null>;
type MIDISlotBindings = Record<number, MIDINoteBinding | null>;

interface MIDIStoreState {
  isSupported: boolean;
  isEnabled: boolean;
  connectionStatus: MIDIConnectionStatus;
  connectionError: string | null;
  devices: MIDIDeviceInfo[];
  lastMessage: MIDILastMessage | null;
  learnTarget: MIDILearnTarget | null;
  transportBindings: MIDITransportBindings;
  slotBindings: MIDISlotBindings;
  parameterBindings: MIDIParameterBindings;
  activeMappingIds: Record<string, number>;
  setSupported: (supported: boolean) => void;
  setEnabled: (enabled: boolean) => void;
  setConnectionStatus: (status: MIDIConnectionStatus, error?: string | null) => void;
  setDevices: (devices: MIDIDeviceInfo[]) => void;
  setLastMessage: (message: MIDILastMessage | null) => void;
  setTransportBinding: (action: MIDITransportAction, binding: MIDINoteBinding | null) => void;
  setSlotBinding: (slotIndex: number, binding: MIDINoteBinding | null) => void;
  setParameterBinding: (binding: MIDIParameterBinding) => void;
  removeParameterBinding: (bindingId: string) => void;
  markMappingActive: (mappingId: string, activatedAt?: number) => void;
  clearActiveMapping: (mappingId: string, activatedAt?: number) => void;
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
        slotBindings: {},
        parameterBindings: {},
        activeMappingIds: {},
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
        setSlotBinding: (slotIndex, binding) =>
          set((state) => {
            const nextBindings = { ...state.slotBindings };
            if (binding) {
              nextBindings[slotIndex] = binding;
            } else {
              delete nextBindings[slotIndex];
            }
            return { slotBindings: nextBindings };
          }),
        setParameterBinding: (binding) =>
          set((state) => ({
            parameterBindings: {
              ...state.parameterBindings,
              [binding.id]: binding,
            },
          })),
        removeParameterBinding: (bindingId) =>
          set((state) => {
            if (!state.parameterBindings[bindingId]) {
              return {};
            }
            const nextBindings = { ...state.parameterBindings };
            delete nextBindings[bindingId];
            return { parameterBindings: nextBindings };
          }),
        markMappingActive: (mappingId, activatedAt = Date.now()) =>
          set((state) => ({
            activeMappingIds: {
              ...state.activeMappingIds,
              [mappingId]: activatedAt,
            },
          })),
        clearActiveMapping: (mappingId, activatedAt) =>
          set((state) => {
            const currentActivatedAt = state.activeMappingIds[mappingId];
            if (currentActivatedAt === undefined) {
              return {};
            }

            if (activatedAt !== undefined && currentActivatedAt !== activatedAt) {
              return {};
            }

            const nextActiveMappingIds = { ...state.activeMappingIds };
            delete nextActiveMappingIds[mappingId];
            return { activeMappingIds: nextActiveMappingIds };
          }),
        startLearning: (learnTarget) => set({ learnTarget }),
        cancelLearning: () => set({ learnTarget: null }),
        resetRuntimeState: () =>
          set({
            connectionStatus: 'idle',
            connectionError: null,
            devices: [],
            lastMessage: null,
            learnTarget: null,
            activeMappingIds: {},
          }),
      }),
      {
        name: 'masterselects-midi',
        partialize: (state) => ({
          isEnabled: state.isEnabled,
          transportBindings: state.transportBindings,
          slotBindings: state.slotBindings,
          parameterBindings: state.parameterBindings,
        }),
      }
    )
  )
);
