import { describe, expect, it } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter } from '../../../src/artifacts';
import { AudioArtifactStore } from '../../../src/services/audio/AudioArtifactStore';
import { buildProjectAudioStateIndex, collectAudioAnalysisArtifactIdsFromRefs } from '../../../src/services/audio/projectAudioState';
import type { AudioChannelLayout } from '../../../src/services/audio/audioArtifactTypes';

const FIXED_TIME = '2026-05-25T10:00:00.000Z';
const CREATED_AT_MS = Date.parse(FIXED_TIME);
const CHANNEL_LAYOUT: AudioChannelLayout = {
  kind: 'stereo',
  channelCount: 2,
  labels: ['L', 'R'],
};

function createStore(): AudioArtifactStore {
  return new AudioArtifactStore(
    new ArtifactStore(new MemoryArtifactStorageAdapter(), () => FIXED_TIME),
  );
}

describe('project audio state', () => {
  it('collects legacy and versioned analysis refs without duplicates', () => {
    expect(collectAudioAnalysisArtifactIdsFromRefs({
      waveformPyramidId: 'artifact:waveform',
      spectrogramTileSetIds: ['artifact:spectrum-a', 'artifact:spectrum-b'],
      waveformPyramid: { artifactId: 'artifact:waveform' },
      phaseCorrelation: { artifactId: 'artifact:phase' },
    })).toEqual([
      'artifact:waveform',
      'artifact:spectrum-a',
      'artifact:spectrum-b',
      'artifact:phase',
    ]);
  });

  it('builds a project-level audio artifact index without embedding payload bytes', async () => {
    const store = createStore();
    const stored = await store.putAnalysisArtifact({
      id: 'audio:waveform-pyramid:media-a:source',
      kind: 'waveform-pyramid',
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source',
      decoderId: 'test-decoder',
      decoderVersion: '1.0.0',
      analyzerVersion: 'waveform-test',
      sampleRate: 48_000,
      channelLayout: CHANNEL_LAYOUT,
      duration: 1,
      payloadRefs: [],
      createdAt: CREATED_AT_MS,
      stale: false,
      metadata: { waveformManifest: { mediaFileId: 'media-a' } },
    });
    const masterAudioState = {
      volumeDb: -1,
      limiterEnabled: true,
      truePeakCeilingDb: -1,
      targetLufs: -14,
    };

    const state = await buildProjectAudioStateIndex({
      media: [{
        audioAnalysisRefs: {
          waveformPyramidId: stored.artifact.manifestRef.artifactId,
          loudnessEnvelopeId: 'artifact:missing-loudness',
        },
      }],
      compositions: [{
        id: 'comp-1',
        masterAudioState,
        clips: [{
          audioState: {
            processedAnalysisRefs: {
              frequencySummaryId: 'artifact:missing-frequency',
            },
            bakeHistory: [{
              id: 'derived-a',
              mediaFileId: 'media-derived',
              sourceMediaFileId: 'media-a',
              operationIds: ['op-a'],
              createdAt: CREATED_AT_MS,
            }],
          },
        }],
      }],
      activeCompositionId: 'comp-1',
      artifactStore: store,
      now: () => FIXED_TIME,
    });

    expect(state).toEqual(expect.objectContaining({
      schemaVersion: 1,
      updatedAt: FIXED_TIME,
      masterAudioState,
      analysisArtifactIds: [
        stored.artifact.manifestRef.artifactId,
        'artifact:missing-loudness',
        'artifact:missing-frequency',
      ],
      derivedAssets: [
        expect.objectContaining({ id: 'derived-a' }),
      ],
    }));
    expect(state?.analysisArtifacts).toEqual([
      expect.objectContaining({
        id: 'audio:waveform-pyramid:media-a:source',
        kind: 'waveform-pyramid',
        manifestRef: expect.objectContaining({
          artifactId: stored.artifact.manifestRef.artifactId,
          mimeType: 'application/vnd.masterselects.audio-analysis+json',
        }),
      }),
    ]);
    expect(JSON.stringify(state)).not.toContain('Float32Array');
    expect(JSON.stringify(state)).not.toContain('blob:');
  });
});
