import { describe, expect, it } from 'vitest';

import type { MediaFile } from '../../src/stores/mediaStore';
import type { SeedancePlanningDocument } from '../../src/services/seedancePreproduction/contracts';
import { createSeedanceSourceBundleSnapshot } from '../../src/services/seedancePreproduction/sourceBundle';

describe('Seedance project source bundle projection', () => {
  it('keeps the public fingerprint pinned to the private kernel contract', async () => {
    const snapshot = await createSeedanceSourceBundleSnapshot({
      documents: [{
        id: 'one',
        name: 'notes.txt',
        mimeType: 'text/plain',
        text: 'Source facts.',
        truncated: false,
        byteLength: 13,
        createdAt: 1,
        format: 'text',
        lastModified: 1,
      }],
      mediaFiles: [],
    });
    expect(snapshot.fingerprint).toBe('570bd040eb1d044c495a6a3e91192a202d5587c32f0bc84c0f7f72d6305fc880');
  });

  it('collects documents, transcripts, analysis and scene descriptions deterministically', async () => {
    const document: SeedancePlanningDocument = {
      id: 'document-1',
      name: 'brief.md',
      mimeType: 'text/markdown',
      text: '# Facts\nBerlin is the location.',
      truncated: false,
      byteLength: 31,
      createdAt: 1,
      format: 'markdown',
      lastModified: 1,
    };
    const mediaFile = {
      id: 'media-1',
      fileHash: 'c'.repeat(64),
      name: 'interview.mp4',
      type: 'video',
      duration: 2,
      transcript: [{ id: 'word-1', text: 'Hello', start: 0, end: 0.5 }],
      analysis: {
        sampleInterval: 1_000,
        frames: [{
          timestamp: 0,
          motion: 0.2,
          globalMotion: 0.1,
          localMotion: 0.1,
          focus: 0.9,
          brightness: 0.5,
          faceCount: 1,
        }],
      },
      sceneDescriptions: [{ id: 'scene-1', text: 'A speaker in a studio.', start: 0, end: 2 }],
    } as MediaFile;

    const first = await createSeedanceSourceBundleSnapshot({
      documents: [document],
      mediaFiles: [mediaFile],
    });
    const second = await createSeedanceSourceBundleSnapshot({
      documents: [document],
      mediaFiles: [mediaFile],
    });

    expect(first.entries.map((entry) => entry.kind)).toEqual([
      'transcript',
      'document',
      'visual-frame-manifest',
      'media-metadata',
      'analysis',
      'scene-descriptions',
    ]);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(first.entries[2]!.content)).toMatchObject({
      intervalSeconds: 1,
      frameCount: 2,
      contactSheetCount: 1,
      sourceFingerprint: 'c'.repeat(64),
    });
    expect(JSON.parse(first.entries[4]!.content).frames[0]).not.toHaveProperty('faceCount');
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it('keeps a ready no-speech transcript as explicit source evidence', async () => {
    const snapshot = await createSeedanceSourceBundleSnapshot({
      documents: [],
      mediaFiles: [{
        id: 'silent-audio',
        name: 'Room tone.wav',
        type: 'audio',
        transcriptStatus: 'ready',
        transcript: [],
      } as MediaFile],
    });

    expect(snapshot.entries.map((entry) => entry.kind)).toEqual(['transcript', 'media-metadata']);
    expect(JSON.parse(snapshot.entries[0]!.content)).toMatchObject({ words: [] });
  });
});
