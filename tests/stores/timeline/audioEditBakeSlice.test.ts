import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClip, createMockTrack } from '../../helpers/mockData';
import { createTestTimelineStore } from '../../helpers/storeFactory';

const mocks = vi.hoisted(() => ({
  encodeAudioBufferToWavBlob: vi.fn(),
  extractAudio: vi.fn(),
  renderClipAudio: vi.fn(),
  generateTimelineWaveformAnalysisForFile: vi.fn(),
  importFile: vi.fn(),
  createAudioElement: vi.fn(),
  createFolder: vi.fn(),
  mediaFolders: [] as Array<{
    id: string;
    name: string;
    parentId: string | null;
    isExpanded: boolean;
    createdAt: number;
  }>,
  mediaFiles: [] as Array<{
    id: string;
    name: string;
    type: string;
    file?: File;
    url: string;
    parentId?: string | null;
    createdAt?: number;
    duration?: number;
    waveform?: number[];
    waveformChannels?: number[][];
  }>,
}));

vi.mock('../../../src/engine/audio/AudioFileEncoder', () => ({
  encodeAudioBufferToWavBlob: mocks.encodeAudioBufferToWavBlob,
}));

vi.mock('../../../src/engine/audio/AudioExtractor', () => ({
  AudioExtractor: vi.fn(function AudioExtractor() {
    return { extractAudio: mocks.extractAudio };
  }),
  audioExtractor: { extractAudio: mocks.extractAudio },
}));

vi.mock('../../../src/services/audio/ClipAudioRenderService', () => ({
  ClipAudioRenderService: vi.fn(function ClipAudioRenderService() {
    return { render: mocks.renderClipAudio };
  }),
}));

vi.mock('../../../src/services/audio/timelineWaveformPyramidCache', () => ({
  generateTimelineWaveformAnalysisForFile: mocks.generateTimelineWaveformAnalysisForFile,
  mapSourceWaveformPreviewProgress: (progress: number) => Math.round(Math.max(0, Math.min(70, progress)) / 70 * 20),
  mapSourceWaveformPyramidProgress: (progress: { percent: number }) => Math.round(20 + Math.max(0, Math.min(100, progress.percent)) / 100 * 79),
}));

vi.mock('../../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => ({
      importFile: mocks.importFile,
      createFolder: mocks.createFolder,
      folders: mocks.mediaFolders,
      files: mocks.mediaFiles,
    }),
  },
}));

vi.mock('../../../src/stores/timeline/helpers/webCodecsHelpers', () => ({
  createAudioElement: mocks.createAudioElement,
}));

