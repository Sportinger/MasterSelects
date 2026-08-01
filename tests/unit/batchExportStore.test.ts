import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDefaultExportSettings,
  getExportStoreData,
  useExportStore,
} from '../../src/stores/exportStore';

describe('batch export store', () => {
  beforeEach(() => {
    useExportStore.getState().reset();
  });

  it('enqueues unique media files, derives filenames, and activates the queue', () => {
    useExportStore.getState().enqueueBatchJobs([
      { mediaFileId: 'video-1', sourceName: 'C:\\media\\opening.cut.mp4', mediaType: 'video' },
      { mediaFileId: 'video-1', sourceName: 'duplicate.mp4', mediaType: 'video' },
      { mediaFileId: 'audio-1', sourceName: '/media/theme.wav', mediaType: 'audio' },
    ]);

    const { batch } = useExportStore.getState();
    expect(batch.enabled).toBe(true);
    expect(batch.jobs).toHaveLength(2);
    expect(batch.selectedJobId).toBe(batch.jobs[0].id);
    expect(batch.jobs.map((job) => job.mediaType)).toEqual(['video', 'audio']);
    expect(batch.jobs.map((job) => job.settings.filename)).toEqual(['opening.cut', 'theme']);
  });

  it('applies media-type defaults without changing composition settings', () => {
    useExportStore.getState().setSettings({
      useInOut: true,
      visualMode: 'gif',
      videoEnabled: true,
      includeAudio: false,
      imageExportMode: 'sequence',
    });
    const compositionSettings = { ...useExportStore.getState().settings };

    useExportStore.getState().enqueueBatchJobs([
      { mediaFileId: 'video-1', sourceName: 'video.mp4', mediaType: 'video' },
      { mediaFileId: 'audio-1', sourceName: 'audio.wav', mediaType: 'audio' },
      { mediaFileId: 'image-1', sourceName: 'still.png', mediaType: 'image' },
    ]);

    const [video, audio, image] = useExportStore.getState().batch.jobs;
    expect(video.settings).toMatchObject({
      useInOut: false,
      visualMode: 'video',
      videoEnabled: true,
    });
    expect(audio.settings).toMatchObject({
      useInOut: false,
      videoEnabled: false,
      includeAudio: true,
    });
    expect(image.settings).toMatchObject({
      useInOut: false,
      visualMode: 'image',
      imageExportMode: 'frame',
      includeAudio: false,
    });
    expect(useExportStore.getState().settings).toEqual(compositionSettings);
  });

  it('copies and propagates shared technical settings while preserving filenames', () => {
    useExportStore.getState().enqueueBatchJobs([
      { mediaFileId: 'video-1', sourceName: 'first.mp4', mediaType: 'video' },
      { mediaFileId: 'video-2', sourceName: 'second.mp4', mediaType: 'video' },
    ]);
    const [first, second] = useExportStore.getState().batch.jobs;
    useExportStore.getState().updateBatchJobSettings(first.id, { bitrate: 12_000_000 });
    useExportStore.getState().updateBatchJobSettings(second.id, { bitrate: 34_000_000 });
    useExportStore.getState().setSelectedBatchJobId(second.id);

    useExportStore.getState().setBatchUseSharedSettings(true);
    let jobs = useExportStore.getState().batch.jobs;
    expect(jobs.map((job) => job.settings.bitrate)).toEqual([34_000_000, 34_000_000]);
    expect(jobs.map((job) => job.settings.filename)).toEqual(['first', 'second']);

    useExportStore.getState().updateBatchJobSettings(first.id, {
      bitrate: 45_000_000,
      filename: 'renamed-first',
    });
    jobs = useExportStore.getState().batch.jobs;
    expect(jobs.map((job) => job.settings.bitrate)).toEqual([45_000_000, 45_000_000]);
    expect(jobs.map((job) => job.settings.filename)).toEqual(['renamed-first', 'second']);
  });

  it('keeps cloned settings independent after shared settings are disabled', () => {
    useExportStore.getState().enqueueBatchJobs([
      { mediaFileId: 'video-1', sourceName: 'first.mp4', mediaType: 'video' },
      { mediaFileId: 'video-2', sourceName: 'second.mp4', mediaType: 'video' },
    ]);
    useExportStore.getState().setBatchUseSharedSettings(true);
    useExportStore.getState().setBatchUseSharedSettings(false);
    const [first] = useExportStore.getState().batch.jobs;

    useExportStore.getState().updateBatchJobSettings(first.id, { fps: 60 });
    const jobs = useExportStore.getState().batch.jobs;
    expect(jobs[0].settings.fps).toBe(60);
    expect(jobs[1].settings.fps).toBe(30);
    expect(jobs[0].settings).not.toBe(jobs[1].settings);
  });

  it('keeps source-specific channel invariants when mixed jobs share technical settings', () => {
    useExportStore.getState().enqueueBatchJobs([
      { mediaFileId: 'video-1', sourceName: 'video.mp4', mediaType: 'video' },
      { mediaFileId: 'audio-1', sourceName: 'audio.wav', mediaType: 'audio' },
      { mediaFileId: 'image-1', sourceName: 'still.png', mediaType: 'image' },
    ]);
    useExportStore.getState().setBatchUseSharedSettings(true);
    const [video, audio, image] = useExportStore.getState().batch.jobs;

    expect(video.settings).toMatchObject({ encoder: 'webcodecs', videoEnabled: true, visualMode: 'video' });
    expect(audio.settings).toMatchObject({ encoder: 'webcodecs', videoEnabled: false, includeAudio: true });
    expect(image.settings).toMatchObject({ encoder: 'webcodecs', visualMode: 'image', includeAudio: false });
    expect([video, audio, image].map((job) => job.settings.bitrate)).toEqual([
      video.settings.bitrate,
      video.settings.bitrate,
      video.settings.bitrate,
    ]);
  });

  it('saves a batch settings override without mutating composition settings', () => {
    const compositionBitrate = useExportStore.getState().settings.bitrate;
    const override = {
      ...useExportStore.getState().settings,
      bitrate: 42_000_000,
      filename: 'batch-preset',
    };

    const result = useExportStore.getState().savePreset('Batch preset', override);
    expect(result?.preset.settings).toMatchObject({
      bitrate: 42_000_000,
      filename: 'batch-preset',
    });
    expect(useExportStore.getState().settings.bitrate).toBe(compositionBitrate);
  });

  it('sanitizes hydration, deep-clones persistence data, and resets batch state', () => {
    const defaults = createDefaultExportSettings();
    useExportStore.getState().hydrateFromProject({
      settings: defaults,
      batch: {
        enabled: true,
        useSharedSettings: false,
        selectedJobId: 'missing-job',
        jobs: [
          {
            id: 'job-1',
            mediaFileId: 'media-1',
            sourceName: 'clip.mp4',
            mediaType: 'video',
            settings: { ...defaults, width: -100, filename: 'clip' },
            createdAt: 10,
          },
          {
            id: 'job-duplicate',
            mediaFileId: 'media-1',
            sourceName: 'duplicate.mp4',
            mediaType: 'video',
            settings: defaults,
            createdAt: 11,
          },
        ],
      },
    });

    const hydrated = useExportStore.getState().batch;
    expect(hydrated.jobs).toHaveLength(1);
    expect(hydrated.selectedJobId).toBe('job-1');
    expect(hydrated.jobs[0].settings.width).toBe(1);

    const persisted = getExportStoreData(useExportStore.getState());
    persisted.batch.jobs[0].settings.filename = 'mutated-copy';
    persisted.batch.jobs.push({ ...persisted.batch.jobs[0], id: 'external-job' });
    expect(useExportStore.getState().batch.jobs).toHaveLength(1);
    expect(useExportStore.getState().batch.jobs[0].settings.filename).toBe('clip');

    useExportStore.getState().reset();
    expect(useExportStore.getState().batch).toEqual({
      enabled: false,
      useSharedSettings: false,
      selectedJobId: null,
      jobs: [],
    });
  });
});
