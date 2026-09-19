import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  patchStatus: vi.fn(),
  appendSessionLog: vi.fn(),
  isHelperReachable: vi.fn(async () => true),
  openHelperStreamConnection: vi.fn(),
  openCloudStreamConnection: vi.fn(),
  startRtmpSink: vi.fn(),
  startWhipSink: vi.fn(),
  sinkStop: vi.fn(async () => undefined),
  mixClose: vi.fn(async () => undefined),
  tapClose: vi.fn(),
}));

vi.mock('../../../stores/streamStore', () => ({
  useStreamStore: {
    getState: () => ({
      status: { startedAtMs: null, transport: null, activeRtmpRelay: null },
      _appendSessionLog: mocks.appendSessionLog,
      _patchStatus: mocks.patchStatus,
    }),
  },
}));
vi.mock('../../capture/recording/audioMixing', () => ({
  createCaptureAudioMix: vi.fn(async () => ({
    recordingStream: {} as MediaStream,
    getLevels: () => ({ display: 0, microphone: 0 }),
    close: mocks.mixClose,
  })),
}));
vi.mock('../programTap', () => ({
  createProgramTap: vi.fn(() => ({
    stream: {} as MediaStream,
    width: 1280,
    height: 720,
    fps: 30,
    hasProgramAudio: false,
    close: mocks.tapClose,
  })),
}));
vi.mock('../helperStreamClient', () => ({
  isHelperReachable: mocks.isHelperReachable,
  openHelperStreamConnection: mocks.openHelperStreamConnection,
}));
vi.mock('../cloudStreamClient', () => ({
  openCloudStreamConnection: mocks.openCloudStreamConnection,
}));
vi.mock('../rtmpSink', () => ({ startRtmpSink: mocks.startRtmpSink }));
vi.mock('../whipSink', () => ({ startWhipSink: mocks.startWhipSink }));
vi.mock('../localRecorder', () => ({ startLocalStreamRecording: vi.fn() }));

import { createDefaultLiveStreamConfig } from '../streamTypes';
import { endStreamSession, startStreamSession } from '../streamSession';

describe('streamSession RTMP relay selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isHelperReachable.mockResolvedValue(true);
    mocks.startRtmpSink.mockResolvedValue({ stop: mocks.sinkStop, getStats: () => ({}) });
    mocks.startWhipSink.mockResolvedValue({ stop: mocks.sinkStop, getStats: () => ({}) });
  });

  async function startRtmp(rtmpRelay: 'auto' | 'helper' | 'cloud') {
    await startStreamSession({
      ...createDefaultLiveStreamConfig(),
      rtmpRelay,
      rtmpStreamKey: 'secret',
      includeMicrophone: false,
    });
  }

  it.each([
    { mode: 'auto' as const, reachable: true, factory: mocks.openHelperStreamConnection, active: 'helper' },
    { mode: 'auto' as const, reachable: false, factory: mocks.openCloudStreamConnection, active: 'cloud' },
    { mode: 'helper' as const, reachable: false, factory: mocks.openHelperStreamConnection, active: 'helper' },
    { mode: 'cloud' as const, reachable: true, factory: mocks.openCloudStreamConnection, active: 'cloud' },
  ])('selects $active for mode $mode when helper reachability is $reachable', async ({ mode, reachable, factory, active }) => {
    mocks.isHelperReachable.mockResolvedValue(reachable);
    await startRtmp(mode);

    expect(mocks.startRtmpSink).toHaveBeenCalledWith(expect.objectContaining({
      deps: { connectionFactory: factory },
    }));
    expect(mocks.patchStatus).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'live', activeRtmpRelay: active,
    }));
    if (mode === 'auto') expect(mocks.isHelperReachable).toHaveBeenCalledOnce();
    else expect(mocks.isHelperReachable).not.toHaveBeenCalled();

    await endStreamSession();
    expect(mocks.patchStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'idle', activeRtmpRelay: null,
    }));
  });

  it('keeps WHIP relay status null', async () => {
    await startStreamSession({
      ...createDefaultLiveStreamConfig(),
      transport: 'whip',
      whipUrl: 'https://whip.example.test/live',
      includeMicrophone: false,
    });
    expect(mocks.startWhipSink).toHaveBeenCalledOnce();
    expect(mocks.patchStatus).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'live', activeRtmpRelay: null,
    }));
    await endStreamSession();
  });

  it('clears active relay status when RTMP startup fails', async () => {
    mocks.startRtmpSink.mockRejectedValueOnce(new Error('relay failed'));
    await expect(startRtmp('cloud')).rejects.toThrow('relay failed');
    expect(mocks.patchStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'error', activeRtmpRelay: null,
    }));
  });
});
