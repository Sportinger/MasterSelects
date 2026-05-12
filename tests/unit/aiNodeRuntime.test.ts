import { describe, expect, it } from 'vitest';
import {
  addClipCustomNodeDefinition,
  createClipAICustomNodeDefinition,
  hasRunnableAINodes,
  sortPixelsTexture,
} from '../../src/services/nodeGraph';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import type { TimelineClip } from '../../src/types';

function createClip(): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'video-1',
    name: 'Clip',
    file: new File([], 'clip.mp4', { type: 'video/mp4' }),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video' },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
  };
}

describe('AI node runtime', () => {
  it('sorts RGBA pixels deterministically', () => {
    const output = sortPixelsTexture({
      width: 3,
      height: 1,
      data: new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 0, 0, 255,
        0, 255, 0, 255,
      ]),
    });

    expect([...output.data]).toEqual([
      0, 0, 0, 255,
      0, 255, 0, 255,
      255, 0, 0, 255,
    ]);
  });

  it('does not run bypassed AI nodes', () => {
    const clip = createClip();
    const definition = {
      ...createClipAICustomNodeDefinition('custom-ai', clip),
      bypassed: true,
      status: 'ready' as const,
      ai: {
        prompt: 'sort all pixels',
        generatedCode: 'defineNode({ process(input) { return { output: input.input }; } })',
      },
    };
    const nodeGraph = addClipCustomNodeDefinition(clip, definition);

    expect(hasRunnableAINodes({ ...clip, nodeGraph })).toBe(false);
  });
});
