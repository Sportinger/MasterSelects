import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  files: [] as Record<string, unknown>[],
  clips: [] as Record<string, unknown>[],
  generateAudioProxy: vi.fn(async () => undefined),
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: { getState: () => ({ files: state.files, generateAudioProxy: state.generateAudioProxy }) },
}));
vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: { getState: () => ({ clips: state.clips }) },
}));

import { CODEC_AUDIO_PROXY_GRACE_MS, requestCodecSourceAudioProxy } from '../../src/services/mediaRuntime/codecSourceAudioProxy';

async function passGracePeriod(): Promise<void> {
  await vi.advanceTimersByTimeAsync(CODEC_AUDIO_PROXY_GRACE_MS + 1);
}

describe('codec source audio proxy requests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.generateAudioProxy.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('does not extract audio for a camera clip placed without its linked audio', async () => {
    state.files = [{ id: 'video-only', hasAudio: true }];
    state.clips = [{ id: 'v', source: { type: 'video', mediaFileId: 'video-only' } }];
    requestCodecSourceAudioProxy('video-only');
    await passGracePeriod();
    expect(state.generateAudioProxy).not.toHaveBeenCalled();
  });

  it('extracts once when a linked audio clip stays on the timeline', async () => {
    state.files = [{ id: 'with-audio', hasAudio: true }];
    state.clips = [{ id: 'a', source: { type: 'audio', mediaFileId: 'with-audio' } }];
    requestCodecSourceAudioProxy('with-audio');
    requestCodecSourceAudioProxy('with-audio');
    await passGracePeriod();
    requestCodecSourceAudioProxy('with-audio');
    await passGracePeriod();
    expect(state.generateAudioProxy).toHaveBeenCalledTimes(1);
    expect(state.generateAudioProxy).toHaveBeenCalledWith('with-audio');
  });

  it('skips sources that already have or are building a proxy', async () => {
    state.files = [
      { id: 'ready', hasAudio: true, hasProxyAudio: true },
      { id: 'busy', hasAudio: true, audioProxyStatus: 'generating' },
    ];
    state.clips = [
      { id: 'a1', source: { type: 'audio', mediaFileId: 'ready' } },
      { id: 'a2', source: { type: 'audio', mediaFileId: 'busy' } },
    ];
    requestCodecSourceAudioProxy('ready');
    requestCodecSourceAudioProxy('busy');
    await passGracePeriod();
    expect(state.generateAudioProxy).not.toHaveBeenCalled();
  });
});
