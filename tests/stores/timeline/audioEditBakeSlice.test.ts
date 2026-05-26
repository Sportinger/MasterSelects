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
}));

vi.mock('../../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => ({
      importFile: mocks.importFile,
    }),
  },
}));

vi.mock('../../../src/stores/timeline/helpers/webCodecsHelpers', () => ({
  createAudioElement: mocks.createAudioElement,
}));

describe('timeline audio edit baking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      null,
      { forceCopyToProject: true },
    );
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
    }));
  });
});
