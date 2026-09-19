import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionMocks = vi.hoisted(() => ({
  startStreamSession: vi.fn(async (): Promise<void> => undefined),
  endStreamSession: vi.fn(async (): Promise<void> => undefined),
  isHelperReachable: vi.fn(async () => true),
}));

vi.mock('../streamSession', () => ({
  startStreamSession: sessionMocks.startStreamSession,
  endStreamSession: sessionMocks.endStreamSession,
}));

vi.mock('../helperStreamClient', () => ({
  isHelperReachable: sessionMocks.isHelperReachable,
}));

import { useStreamStore, type StreamStoreState } from '../../../stores/streamStore';
import {
  createDefaultLiveStreamConfig,
  createIdleLiveStreamStatus,
  type LiveStreamConfig,
  type StreamSessionLogEntry,
} from '../streamTypes';

function logEntry(startedAtMs: number): StreamSessionLogEntry {
  return {
    startedAtMs,
    durationSeconds: 60,
    transport: 'rtmp',
    relay: 'cloud',
    avgBitrateKbps: 4_500,
    droppedFrames: 0,
    endReason: 'ended',
  };
}

describe('useStreamStore', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionMocks.startStreamSession.mockReset().mockResolvedValue(undefined);
    sessionMocks.endStreamSession.mockReset().mockResolvedValue(undefined);
    sessionMocks.isHelperReachable.mockReset().mockResolvedValue(true);
    useStreamStore.setState({
      config: createDefaultLiveStreamConfig(),
      status: createIdleLiveStreamStatus(),
      sessionLog: [],
    });
  });

  it('shallow-merges config and persists config with the session log', () => {
    useStreamStore.getState().updateConfig({ fps: 60, videoBitrateKbps: 6_000, rtmpRelay: 'cloud' });
    expect(useStreamStore.getState().config).toMatchObject({ fps: 60, videoBitrateKbps: 6_000, rtmpRelay: 'cloud' });
    expect(useStreamStore.getState().config.transport).toBe('rtmp');

    const partialize = useStreamStore.persist.getOptions().partialize;
    expect(partialize?.(useStreamStore.getState())).toEqual({
      config: useStreamStore.getState().config,
      sessionLog: [],
    });
  });

  it('prepends session log entries and caps the persisted list at 50', () => {
    for (let index = 0; index < 52; index += 1) {
      useStreamStore.getState()._appendSessionLog(logEntry(index));
    }

    const sessionLog = useStreamStore.getState().sessionLog;
    expect(sessionLog).toHaveLength(50);
    expect(sessionLog[0].startedAtMs).toBe(51);
    expect(sessionLog.at(-1)?.startedAtMs).toBe(2);
  });

  it('clears the session log', () => {
    useStreamStore.getState()._appendSessionLog(logEntry(1));
    useStreamStore.getState().clearSessionLog();
    expect(useStreamStore.getState().sessionLog).toEqual([]);
  });

  it('defaults sessionLog to an empty array when rehydrating legacy state', () => {
    const merge = useStreamStore.persist.getOptions().merge;
    const rehydrated = merge?.(
      { config: createDefaultLiveStreamConfig() },
      useStreamStore.getState(),
    ) as StreamStoreState;

    expect(rehydrated.sessionLog).toEqual([]);
  });

  it('enters starting immediately and delegates goLive with the current config', async () => {
    let release!: () => void;
    sessionMocks.startStreamSession.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    useStreamStore.getState().updateConfig({ transport: 'whip', whipUrl: 'https://example.test/whip' });

    const goLive = useStreamStore.getState().goLive();
    expect(useStreamStore.getState().status).toMatchObject({ phase: 'starting', transport: 'whip' });
    expect(sessionMocks.startStreamSession).toHaveBeenCalledWith(expect.objectContaining({
      transport: 'whip',
      whipUrl: 'https://example.test/whip',
    }));
    release();
    await goLive;
  });

  it('lands in the error phase when session startup rejects', async () => {
    sessionMocks.startStreamSession.mockRejectedValueOnce(new Error('relay unavailable'));
    await useStreamStore.getState().goLive();
    expect(useStreamStore.getState().status).toMatchObject({
      phase: 'error',
      lastError: 'relay unavailable',
    });
  });

  it('treats a legacy persisted config without rtmpRelay as auto without mutating it', async () => {
    const legacyConfig = { ...createDefaultLiveStreamConfig(), rtmpRelay: undefined } as unknown as LiveStreamConfig;
    useStreamStore.setState({ config: legacyConfig });

    await useStreamStore.getState().goLive();

    expect(sessionMocks.startStreamSession).toHaveBeenCalledWith(expect.objectContaining({ rtmpRelay: 'auto' }));
    expect(useStreamStore.getState().config.rtmpRelay).toBeUndefined();
  });
});
