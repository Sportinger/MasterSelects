import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { getTimelineRevision } from '../../src/stores/timeline/revisionMiddleware';
import { generateWaveformForClipAction } from '../../src/stores/timeline/clip/clipWaveformAnalysisActions';

const analysis = vi.hoisted(() => ({
  resolveFile: vi.fn(),
  generate: vi.fn(),
}));
vi.mock('../../src/stores/timeline/clip/clipAudioAnalysisShared', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/stores/timeline/clip/clipAudioAnalysisShared')>(),
  resolveClipSourceFile: analysis.resolveFile,
}));
vi.mock('../../src/services/audio/timelineWaveformPyramidCache', () => ({
  generateTimelineWaveformAnalysisForFile: analysis.generate,
}));

const initialState = useTimelineStore.getState();
const context = { get: useTimelineStore.getState, set: useTimelineStore.setState };
let clipId: string;

describe('background waveform analysis', () => {
  beforeEach(() => {
    analysis.resolveFile.mockResolvedValue(new File(['audio'], 'clip.wav'));
    analysis.generate.mockResolvedValue({
      waveform: [0.2, 0.5],
      audioAnalysisRefs: { waveformPyramidId: 'pyramid-1' },
    });
    const trackId = useTimelineStore.getState().addTrack('midi');
    clipId = useTimelineStore.getState().addMidiClip(trackId, 0, 4)!;
    useTimelineStore.setState({ clips: useTimelineStore.getState().clips.map(clip => (
      clip.id === clipId ? { ...clip, audioState: undefined } : clip
    )) });
  });
  afterEach(() => {
    useTimelineStore.setState(initialState);
    vi.clearAllMocks();
  });

  it('publishes the first waveform and analysis refs without editing the durable timeline', async () => {
    const revision = getTimelineRevision();
    await generateWaveformForClipAction(context, clipId, { derivedOnly: true });
    expect(useTimelineStore.getState().clips.find(clip => clip.id === clipId)).toMatchObject({
      waveform: [0.2, 0.5],
      waveformGenerating: false,
      audioState: { sourceAnalysisRefs: { waveformPyramidId: 'pyramid-1' } },
    });
    expect(getTimelineRevision()).toBe(revision);
  });

  it('does not mutate durable file/relink fields when a background source is unavailable', async () => {
    analysis.resolveFile.mockResolvedValue(undefined);
    const before = useTimelineStore.getState().clips.find(clip => clip.id === clipId)!;
    const revision = getTimelineRevision();
    await generateWaveformForClipAction(context, clipId, { derivedOnly: true });
    const after = useTimelineStore.getState().clips.find(clip => clip.id === clipId)!;
    expect(after.file).toBe(before.file);
    expect(after.needsReload).toBe(before.needsReload);
    expect(after.waveformGenerating).toBe(false);
    expect(analysis.generate).not.toHaveBeenCalled();
    expect(getTimelineRevision()).toBe(revision);
  });

  it('clears the running flag and reports a decode failure to the background scheduler', async () => {
    analysis.generate.mockRejectedValue(new Error('decode failed'));
    await expect(generateWaveformForClipAction(context, clipId, { derivedOnly: true }))
      .rejects.toThrow('decode failed');
    expect(useTimelineStore.getState().clips.find(clip => clip.id === clipId)?.waveformGenerating).toBe(false);
  });
});
