import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { isHelperReachable } from '../services/liveStream/helperStreamClient';
import { endStreamSession, startStreamSession } from '../services/liveStream/streamSession';
import {
  createDefaultLiveStreamConfig,
  createIdleLiveStreamStatus,
  type LiveStreamStatus,
  type StreamSessionLogEntry,
  type StreamStoreApi,
} from '../services/liveStream/streamTypes';

export interface StreamStoreState extends StreamStoreApi {
  _patchStatus(patch: Partial<LiveStreamStatus>): void;
  _appendSessionLog(entry: StreamSessionLogEntry): void;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Live streaming failed.';
}

export const useStreamStore = create<StreamStoreState>()(
  subscribeWithSelector(
    persist(
      set => ({
        config: createDefaultLiveStreamConfig(),
        status: createIdleLiveStreamStatus(),
        sessionLog: [],
        updateConfig: patch => set(state => ({ config: { ...state.config, ...patch } })),
        _patchStatus: patch => set(state => ({ status: { ...state.status, ...patch } })),
        _appendSessionLog: entry => set(state => ({ sessionLog: [entry, ...state.sessionLog].slice(0, 50) })),
        clearSessionLog: () => set({ sessionLog: [] }),
        goLive: async () => {
          const storedConfig = useStreamStore.getState().config;
          const config = { ...storedConfig, rtmpRelay: storedConfig.rtmpRelay ?? 'auto' };
          set(state => ({
            status: {
              ...state.status,
              phase: 'starting',
              transport: config.transport,
              activeRtmpRelay: null,
              startedAtMs: null,
              lastError: null,
            },
          }));
          try {
            await startStreamSession(config);
          } catch (error) {
            set(state => ({
              status: { ...state.status, phase: 'error', activeRtmpRelay: null, lastError: errorMessage(error) },
            }));
          }
        },
        endStream: async () => {
          set(state => ({ status: { ...state.status, phase: 'stopping' } }));
          try {
            await endStreamSession();
          } catch (error) {
            set(state => ({
              status: { ...state.status, phase: 'error', activeRtmpRelay: null, lastError: errorMessage(error) },
            }));
          }
        },
        refreshHelperAvailability: async () => {
          const helperAvailable = await isHelperReachable();
          set(state => ({ status: { ...state.status, helperAvailable } }));
        },
      }),
      {
        name: 'masterselects-stream',
        partialize: state => ({ config: state.config, sessionLog: state.sessionLog }),
        merge: (persistedState, currentState) => {
          const persisted = (
            persistedState && typeof persistedState === 'object' ? persistedState : {}
          ) as Partial<StreamStoreState>;
          return {
            ...currentState,
            ...persisted,
            sessionLog: Array.isArray(persisted.sessionLog) ? persisted.sessionLog.slice(0, 50) : [],
          };
        },
      },
    ),
  ),
);
