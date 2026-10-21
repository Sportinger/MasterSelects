import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { getTimelineRevision } from '../../src/stores/timeline/revisionMiddleware';
import { generateWaveformForClipAction } from '../../src/stores/timeline/clip/clipWaveformAnalysisActions';
import {
  isWaveformWaitingForMedia,
  resetWaveformMediaDeferralsForTest,
} from '../../src/stores/timeline/clip/clipWaveformSourceDeferral';
import { Logger } from '../../src/services/logger';

const analysis = vi.hoisted(() => ({
  resolveFile: vi.fn(),
  generate: vi.fn(),
}));
vi.mock('../../src/stores/timeline/clip/clipAudioAnalysisShared', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/stores/timeline/clip/clipAudioAnalysisShared')>(),
  resolveClipSource: analysis.resolveFile,
}));
vi.mock('../../src/services/audio/timelineWaveformPyramidCache', () => ({
  generateTimelineWaveformAnalysisForFile: analysis.generate,
}));

const initialState = useTimelineStore.getState();
const context = { get: useTimelineStore.getState, set: useTimelineStore.setState };
let clipId: string;

describe('background waveform analysis', () => {
  beforeEach(() => {
    analysis.resolveFile.mockResolvedValue({ file: new File(['audio'], 'clip.wav') });
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
    resetWaveformMediaDeferralsForTest();
    vi.restoreAllMocks();
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

  it('merges refs into the current clip when an audio edit lands during the analysis', async () => {
    analysis.generate.mockImplementation(async () => {
      // A durable audio edit replaces audioState while the background analysis runs.
      useTimelineStore.setState({ clips: useTimelineStore.getState().clips.map(clip => (
        clip.id === clipId ? { ...clip, audioState: { muted: true } } : clip
      )) });
      return { waveform: [0.1], audioAnalysisRefs: { waveformPyramidId: 'pyramid-2' } };
    });
    await generateWaveformForClipAction(context, clipId, { derivedOnly: true });
    expect(useTimelineStore.getState().clips.find(clip => clip.id === clipId)?.audioState)
      .toEqual({ muted: true, sourceAnalysisRefs: { waveformPyramidId: 'pyramid-2' } });
  });

  it('does not mutate durable file/relink fields when a background source is unavailable', async () => {
    analysis.resolveFile.mockResolvedValue({ gap: 'unavailable', mediaFileId: 'media-1' });
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

  it('waits for media that is still loading on reopen instead of warning, then analyses once it arrives', async () => {
    Logger.clear();
    let arrive: (() => void) | null = null;
    const unsubscribe = vi.fn();
    analysis.resolveFile.mockResolvedValueOnce({
      gap: 'loading',
      mediaFileId: 'media-1',
      watchLoaded: (onLoaded: () => void) => { arrive = onLoaded; return unsubscribe; },
    });
    await generateWaveformForClipAction(context, clipId, { derivedOnly: true });
    const waiting = useTimelineStore.getState().clips.find(clip => clip.id === clipId)!;
    expect(waiting.waveformGenerating).toBe(false);
    expect(waiting.needsReload).not.toBe(true);
    expect(isWaveformWaitingForMedia(clipId)).toBe(true);
    expect(analysis.generate).not.toHaveBeenCalled();
    expect(Logger.getBuffer('WARN').filter(entry => entry.module === 'ClipWaveformAnalysis')).toEqual([]);

    arrive!();
    expect(unsubscribe).toHaveBeenCalled();
    await vi.waitFor(() => expect(useTimelineStore.getState().clips.find(clip => clip.id === clipId)?.waveform)
      .toEqual([0.2, 0.5]));
    expect(isWaveformWaitingForMedia(clipId)).toBe(false);
  });

  it('reports a source that never finishes loading after the bounded waits', async () => {
    vi.useFakeTimers();
    try {
      analysis.resolveFile.mockResolvedValue({
        gap: 'loading', mediaFileId: 'media-1', watchLoaded: () => () => undefined,
      });
      await generateWaveformForClipAction(context, clipId, { derivedOnly: true });
      for (let wait = 0; wait < 3; wait += 1) {
        expect(isWaveformWaitingForMedia(clipId)).toBe(true);
        await vi.advanceTimersByTimeAsync(120_000);
      }
      expect(isWaveformWaitingForMedia(clipId)).toBe(false);
      expect(analysis.resolveFile).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
