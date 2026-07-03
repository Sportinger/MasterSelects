import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareTransitionCompositionsForExport } from '../../src/engine/export/prepareTransitionCompositionsForExport';
import { compositionRenderer } from '../../src/services/compositionRenderer';
import { useMediaStore, type Composition } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { SerializableClip } from '../../src/types/timeline';
import { installFakeMediaStore } from '../helpers/fakeMediaStore';
import { createMockClip } from '../helpers/mockData';

vi.mock('../../src/services/compositionRenderer', () => ({
  compositionRenderer: { prepareComposition: vi.fn() },
}));

const prepareCompositionMock = vi.mocked(compositionRenderer.prepareComposition);

function transitionClip(id: string, compositionId: string): SerializableClip {
  return {
    id,
    trackId: 'track-1',
    name: id,
    mediaFileId: `${id}-media`,
    startTime: 0,
    duration: 1,
    inPoint: 0,
    outPoint: 1,
    sourceType: 'video',
    naturalDuration: 1,
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    transitionOut: {
      id: `transition-${id}`,
      type: 'crossfade',
      duration: 1,
      linkedClipId: `${id}-next`,
      compositionId,
    },
  };
}

function composition(id: string, clips: SerializableClip[] = []): Composition {
  return {
    id,
    name: id,
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 1,
    backgroundColor: '#000000',
    timelineData: { tracks: [], clips, duration: 1 },
    transitionComp: {
      kind: 'transition-comp',
      parentCompositionId: 'parent',
      parentTransitionId: `transition-${id}`,
      parentOutgoingClipId: `${id}-out`,
      parentIncomingClipId: `${id}-in`,
      linkedOutgoingClipId: `${id}-out`,
      linkedIncomingClipId: `${id}-in`,
      innerTransitionId: '',
      paddingBefore: 0,
      paddingAfter: 0,
      bodyStart: 0,
      bodyEnd: 1,
      templateType: 'crossfade',
      templateVersion: 2,
    },
  };
}

describe('prepareTransitionCompositionsForExport', () => {
  beforeEach(() => {
    prepareCompositionMock.mockReset();
    useTimelineStore.setState({ clips: [] });
    installFakeMediaStore();
  });

  it('prepares transition comps referenced by the timeline and nested transition comps', async () => {
    const nestedRuntimeClip = createMockClip({
      id: 'nested-runtime',
      transitionOut: {
        id: 'transition-nested-runtime',
        type: 'crossfade',
        duration: 1,
        linkedClipId: 'nested-runtime-next',
        compositionId: 'transition-comp-nested',
      },
    });
    useTimelineStore.setState({
      clips: [
        createMockClip({
          id: 'clip-a',
          transitionOut: {
            id: 'transition-a',
            type: 'crossfade',
            duration: 1,
            linkedClipId: 'clip-b',
            compositionId: 'transition-comp-a',
          },
          nestedClips: [nestedRuntimeClip],
        }),
      ],
    });
    useMediaStore.setState({
      compositions: [
        composition('transition-comp-a', [transitionClip('nested', 'transition-comp-from-timeline-data')]),
        composition('transition-comp-from-timeline-data'),
        composition('transition-comp-nested'),
      ],
    });
    prepareCompositionMock.mockResolvedValue(true);

    await prepareTransitionCompositionsForExport();

    expect(new Set(prepareCompositionMock.mock.calls.map(([compositionId]) => compositionId))).toEqual(new Set([
      'transition-comp-a',
      'transition-comp-from-timeline-data',
      'transition-comp-nested',
    ]));
  });

  it('throws instead of exporting when a transition comp cannot be prepared', async () => {
    useTimelineStore.setState({
      clips: [
        createMockClip({
          id: 'clip-a',
          transitionOut: {
            id: 'transition-a',
            type: 'crossfade',
            duration: 1,
            linkedClipId: 'clip-b',
            compositionId: 'missing-transition-comp',
          },
        }),
      ],
    });
    prepareCompositionMock.mockResolvedValue(false);

    await expect(prepareTransitionCompositionsForExport()).rejects.toThrow(
      'Transition composition export preparation failed: missing-transition-comp',
    );
  });
});
