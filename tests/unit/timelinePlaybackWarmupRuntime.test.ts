import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRuntimeFrameProvider } from '../../src/services/mediaRuntime/runtimePlayback';
import { getTimelinePlaybackWarmupVideo } from '../../src/services/timeline/timelinePlaybackWarmupRuntime';
import type { TimelineClip } from '../../src/types';

const renderHostMock = vi.hoisted(() => ({
  getTelemetry: vi.fn(() => ({ mode: 'main' })),
}));

vi.mock('../../src/services/mediaRuntime/runtimePlayback', () => ({
  getRuntimeFrameProvider: vi.fn(),
}));

vi.mock('../../src/services/render/renderHostPort', () => ({
  renderHostPort: renderHostMock,
}));

const getRuntimeFrameProviderMock = vi.mocked(getRuntimeFrameProvider);

function createVideoSource(overrides: Partial<NonNullable<TimelineClip['source']>> = {}) {
  return {
    type: 'video',
    videoElement: document.createElement('video'),
    ...overrides,
  } as NonNullable<TimelineClip['source']>;
}

function createFrameProvider(fullMode: boolean) {
  return {
    isFullMode: vi.fn(() => fullMode),
  };
}

describe('timeline playback warmup runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderHostMock.getTelemetry.mockReturnValue({ mode: 'main' });
    getRuntimeFrameProviderMock.mockReturnValue(null);
  });

  it('returns legacy html video elements when no full runtime provider can serve frames', () => {
    const source = createVideoSource();

    expect(getTimelinePlaybackWarmupVideo(source)).toBe(source.videoElement);
  });

  it('skips html warmup when runtime playback has a full frame provider', () => {
    const source = createVideoSource();
    getRuntimeFrameProviderMock.mockReturnValue(createFrameProvider(true) as never);

    expect(getTimelinePlaybackWarmupVideo(source)).toBeNull();
  });

  it('skips html warmup when legacy WebCodecs provider is already full mode', () => {
    const source = createVideoSource({
      webCodecsPlayer: createFrameProvider(true) as never,
    });

    expect(getTimelinePlaybackWarmupVideo(source)).toBeNull();
  });

  it('keeps html warmup in worker GPU-only playback when full WebCodecs is disabled', () => {
    const source = createVideoSource();
    renderHostMock.getTelemetry.mockReturnValue({ mode: 'worker-gpu-only' });

    expect(getTimelinePlaybackWarmupVideo(source)).toBe(source.videoElement);
  });

  it('ignores sources without legacy html video elements', () => {
    expect(getTimelinePlaybackWarmupVideo({ type: 'image' } as NonNullable<TimelineClip['source']>)).toBeNull();
    expect(getTimelinePlaybackWarmupVideo(null)).toBeNull();
  });
});
