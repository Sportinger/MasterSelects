import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/playbackDebugStats', () => ({
  buildPlaybackDebugStats: () => ({ longestPreviewFreezeMs: 1400, stalePreviewWhileTargetMoved: 30, lastPreviewFreezeClipId: 'clip', lastPreviewFreezePath: 'playback-stall-hold', pipeline: 'none' }),
}));
vi.mock('../../src/services/vfPipelineMonitor', () => ({ vfPipelineMonitor: { timeline: () => [] } }));
vi.mock('../../src/services/wcPipelineMonitor', () => ({ wcPipelineMonitor: { timeline: () => [] } }));

import { classifyPreviewFreezeRecovery } from '../../src/services/playbackHealth/previewFreeze';
import { noteSlowCodecPlaybackProgress } from '../../src/services/mediaRuntime/codec/slowCodecPlayback';

const params = (now: number) => ({ now, isPlaying: true, lastPlaybackPurgeAt: -1e9, decoder: 'WebCodecs' as never, healthVideos: [{}] as never, healthAnomalies: [] });

describe('preview freeze recovery with slow codec decoders', () => {
  it('recovers a real freeze but leaves a decoder that is slower than real time but advancing alone', () => {
    expect(classifyPreviewFreezeRecovery(params(10_000))).toMatchObject({ clipId: 'clip' });

    noteSlowCodecPlaybackProgress(20_000);
    expect(classifyPreviewFreezeRecovery(params(20_500))).toBeNull();

    // Without further progress the freeze counts again once the window has passed.
    expect(classifyPreviewFreezeRecovery(params(22_000))).toMatchObject({ clipId: 'clip' });
  });
});
