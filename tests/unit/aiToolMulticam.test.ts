import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleGetMediaItems } from '../../src/services/aiTools/handlers/media';
import {
  handleGetAudioSyncStatus,
  handleSetMulticamMode,
  handleSyncClipsViaAudio,
} from '../../src/services/aiTools/handlers/multicam';
import { accumulatePeakBins } from '../../src/services/audio/syncSignalSource';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { TimelineAudioSyncReport } from '../../src/services/audioSync';

type MediaStoreArg = Parameters<typeof handleGetMediaItems>[1];
type TimelineStoreArg = Parameters<typeof handleSyncClipsViaAudio>[1];

function mediaStore(): MediaStoreArg {
  return {
    folders: [
      { id: 'originals', name: 'Originale', parentId: null, isExpanded: true },
      { id: 'audio', name: 'audio', parentId: 'originals', isExpanded: true },
      { id: 'video', name: 'video', parentId: 'originals', isExpanded: true },
    ],
    files: [
      { id: 'a1', name: 'Piano.wav', type: 'audio', parentId: 'audio', duration: 4967 },
      { id: 'a2', name: 'Raum.wav', type: 'audio', parentId: 'audio', duration: 4967 },
      { id: 'v1', name: 'Totale.MXF', type: 'video', parentId: 'video', duration: 10053 },
      { id: 'root-image', name: 'Still.png', type: 'image', parentId: null },
    ],
    compositions: [],
  } as unknown as MediaStoreArg;
}

describe('getMediaItems', () => {
  it('lists media in subfolders with their folder path by default', async () => {
    const result = await handleGetMediaItems({}, mediaStore());
    const data = result.data as {
      files: Array<{ id: string; folderPath: string }>;
      fileCounts: Record<string, number>;
      folders: Array<{ path: string }>;
      hasMore: boolean;
    };

    expect(result.success).toBe(true);
    expect(data.files.map(file => file.id)).toEqual(['a1', 'a2', 'v1', 'root-image']);
    expect(data.files.find(file => file.id === 'v1')?.folderPath).toBe('Originale/video');
    expect(data.fileCounts).toEqual({ total: 4, video: 1, audio: 2, image: 1 });
    expect(data.folders.map(folder => folder.path)).toEqual(['Originale', 'Originale/audio', 'Originale/video']);
    expect(data.hasMore).toBe(false);
  });

  it('keeps the one-folder listing when recursion is turned off', async () => {
    const root = await handleGetMediaItems({ recursive: false }, mediaStore());
    expect((root.data as { files: Array<{ id: string }> }).files.map(file => file.id)).toEqual(['root-image']);

    const audio = await handleGetMediaItems({ folderId: 'originals' }, mediaStore());
    expect((audio.data as { files: Array<{ id: string }> }).files.map(file => file.id)).toEqual(['a1', 'a2', 'v1']);
  });

  it('pages files and rejects unknown folders', async () => {
    const page = await handleGetMediaItems({ limit: 2, offset: 1 }, mediaStore());
    expect(page.data).toMatchObject({ offset: 1, hasMore: true, nextOffset: 3 });
    expect((page.data as { files: Array<{ id: string }> }).files.map(file => file.id)).toEqual(['a2', 'v1']);

    await expect(handleGetMediaItems({ folderId: 'missing' }, mediaStore())).resolves.toEqual({
      success: false,
      error: 'Media folder not found: missing',
    });
  });
});

describe('accumulatePeakBins', () => {
  it('keeps the signed largest-magnitude mono sample per output bin across chunks', () => {
    const buffer = (left: number[], right: number[], sampleRate: number) => ({
      sampleRate,
      numberOfChannels: 2,
      length: left.length,
      getChannelData: (channel: number) => Float32Array.from(channel === 0 ? left : right),
    });
    const output = new Float32Array(3);
    // 4 Hz source into 2 Hz bins starting at source second 1.
    accumulatePeakBins(buffer([1, 1, 0.2, -0.8], [1, 1, 0.2, -0.6], 4), 0.5, output, 1, 2);
    accumulatePeakBins(buffer([0.1, 0.3], [0.1, 0.1], 4), 1.5, output, 1, 2);

    expect(Array.from(output).map(value => Math.round(value * 100) / 100)).toEqual([-0.7, 0.2, 0]);
  });
});

