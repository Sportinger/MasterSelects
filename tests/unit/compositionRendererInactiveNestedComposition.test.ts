import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compositionRenderer } from '../../src/services/compositionRenderer';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { SerializableClip, TimelineTrack } from '../../src/types/timeline';

type MockMediaStore = typeof useMediaStore & {
  getState: ReturnType<typeof vi.fn>;
};

const mockedUseMediaStore = useMediaStore as unknown as MockMediaStore;

const videoTrack: TimelineTrack = {
  id: 'video-track',
  name: 'Video 1',
  type: 'video',
  height: 60,
  muted: false,
  visible: true,
  solo: false,
};

function makeComposition(id: string, clips: SerializableClip[]): Composition {
  return {
    id,
    name: id,
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 10,
    backgroundColor: '#000000',
    timelineData: {
      tracks: [videoTrack],
      clips,
      playheadPosition: 0,
      duration: 10,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    },
  };
}

function makeTextClip(): SerializableClip {
  return {
    id: 'child-text',
    trackId: videoTrack.id,
    name: 'Rotated text',
    mediaFileId: '',
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    sourceType: 'text',
    naturalDuration: 10,
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 10, y: 20, z: 26.421 },
    },
    effects: [],
    textProperties: {
      text: 'Enter text',
      fontSize: 48,
      fontFamily: 'Arial',
      color: '#00ccbb',
      backgroundColor: 'transparent',
      align: 'center',
      verticalAlign: 'middle',
    },
  };
}

function makeCompositionClip(
  id: string,
  compositionId: string,
  rotation = { x: 0, y: 0, z: 15 },
): SerializableClip {
  return {
    id,
    trackId: videoTrack.id,
    name: `Nested ${compositionId}`,
    mediaFileId: '',
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    sourceType: 'video',
    naturalDuration: 10,
    isComposition: true,
    compositionId,
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation,
    },
    effects: [],
  };
}

describe('compositionRenderer inactive nested compositions', () => {
  beforeEach(() => {
    for (const id of ['parent', 'child', 'cycle-a', 'cycle-b']) {
      compositionRenderer.disposeComposition(id);
    }
    useTimelineStore.setState({ clips: [], tracks: [videoTrack] });
  });

  afterEach(() => {
    for (const id of ['parent', 'child', 'cycle-a', 'cycle-b']) {
      compositionRenderer.disposeComposition(id);
    }
    vi.restoreAllMocks();
  });

  it('resolves a serialized child composition and keeps text rotation identical in pinned previews', async () => {
    const child = makeComposition('child', [makeTextClip()]);
    const parent = makeComposition('parent', [makeCompositionClip('parent-child', child.id)]);
    mockedUseMediaStore.getState.mockReturnValue({
      activeCompositionId: 'different-active-composition',
      compositions: [parent, child],
      files: [],
      proxyEnabled: false,
      activeLayerSlots: {},
    });

    await expect(compositionRenderer.prepareComposition(child.id)).resolves.toBe(true);
    await expect(compositionRenderer.prepareComposition(parent.id)).resolves.toBe(true);

    const childLayers = compositionRenderer.evaluateAtTime(child.id, 0);
    const parentLayers = compositionRenderer.evaluateAtTime(parent.id, 0);

    expect(childLayers).toHaveLength(1);
    expect(childLayers[0].rotation).toMatchObject({
      x: expect.closeTo(10 * Math.PI / 180, 8),
      y: expect.closeTo(20 * Math.PI / 180, 8),
      z: expect.closeTo(26.421 * Math.PI / 180, 8),
    });

    expect(parentLayers).toHaveLength(1);
    expect(parentLayers[0].rotation).toMatchObject({
      x: 0,
      y: 0,
      z: expect.closeTo(15 * Math.PI / 180, 8),
    });
    expect(parentLayers[0].source.nestedComposition).toMatchObject({
      compositionId: child.id,
      currentTime: 0,
      width: child.width,
      height: child.height,
    });
    expect(parentLayers[0].source.nestedComposition?.layers).toHaveLength(1);
    expect(parentLayers[0].source.nestedComposition?.layers[0].rotation)
      .toEqual(childLayers[0].rotation);
  });

  it('stops cyclic serialized composition references without recursing forever', async () => {
    const cycleA = makeComposition('cycle-a', [makeCompositionClip('a-to-b', 'cycle-b')]);
    const cycleB = makeComposition('cycle-b', [makeCompositionClip('b-to-a', 'cycle-a')]);
    mockedUseMediaStore.getState.mockReturnValue({
      activeCompositionId: 'different-active-composition',
      compositions: [cycleA, cycleB],
      files: [],
      proxyEnabled: false,
      activeLayerSlots: {},
    });

    await expect(compositionRenderer.prepareComposition(cycleA.id)).resolves.toBe(true);
    await expect(compositionRenderer.prepareComposition(cycleB.id)).resolves.toBe(true);

    expect(compositionRenderer.evaluateAtTime(cycleA.id, 0)).toEqual([]);
  });
});