describe('timeline audio edit baking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mediaFiles.length = 0;
    mocks.mediaFolders.length = 0;
    mocks.createFolder.mockImplementation((name: string, parentId: string | null = null) => {
      const folder = {
        id: 'folder-baked-audio',
        name,
        parentId,
        isExpanded: true,
        createdAt: 1,
      };
      mocks.mediaFolders.push(folder);
      return folder;
    });
    mocks.encodeAudioBufferToWavBlob.mockReturnValue(new Blob(['wav'], { type: 'audio/wav' }));
    mocks.extractAudio.mockResolvedValue({ duration: 4 } as AudioBuffer);
    mocks.renderClipAudio.mockResolvedValue({ buffer: { duration: 2.5 } as AudioBuffer });
    mocks.generateTimelineWaveformAnalysisForFile.mockResolvedValue({
      waveform: [0.1, 0.4, 0.2],
      audioAnalysisRefs: {
        waveformPyramidId: 'waveform-baked',
        loudnessEnvelopeId: 'loudness-baked',
      },
    });
    mocks.importFile.mockResolvedValue({
      id: 'media-baked',
      type: 'audio',
    });
    mocks.createAudioElement.mockReturnValue({ tagName: 'AUDIO' });
  });

  it('bakes active edit stacks into derived audio media and records provenance', async () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      name: 'dialog.wav',
      mediaFileId: 'media-source',
      file: new File(['source'], 'dialog.wav', { type: 'audio/wav' }),
      source: {
        type: 'audio',
        mediaFileId: 'media-source',
        naturalDuration: 4,
      },
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      speed: 1.25,
      reversed: true,
      effects: [{ id: 'legacy-fx', type: 'blur', name: 'Blur', params: {} }],
      audioState: {
        sourceAnalysisRefs: { waveformPyramidId: 'waveform-source' },
        processedAnalysisRefs: { processedWaveformPyramidId: 'waveform-processed' },
        effectStack: [{
          id: 'clip-audio-fx',
          descriptorId: 'audio-volume',
          enabled: true,
          params: { volume: 0.5 },
        }],
        editStack: [
          {
            id: 'edit-invert',
            type: 'invert-polarity',
            enabled: true,
            params: {},
            timeRange: { start: 0.5, end: 1.5 },
            createdAt: 1,
          },
          {
            id: 'edit-silence-disabled',
            type: 'silence',
            enabled: false,
            params: {},
            timeRange: { start: 2, end: 3 },
            createdAt: 2,
          },
        ],
      },
    });
    const track = createMockTrack({
      id: 'audio-1',
      type: 'audio',
      locked: false,
    });
    const store = createTestTimelineStore({ clips: [clip], tracks: [track] });

    const bakedMediaId = await store.getState().bakeClipAudioEditStack('audio-clip');

    expect(bakedMediaId).toBe('media-baked');
    expect(mocks.extractAudio).toHaveBeenCalledWith(clip.file, 'media-source');
    expect(mocks.renderClipAudio).toHaveBeenCalledWith(expect.objectContaining({
      clip: expect.objectContaining({
        id: 'audio-clip',
        speed: 1,
        reversed: false,
        preservesPitch: true,
        effects: [],
        audioState: expect.objectContaining({
          editStack: clip.audioState?.editStack,
          muted: false,
          effectStack: [],
        }),
      }),
    }));
    expect(mocks.importFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'dialog - baked audio.wav', type: 'audio/wav' }),
      'folder-baked-audio',
      {
        forceCopyToProject: true,
        projectFileName: 'Raw/Baked Audio/dialog - baked audio.wav',
      },
    );
    expect(mocks.createFolder).toHaveBeenCalledWith('Baked Audio', null);
    expect(mocks.generateTimelineWaveformAnalysisForFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'dialog - baked audio.wav' }),
      { mediaFileId: 'media-baked' },
    );

    const updated = store.getState().clips[0];
    expect(updated.name).toBe('dialog - baked audio.wav');
    expect(updated.mediaFileId).toBe('media-baked');
    expect(updated.duration).toBe(2.5);
    expect(updated.inPoint).toBe(0);
    expect(updated.outPoint).toBe(2.5);
    expect(updated.waveform).toEqual([0.1, 0.4, 0.2]);
    expect(updated.source?.mediaFileId).toBe('media-baked');
    expect(updated.source?.naturalDuration).toBe(2.5);
    expect(updated.source).not.toHaveProperty('audioElement');
    expect(mocks.createAudioElement).not.toHaveBeenCalled();
    expect(updated.audioState?.editStack).toEqual([]);
    expect(updated.audioState?.sourceAudioRevisionId).toBe('media-baked');
    expect(updated.audioState?.sourceAnalysisRefs).toEqual({
      waveformPyramidId: 'waveform-baked',
      loudnessEnvelopeId: 'loudness-baked',
    });
    expect(updated.audioState?.processedAnalysisRefs).toBeUndefined();
    expect(updated.audioState?.bakeHistory?.[0]).toEqual(expect.objectContaining({
      mediaFileId: 'media-baked',
      sourceMediaFileId: 'media-source',
      sourceClipId: 'audio-clip',
      operationIds: ['edit-invert', 'edit-silence-disabled'],
      provenance: expect.objectContaining({
        operationCount: 2,
        duration: 2.5,
      }),
      restore: expect.objectContaining({
        name: 'dialog.wav',
        mediaFileId: 'media-source',
        duration: 4,
        inPoint: 0,
        outPoint: 4,
        sourceNaturalDuration: 4,
        audioState: expect.objectContaining({
          sourceAnalysisRefs: { waveformPyramidId: 'waveform-source' },
          processedAnalysisRefs: { processedWaveformPyramidId: 'waveform-processed' },
          editStack: clip.audioState?.editStack,
        }),
      }),
    }));
  });

  it('unbakes the latest reversible bake back to the original source and edit stack', () => {
    const sourceFile = new File(['source'], 'dialog.wav', { type: 'audio/wav' });
    mocks.mediaFiles.push({
      id: 'media-source',
      name: 'dialog.wav',
      type: 'audio',
      file: sourceFile,
      url: 'blob:source',
      parentId: null,
      createdAt: 1,
      duration: 4,
      waveform: [0.3, 0.1],
      waveformChannels: [[0.3, 0.1]],
    });

    const restoredEditStack = [{
      id: 'edit-invert',
      type: 'invert-polarity' as const,
      enabled: true,
      params: {},
      timeRange: { start: 0.5, end: 1.5 },
      createdAt: 1,
    }];
    const bakedFile = new File(['baked'], 'dialog - baked audio.wav', { type: 'audio/wav' });
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      name: 'dialog - baked audio.wav',
      mediaFileId: 'media-baked',
      file: bakedFile,
      source: {
        type: 'audio',
        mediaFileId: 'media-baked',
        naturalDuration: 2.5,
      },
      duration: 2.5,
      inPoint: 0,
      outPoint: 2.5,
      audioState: {
        sourceAudioRevisionId: 'media-baked',
        sourceAnalysisRefs: { waveformPyramidId: 'waveform-baked' },
        editStack: [],
        bakeHistory: [{
          id: 'audio-bake-1',
          mediaFileId: 'media-baked',
          sourceMediaFileId: 'media-source',
          sourceClipId: 'audio-clip',
          operationIds: ['edit-invert'],
          createdAt: 10,
          restore: {
            name: 'dialog.wav',
            mediaFileId: 'media-source',
            duration: 4,
            inPoint: 0,
            outPoint: 4,
            sourceNaturalDuration: 4,
            waveform: [0.3, 0.1],
            waveformChannels: [[0.3, 0.1]],
            audioState: {
              sourceAnalysisRefs: { waveformPyramidId: 'waveform-source' },
              processedAnalysisRefs: { processedWaveformPyramidId: 'waveform-processed' },
              editStack: restoredEditStack,
            },
          },
        }],
      },
    });
    const track = createMockTrack({
      id: 'audio-1',
      type: 'audio',
      locked: false,
    });
    const store = createTestTimelineStore({ clips: [clip], tracks: [track] });

    const didUnbake = store.getState().unbakeClipAudioEditStack('audio-clip');

    expect(didUnbake).toBe(true);
    expect(mocks.createAudioElement).not.toHaveBeenCalled();
    const updated = store.getState().clips[0];
    expect(updated.name).toBe('dialog.wav');
    expect(updated.file).toBe(sourceFile);
    expect(updated.mediaFileId).toBe('media-source');
    expect(updated.duration).toBe(4);
    expect(updated.inPoint).toBe(0);
    expect(updated.outPoint).toBe(4);
    expect(updated.waveform).toEqual([0.3, 0.1]);
    expect(updated.waveformChannels).toEqual([[0.3, 0.1]]);
    expect(updated.source?.mediaFileId).toBe('media-source');
    expect(updated.source?.naturalDuration).toBe(4);
    expect(updated.source).not.toHaveProperty('audioElement');
    expect(updated.audioState?.editStack).toEqual(restoredEditStack);
    expect(updated.audioState?.sourceAnalysisRefs).toEqual({ waveformPyramidId: 'waveform-source' });
    expect(updated.audioState?.processedAnalysisRefs).toEqual({ processedWaveformPyramidId: 'waveform-processed' });
    expect(updated.audioState?.bakeHistory).toBeUndefined();
  });
});