describe('multicam AI tools', () => {
  const initialTimeline = useTimelineStore.getState();

  afterEach(() => {
    useTimelineStore.setState(initialTimeline, true);
    vi.restoreAllMocks();
  });

  function timelineWith(clips: Array<{ id: string; duration: number; type?: 'audio' | 'video' }>): TimelineStoreArg {
    useTimelineStore.setState({
      tracks: [{ id: 'track-a', type: 'audio', name: 'A', locked: false }] as never,
      clips: clips.map(clip => ({
        id: clip.id,
        name: `${clip.id}.wav`,
        trackId: 'track-a',
        startTime: 0,
        duration: clip.duration,
        inPoint: 0,
        outPoint: clip.duration,
        source: { type: clip.type ?? 'audio', mediaFileId: `media-${clip.id}` },
      })) as never,
    });
    return useTimelineStore.getState();
  }

  it('validates clip ids and the master before starting a job', async () => {
    const store = timelineWith([{ id: 'a', duration: 10 }, { id: 'b', duration: 20 }]);
    await expect(handleSyncClipsViaAudio({ clipIds: ['a'] }, store)).resolves.toMatchObject({ success: false });
    await expect(handleSyncClipsViaAudio({ clipIds: ['a', 'x'] }, store)).resolves.toEqual({
      success: false,
      error: 'Timeline clips not found: x',
    });
    await expect(handleSyncClipsViaAudio({ clipIds: ['a', 'b'], masterClipId: 'c' }, store)).resolves.toEqual({
      success: false,
      error: 'masterClipId must be one of clipIds.',
    });
  });

  it('runs the store sync with the longest clip as master and reports the applied result', async () => {
    const report: TimelineAudioSyncReport = {
      masterClipId: 'long',
      masterAudioClipId: 'long',
      alignments: [
        { clipId: 'long', audioClipId: 'long', offsetSeconds: 0, targetStartTime: 0, peakRatio: null, confidence: 'high', method: 'waveform' },
        { clipId: 'short', audioClipId: 'short', offsetSeconds: 12, targetStartTime: 12, peakRatio: 1.4, confidence: 'high', method: 'waveform' },
      ],
      failures: [{ clipId: 'other', reason: 'Only a low-confidence match' }],
    };
    const sync = vi.fn(async () => report);
    timelineWith([{ id: 'short', duration: 30 }, { id: 'long', duration: 300 }, { id: 'other', duration: 40 }]);
    useTimelineStore.setState({ syncClipsViaAudio: sync as never });

    const result = await handleSyncClipsViaAudio({ clipIds: ['short', 'long', 'other'] }, useTimelineStore.getState());

    expect(sync).toHaveBeenCalledWith(['short', 'long', 'other'], 'long', expect.objectContaining({ minConfidence: 'medium' }));
    expect(result).toMatchObject({
      success: true,
      data: { status: 'completed', masterClipId: 'long', alignedCount: 2, failedCount: 1 },
    });
  });

  it('returns a running job with progress and lets the status call wait for it', async () => {
    let finish!: (value: TimelineAudioSyncReport | null) => void;
    let reportProgress!: (percent: number, detail: unknown) => void;
    const sync = vi.fn((_ids: string[], _master: string, options: { onProgress: typeof reportProgress; onRejected: (reason: string) => void }) => {
      reportProgress = options.onProgress;
      return new Promise<TimelineAudioSyncReport | null>((resolve) => {
        finish = (value) => {
          if (!value) options.onRejected('Audio sync failed: proxy missing');
          resolve(value);
        };
      });
    });
    timelineWith([{ id: 'a', duration: 10 }, { id: 'b', duration: 20 }]);
    useTimelineStore.setState({ syncClipsViaAudio: sync as never });

    const started = await handleSyncClipsViaAudio({ clipIds: ['a', 'b'], waitMs: 0 }, useTimelineStore.getState());
    const jobId = (started.data as { jobId: string }).jobId;
    reportProgress(25, { percent: 25, phase: 'reading', clipIndex: 1, clipCount: 2, clipName: 'b.wav', clipFraction: 0.5 });

    const running = await handleGetAudioSyncStatus({ jobId, waitMs: 0 });
    expect(running.data).toMatchObject({ status: 'running', percent: 25, phase: 'reading', clip: '1/2 b.wav', clipPercent: 50 });

    const waiting = handleGetAudioSyncStatus({ jobId, waitMs: 5000 });
    finish(null);
    await expect(waiting).resolves.toMatchObject({
      success: true,
      data: { status: 'failed', error: 'Audio sync failed: proxy missing' },
    });
  });

  it('builds the multicam edit and lists its camera angles', async () => {
    let media = { activeCompositionId: 'comp', compositions: [{ id: 'comp', name: 'Main' }] };
    vi.spyOn(useMediaStore, 'getState').mockImplementation(() => media as never);
    const setMulticamActive = vi.fn(() => {
      media = {
        activeCompositionId: 'comp',
        compositions: [{
          id: 'comp',
          name: 'Main',
          multicam: {
            version: 1,
            active: true,
            groupId: 'g',
            angles: [
              { trackId: 'v1', label: 'Totale', sources: [{}] },
              { trackId: 'v2', label: 'Holger', sources: [{}, {}] },
            ],
          },
        }] as never,
      };
      return true;
    });
    useTimelineStore.setState({ setMulticamActive: setMulticamActive as never });

    const result = await handleSetMulticamMode({ enabled: true }, useTimelineStore.getState());

    expect(setMulticamActive).toHaveBeenCalledWith(true);
    expect(result).toMatchObject({
      success: true,
      data: {
        active: true,
        built: true,
        angles: [
          { key: 1, label: 'Totale', trackId: 'v1', sourceClips: 1 },
          { key: 2, label: 'Holger', trackId: 'v2', sourceClips: 2 },
        ],
      },
    });
  });

  it('explains why multicam cannot be built', async () => {
    vi.spyOn(useMediaStore, 'getState').mockReturnValue({ activeCompositionId: 'comp', compositions: [{ id: 'comp', name: 'Main' }] } as never);
    useTimelineStore.setState({ setMulticamActive: (() => false) as never });

    const result = await handleSetMulticamMode({ enabled: true }, useTimelineStore.getState());

    expect(result.success).toBe(false);
    expect(result.error).toContain('at least two unlocked video tracks');
  });
});
