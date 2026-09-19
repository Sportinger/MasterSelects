import { describe, expect, it } from 'vitest';

import { tryBuildNestedCompositionPassthroughLayer } from '../../src/services/layerBuilder/layerBuilderNestedCompositionPassthrough';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import type { Layer } from '../../src/types/layers';
import type { TimelineClip } from '../../src/types/timeline';

const transform = {
  opacity: 1,
  blendMode: 'normal' as const,
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 0, y: 0, z: 0 },
};

const nestedLayer = {
  id: 'nested-layer-video',
  name: 'Nested video',
  sourceClipId: 'nested-video:continuity-key',
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 0, y: 0, z: 0 },
  source: {
    type: 'video',
    videoElement: {} as HTMLVideoElement,
    mediaTime: 1,
  },
} as Layer;

const clip = {
  id: 'composition-clip',
  name: 'Child composition',
  trackId: 'video-1',
  startTime: 0,
  duration: 10,
  inPoint: 0,
  outPoint: 10,
  isComposition: true,
  compositionId: 'child-composition',
  effects: [],
  masks: [],
} as TimelineClip;

function createContext(isPlaying: boolean): FrameContext {
  return {
    activeCompId: 'parent-composition',
    isPlaying,
    compositionById: new Map([
      ['parent-composition', { id: 'parent-composition', width: 1920, height: 1080 }],
      ['child-composition', { id: 'child-composition', width: 1920, height: 1080 }],
    ]),
  } as unknown as FrameContext;
}

function build(isPlaying: boolean): Layer | null {
  return tryBuildNestedCompositionPassthroughLayer({
    clip,
    layerIndex: 0,
    ctx: createContext(isPlaying),
    nestedLayers: [nestedLayer],
    mappedAnimation: undefined,
    transform,
    effects: [],
    colorCorrection: undefined,
  });
}

describe('nested composition passthrough', () => {
  it('keeps live playback on the continuity-aware nested renderer path', () => {
    expect(build(true)).toBeNull();
  });

  it('still skips the intermediate render for an eligible paused frame', () => {
    expect(build(false)).toMatchObject({
      id: 'parent-composition_layer_0_composition-clip',
      sourceClipId: 'nested-video:continuity-key',
      source: { type: 'video', mediaTime: 1 },
    });
  });
});
