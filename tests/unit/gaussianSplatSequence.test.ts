import { describe, expect, it } from 'vitest';

import {
  buildGaussianSplatSequenceData,
  getGaussianSplatSequenceFrameIndex,
  getGaussianSplatSequenceFrameRuntimeKey,
  getGaussianSplatSequenceFrameUrl,
  groupGaussianSplatSequenceEntries,
  resolveGaussianSplatSequenceData,
} from '../../src/utils/gaussianSplatSequence';

function createSplatFile(name: string): File {
  return new File(['splat'], name, { type: 'application/octet-stream' });
}

describe('gaussianSplatSequence utilities', () => {
  it('groups numbered ply files into a single ordered sequence', () => {
    const entries = [
      { file: createSplatFile('scan000002.ply') },
      { file: createSplatFile('scan000000.ply') },
      { file: createSplatFile('scan000001.ply') },
      { file: createSplatFile('single.ply') },
    ];

    const { sequences, singles } = groupGaussianSplatSequenceEntries(entries);

    expect(sequences).toHaveLength(1);
    expect(sequences[0]).toMatchObject({
      displayName: 'scan (3f)',
      frameCount: 3,
      sequenceName: 'scan',
    });
    expect(sequences[0]?.entries.map((entry) => entry.file.name)).toEqual([
      'scan000000.ply',
      'scan000001.ply',
      'scan000002.ply',
    ]);
    expect(singles.map((entry) => entry.file.name)).toEqual(['single.ply']);
  });

  it('clamps or loops frame selection based on playback mode', () => {
    const clampSequence = buildGaussianSplatSequenceData([
      { name: 'frame000000.ply', splatUrl: 'blob:splat-0' },
      { name: 'frame000001.ply', splatUrl: 'blob:splat-1' },
      { name: 'frame000002.ply', splatUrl: 'blob:splat-2' },
    ], {
      fps: 2,
      playbackMode: 'clamp',
    });

    const loopSequence = buildGaussianSplatSequenceData(clampSequence.frames, {
      fps: 2,
      playbackMode: 'loop',
    });

    expect(getGaussianSplatSequenceFrameIndex(clampSequence, 0)).toBe(0);
    expect(getGaussianSplatSequenceFrameIndex(clampSequence, 0.5)).toBe(1);
    expect(getGaussianSplatSequenceFrameIndex(clampSequence, 2)).toBe(2);
    expect(getGaussianSplatSequenceFrameIndex(loopSequence, 2)).toBe(1);
    expect(getGaussianSplatSequenceFrameUrl(loopSequence, 2)).toBe('blob:splat-1');
  });

  it('falls back to the nearest loaded frame url and runtime key when the target frame is missing', () => {
    const sequence = buildGaussianSplatSequenceData([
      {
        name: 'frame000000.ply',
        projectPath: 'Raw/frame000000.ply',
        splatUrl: 'blob:splat-0',
      },
      {
        name: 'frame000001.ply',
      },
      {
        name: 'frame000002.ply',
        absolutePath: 'C:/capture/frame000002.ply',
        splatUrl: 'blob:splat-2',
      },
    ], {
      fps: 2,
      playbackMode: 'clamp',
    });

    expect(getGaussianSplatSequenceFrameUrl(sequence, 0.5, 'blob:fallback')).toBe('blob:splat-0');
    expect(getGaussianSplatSequenceFrameUrl(undefined, 0.5, 'blob:fallback')).toBe('blob:fallback');
    expect(getGaussianSplatSequenceFrameRuntimeKey(sequence, 1.1, 'fallback-key')).toBe('C:/capture/frame000002.ply');
    expect(getGaussianSplatSequenceFrameRuntimeKey(undefined, 1.1, 'fallback-key')).toBe('fallback-key');
  });

  it('hydrates serialized splat sequence frames from the media-store sequence when runtime data is missing', () => {
    const restored = resolveGaussianSplatSequenceData(
      buildGaussianSplatSequenceData([
        { name: 'scan000000.ply', projectPath: 'Raw/scan000000.ply' },
        { name: 'scan000001.ply', projectPath: 'Raw/scan000001.ply' },
      ]),
      buildGaussianSplatSequenceData([
        { name: 'scan000000.ply', projectPath: 'Raw/scan000000.ply', file: createSplatFile('scan000000.ply'), splatUrl: 'blob:scan-0' },
        { name: 'scan000001.ply', projectPath: 'Raw/scan000001.ply', file: createSplatFile('scan000001.ply'), splatUrl: 'blob:scan-1' },
      ]),
    );

    expect(restored?.frames[0]).toEqual(expect.objectContaining({
      file: expect.any(File),
      splatUrl: 'blob:scan-0',
    }));
    expect(restored?.frames[1]).toEqual(expect.objectContaining({
      file: expect.any(File),
      splatUrl: 'blob:scan-1',
    }));
  });

  it('ignores persisted plain-object files and stale blob urls when a restored media sequence is available', () => {
    const restored = resolveGaussianSplatSequenceData(
      buildGaussianSplatSequenceData([
        {
          name: 'scan000000.ply',
          projectPath: 'Raw/scan000000.ply',
          file: {} as File,
          splatUrl: 'blob:stale-0',
        },
        {
          name: 'scan000001.ply',
          projectPath: 'Raw/scan000001.ply',
          file: {} as File,
          splatUrl: 'blob:stale-1',
        },
      ]),
      buildGaussianSplatSequenceData([
        { name: 'scan000000.ply', projectPath: 'Raw/scan000000.ply', file: createSplatFile('scan000000.ply'), splatUrl: 'blob:scan-0' },
        { name: 'scan000001.ply', projectPath: 'Raw/scan000001.ply', file: createSplatFile('scan000001.ply'), splatUrl: 'blob:scan-1' },
      ]),
    );

    expect(restored?.frames[0]).toEqual(expect.objectContaining({
      file: expect.any(File),
      splatUrl: 'blob:scan-0',
    }));
    expect(restored?.frames[1]).toEqual(expect.objectContaining({
      file: expect.any(File),
      splatUrl: 'blob:scan-1',
    }));
  });
});
