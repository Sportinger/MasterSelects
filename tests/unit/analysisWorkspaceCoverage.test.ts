import { describe, expect, it } from 'vitest';
import { buildAnalysisWorkspaceViewModel } from '../../src/components/panels/properties/analysisWorkspace/analysisWorkspaceAdapter';
import { partitionIndexedRanges } from '../../src/components/panels/properties/analysisWorkspace/analysisWorkspaceRangeIndex';

describe('analysis workspace measured coverage', () => {
  it('marks a ready channel complete in a covered scene even when it emitted zero events', () => {
    const result = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 0, outPoint: 10 },
      channels: {
        cuts: { status: 'ready', measuredRanges: [{ start: 0, end: 10 }] },
        metrics: { status: 'ready', measuredRanges: [{ start: 0, end: 10 }] },
        faces: { status: 'ready', measuredRanges: [{ start: 0, end: 10 }] },
        transcript: { status: 'ready', measuredRanges: [{ start: 0, end: 10 }] },
        descriptions: { status: 'ready', measuredRanges: [{ start: 0, end: 10 }] },
        audio: { status: 'ready', measuredRanges: [{ start: 0, end: 10 }] },
      },
    });

    expect(result.scenes[0].coverage).toMatchObject({
      cuts: { state: 'complete' }, speech: { state: 'complete' }, people: { state: 'complete' },
      motion: { state: 'complete' }, focus: { state: 'complete' }, quality: { state: 'complete' },
      text: { state: 'complete' }, audio: { state: 'complete' },
    });
    expect(result.overview.lanes.cuts).toEqual([]);
  });

  it('uses measured source ranges for partial rather than event-count coverage', () => {
    const result = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 0, outPoint: 10 },
      sceneSegments: [
        { id: 'one', text: 'One', start: 0, end: 5 },
        { id: 'two', text: 'Two', start: 5, end: 10 },
      ],
      channels: { metrics: { status: 'ready', measuredRanges: [{ start: 0, end: 3 }] } },
    });

    expect(result.scenes.map(scene => scene.coverage.motion?.state)).toEqual(['complete', 'partial']);
    expect(result.scenes.map(scene => scene.coverage.people?.state)).toEqual(['missing', 'missing']);
  });
});

describe('analysis workspace bounded range partition', () => {
  it('assigns sorted entries with a forward sweep and retains only boundary-crossing entries', () => {
    const scenes = Array.from({ length: 100 }, (_, index) => ({ start: index, end: index + 1 }));
    const entries = [
      { value: 'crossing', range: { start: 49.5, end: 50.5 } },
      { value: 'tail', range: { start: 99.25, end: 99.75 } },
    ];
    const partitioned = partitionIndexedRanges(scenes, entries);

    expect(partitioned[48]).toEqual([]);
    expect(partitioned[49]).toEqual(['crossing']);
    expect(partitioned[50]).toEqual(['crossing']);
    expect(partitioned[51]).toEqual([]);
    expect(partitioned[99]).toEqual(['tail']);
  });
});
