import { describe, expect, it } from 'vitest';
import { clonePersistedClipAudioState } from '../../../src/services/audio/clipAudioStatePersistence';
import type { ClipAudioState } from '../../../src/types';

describe('clip audio state persistence', () => {
  it('keeps per-clip stem selection and compact stem waveform previews', () => {
    const audioState: ClipAudioState = {
      stemSeparation: {
        activeSetId: 'stem-set',
        modelId: 'demucs-htdemucs-web',
        modelVersion: 'test',
        createdAt: 1,
        sourceFingerprint: 'sha256:source',
        range: { start: 0, end: 10 },
        sampleRate: 48_000,
        channelCount: 2,
        mixMode: 'hybrid',
        soloStemId: 'stem-drums',
        sourceGainDb: -3,
        stems: [
          {
            id: 'stem-drums',
            kind: 'drums',
            label: 'Drums',
            analysisArtifactId: 'analysis-drums',
            manifestArtifactId: 'manifest-drums',
            payloadRef: { artifactId: 'payload-drums' },
            mediaFileId: 'media-drums',
            waveform: [0.12345, 0.8, 1.2, -0.1],
            enabled: false,
            gainDb: 4,
            phaseAligned: true,
            modelId: 'demucs-htdemucs-web',
            sourceFingerprint: 'sha256:source',
          },
        ],
      },
    };

    const persisted = clonePersistedClipAudioState(audioState);

    expect(persisted?.stemSeparation).toMatchObject({
      mixMode: 'hybrid',
      soloStemId: 'stem-drums',
      sourceGainDb: -3,
    });
    expect(persisted?.stemSeparation?.stems[0]).toMatchObject({
      id: 'stem-drums',
      enabled: false,
      gainDb: 4,
      mediaFileId: 'media-drums',
    });
    expect(persisted?.stemSeparation?.stems[0].waveform).toEqual([0.123, 0.8, 1, 0]);
  });
});
