import { describe, expect, it } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter } from '../../../src/artifacts';
import { AudioArtifactStore } from '../../../src/services/audio/AudioArtifactStore';
import { writeProsodyContourArtifact } from '../../../src/services/audio/intelligence/prosody/prosodyWriter';
import type { ProsodyContourManifest } from '../../../src/services/audio/prosodyContourManifest';

function createStore(): AudioArtifactStore {
  return new AudioArtifactStore(
    new ArtifactStore(new MemoryArtifactStorageAdapter(), () => '2026-07-28T10:00:00.000Z'),
  );
}

describe('writeProsodyContourArtifact', () => {
  it('persists per-word emphasis in the manifest', async () => {
    const artifact = await writeProsodyContourArtifact({
      artifactStore: createStore(),
      mediaFileId: 'media-1',
      sourceFingerprint: 'audio-fingerprint+transcript=transcript-hash',
      sampleRate: 48000,
      analysisSampleRate: 16000,
      channelLayout: { kind: 'mono', channelCount: 1 },
      duration: 1,
      result: {
        hopSeconds: 0.05,
        windowSeconds: 0.04,
        f0Hz: new Float32Array([120]),
        voicing: new Float32Array([0.9]),
        energyRmsDb: new Float32Array([-18]),
        speechRateSps: new Float32Array([3]),
        summary: { medianF0Hz: 120 },
        wordEmphasis: [{ wordId: 'word-1', emphasis: 0.8, f0MeanHz: 120 }],
      },
    });

    const manifest = artifact.metadata?.prosodyContourManifest as unknown as ProsodyContourManifest;
    expect(manifest.wordEmphasis).toEqual([
      { wordId: 'word-1', emphasis: 0.8, f0MeanHz: 120 },
    ]);
  });
});