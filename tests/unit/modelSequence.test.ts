import { describe, expect, it } from 'vitest';

import {
  buildModelSequenceData,
  getModelSequenceFrameIndex,
  getModelSequenceFrameUrl,
  groupModelSequenceEntries,
  resolveModelSequenceData,
} from '../../src/utils/modelSequence';

function createGlbFile(name: string): File {
  return new File(['glb'], name, { type: 'model/gltf-binary' });
}

describe('modelSequence utilities', () => {
  it('groups numbered glb files into a single ordered sequence', () => {
    const entries = [
      { file: createGlbFile('hero000002.glb') },
      { file: createGlbFile('hero000000.glb') },
      { file: createGlbFile('hero000001.glb') },
      { file: createGlbFile('other.glb') },
    ];

    const { sequences, singles } = groupModelSequenceEntries(entries);

    expect(sequences).toHaveLength(1);
    expect(sequences[0]).toMatchObject({
      displayName: 'hero (3f)',
      frameCount: 3,
      sequenceName: 'hero',
    });
    expect(sequences[0]?.entries.map((entry) => entry.file.name)).toEqual([
      'hero000000.glb',
      'hero000001.glb',
      'hero000002.glb',
    ]);
    expect(singles.map((entry) => entry.file.name)).toEqual(['other.glb']);
  });

  it('clamps or loops frame selection based on playback mode', () => {
    const clampSequence = buildModelSequenceData([
      { name: 'frame000000.glb', modelUrl: 'blob:frame-0' },
      { name: 'frame000001.glb', modelUrl: 'blob:frame-1' },
      { name: 'frame000002.glb', modelUrl: 'blob:frame-2' },
    ], {
      fps: 2,
      playbackMode: 'clamp',
    });

    const loopSequence = buildModelSequenceData(clampSequence.frames, {
      fps: 2,
      playbackMode: 'loop',
    });

    expect(getModelSequenceFrameIndex(clampSequence, 0)).toBe(0);
    expect(getModelSequenceFrameIndex(clampSequence, 0.5)).toBe(1);
    expect(getModelSequenceFrameIndex(clampSequence, 2)).toBe(2);
    expect(getModelSequenceFrameIndex(loopSequence, 2)).toBe(1);
    expect(getModelSequenceFrameUrl(loopSequence, 2)).toBe('blob:frame-1');
  });

  it('falls back to the nearest loaded frame url when the target frame is missing', () => {
    const sequence = buildModelSequenceData([
      { name: 'frame000000.glb', modelUrl: 'blob:frame-0' },
      { name: 'frame000001.glb' },
      { name: 'frame000002.glb', modelUrl: 'blob:frame-2' },
    ], {
      fps: 2,
      playbackMode: 'clamp',
    });

    expect(getModelSequenceFrameUrl(sequence, 0.5, 'blob:fallback')).toBe('blob:frame-0');
    expect(getModelSequenceFrameUrl(undefined, 0.5, 'blob:fallback')).toBe('blob:fallback');
  });

  it('hydrates serialized sequence frames from the media-store sequence when runtime data is missing', () => {
    const restored = resolveModelSequenceData(
      buildModelSequenceData([
        { name: 'hero000000.glb', projectPath: 'Raw/hero000000.glb' },
        { name: 'hero000001.glb', projectPath: 'Raw/hero000001.glb' },
      ]),
      buildModelSequenceData([
        { name: 'hero000000.glb', projectPath: 'Raw/hero000000.glb', file: createGlbFile('hero000000.glb'), modelUrl: 'blob:hero-0' },
        { name: 'hero000001.glb', projectPath: 'Raw/hero000001.glb', file: createGlbFile('hero000001.glb'), modelUrl: 'blob:hero-1' },
      ]),
    );

    expect(restored?.frames[0]).toEqual(expect.objectContaining({
      file: expect.any(File),
      modelUrl: 'blob:hero-0',
    }));
    expect(restored?.frames[1]).toEqual(expect.objectContaining({
      file: expect.any(File),
      modelUrl: 'blob:hero-1',
    }));
  });

  it('ignores persisted plain-object files and stale blob urls when a restored media sequence is available', () => {
    const restored = resolveModelSequenceData(
      buildModelSequenceData([
        {
          name: 'hero000000.glb',
          projectPath: 'Raw/hero000000.glb',
          file: {} as File,
          modelUrl: 'blob:stale-0',
        },
        {
          name: 'hero000001.glb',
          projectPath: 'Raw/hero000001.glb',
          file: {} as File,
          modelUrl: 'blob:stale-1',
        },
      ]),
      buildModelSequenceData([
        { name: 'hero000000.glb', projectPath: 'Raw/hero000000.glb', file: createGlbFile('hero000000.glb'), modelUrl: 'blob:hero-0' },
        { name: 'hero000001.glb', projectPath: 'Raw/hero000001.glb', file: createGlbFile('hero000001.glb'), modelUrl: 'blob:hero-1' },
      ]),
    );

    expect(restored?.frames[0]).toEqual(expect.objectContaining({
      file: expect.any(File),
      modelUrl: 'blob:hero-0',
    }));
    expect(restored?.frames[1]).toEqual(expect.objectContaining({
      file: expect.any(File),
      modelUrl: 'blob:hero-1',
    }));
  });
});
