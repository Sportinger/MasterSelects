import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultLiveStreamConfig,
  createIdleLiveStreamStatus,
  type StreamHealthSample,
  type StreamStoreApi,
} from '../../src/services/liveStream/streamTypes';

const historyMocks = vi.hoisted(() => ({
  samples: [] as readonly StreamHealthSample[],
  subscribe: vi.fn(() => () => undefined),
}));

let fakeStore: StreamStoreApi;

vi.mock('../../src/services/liveStream/streamHealthHistory', () => ({
  getStreamHealthHistory: () => historyMocks.samples,
  subscribeStreamHealthHistory: historyMocks.subscribe,
}));

vi.mock('../../src/stores/streamStore', () => ({
  useStreamStore: (selector: (state: StreamStoreApi) => unknown) => selector(fakeStore),
}));

import { StreamAnalyticsPanel } from '../../src/components/panels/stream-analytics/StreamAnalyticsPanel';

beforeEach(() => {
  historyMocks.samples = [{
    atMs: 1_000,
    bitrateKbps: 4_200,
    droppedFrames: 2,
    queuedBytes: 0,
    encodeQueueSize: 1,
    audioProgram: 0.6,
    audioMicrophone: 0.3,
  }];
  historyMocks.subscribe.mockClear();
  fakeStore = {
    config: createDefaultLiveStreamConfig(),
    status: {
      ...createIdleLiveStreamStatus(),
      phase: 'live',
      transport: 'rtmp',
      activeRtmpRelay: 'cloud',
      startedAtMs: 1_000,
      stats: {
        ...createIdleLiveStreamStatus().stats,
        uptimeSeconds: 65,
        bitrateKbpsEstimate: 4_321,
        droppedFrames: 7,
      },
    },
    sessionLog: [{
      startedAtMs: Date.UTC(2026, 7, 24, 12, 0, 0),
      durationSeconds: 125,
      transport: 'rtmp',
      relay: 'cloud',
      avgBitrateKbps: 4_200.4,
      droppedFrames: 7,
      endReason: 'error',
      errorMessage: 'Relay disconnected.',
    }],
    updateConfig: vi.fn(),
    goLive: vi.fn(async () => undefined),
    endStream: vi.fn(async () => undefined),
    refreshHelperAvailability: vi.fn(async () => undefined),
    clearSessionLog: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StreamAnalyticsPanel', () => {
  it('renders live values and persisted session rows and clears the log', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    render(<StreamAnalyticsPanel />);

    expect(screen.getByLabelText('Current stream health')).toHaveTextContent('01:05');
    expect(screen.getByLabelText('Current stream health')).toHaveTextContent('4321 kbps');
    expect(screen.getByLabelText('Current stream health')).toHaveTextContent('7');
    expect(screen.getByLabelText('Current stream health')).toHaveTextContent('cloud');
    expect(screen.getByText('02:05')).toBeInTheDocument();
    expect(screen.getByText('RTMP · cloud')).toBeInTheDocument();
    expect(screen.getByText('4200 kbps')).toBeInTheDocument();
    expect(screen.getByText('error')).toHaveAttribute('title', 'Relay disconnected.');

    fireEvent.click(screen.getByRole('button', { name: 'Clear log' }));
    expect(fakeStore.clearSessionLog).toHaveBeenCalledTimes(1);
  });

  it('renders all canvases without throwing when a 2d context is unavailable', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    expect(() => render(<StreamAnalyticsPanel />)).not.toThrow();
    expect(document.querySelectorAll('canvas')).toHaveLength(3);
    expect(getContext).toHaveBeenCalledTimes(3);
  });
});
