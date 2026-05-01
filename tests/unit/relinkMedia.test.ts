import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../../src/stores/mediaStore';
import {
  findRelinkMatch,
  getRelinkExpectedFileNames,
  type RelinkCandidate,
  type RelinkCandidateMap,
} from '../../src/services/project/relinkMedia';

function candidate(name: string): RelinkCandidate {
  return {
    name,
    file: new File(['data'], name, { type: 'application/octet-stream' }),
  };
}

function candidateMap(...names: string[]): RelinkCandidateMap {
  return new Map(names.map((name) => [name.toLowerCase(), candidate(name)]));
}

describe('relink media matching', () => {
  it('matches gaussian splat sequences by frame names instead of display name', () => {
    const mediaFile = {
      id: 'media-splat-seq',
      name: 'scan (2f)',
      type: 'gaussian-splat',
      parentId: null,
      createdAt: 1,
      url: '',
      gaussianSplatSequence: {
        fps: 30,
        frameCount: 2,
        playbackMode: 'clamp',
        frames: [
          { name: 'scan000000.ply', projectPath: 'Raw/scan/scan000000.ply' },
          { name: 'scan000001.ply', projectPath: 'Raw/scan/scan000001.ply' },
        ],
      },
    } as MediaFile;

    const expectedNames = getRelinkExpectedFileNames(mediaFile);
    expect(expectedNames).toContain('scan000000.ply');
    expect(expectedNames).toContain('scan000001.ply');
    expect(expectedNames).not.toContain('scan (2f)');

    const match = findRelinkMatch(mediaFile, candidateMap('scan000000.ply', 'scan000001.ply'));

    expect(match).toEqual({
      kind: 'gaussian-splat-sequence',
      frames: [
        { index: 0, candidate: expect.objectContaining({ name: 'scan000000.ply' }) },
        { index: 1, candidate: expect.objectContaining({ name: 'scan000001.ply' }) },
      ],
    });
  });

  it('does not mark a sequence found when only the media display name exists', () => {
    const mediaFile = {
      id: 'media-model-seq',
      name: 'hero (2f)',
      type: 'model',
      parentId: null,
      createdAt: 1,
      url: '',
      modelSequence: {
        fps: 30,
        frameCount: 2,
        playbackMode: 'clamp',
        frames: [
          { name: 'hero000000.glb', projectPath: 'Raw/hero/hero000000.glb' },
          { name: 'hero000001.glb', projectPath: 'Raw/hero/hero000001.glb' },
        ],
      },
    } as MediaFile;

    expect(findRelinkMatch(mediaFile, candidateMap('hero (2f)'))).toBeNull();
  });

  it('allows directly picked renamed files for single-media relink', () => {
    const mediaFile = {
      id: 'media-video',
      name: 'old-name.mp4',
      type: 'video',
      parentId: null,
      createdAt: 1,
      url: '',
      filePath: 'C:/old/old-name.mp4',
    } as MediaFile;
    const directCandidate = candidate('renamed-file.mp4');

    const match = findRelinkMatch(mediaFile, new Map(), { directCandidate });

    expect(match).toEqual({
      kind: 'single',
      candidate: directCandidate,
    });
  });

  it('does not match unrelated single-media files without direct selection', () => {
    const mediaFile = {
      id: 'media-video',
      name: 'clip-a.mp4',
      type: 'video',
      parentId: null,
      createdAt: 1,
      url: '',
    } as MediaFile;

    expect(findRelinkMatch(mediaFile, candidateMap('clip-b.mp4'))).toBeNull();
  });
});
