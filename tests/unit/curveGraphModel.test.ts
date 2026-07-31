import { describe, expect, it } from 'vitest';
import { propertyRegistry } from '../../src/services/properties';
import type { PropertyAuthoringContext } from '../../src/types/propertyRegistry';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip } from '../../src/types/timeline';
import {
  buildCurveGraphModel,
  curveAuthoringDeltaToStorage,
  curveAuthoringValueToStorage,
  curveCompositionTimeToLocalTime,
  curveLocalTimeToCompositionTime,
  curveStorageDeltaToAuthoring,
  getCurveSeriesId,
  planCurveGraphKeyframeDrag,
} from '../../src/components/timeline/utils/curveGraphModel';
import { createMockClip } from '../helpers/mockData';

function makeClip(id: string, startTime: number): TimelineClip {
  return createMockClip({ id, name: id, startTime, duration: 8 });
}

function makeKeyframe(
  id: string,
  clipId: string,
  property: Keyframe['property'],
  time: number,
  value: number,
  overrides: Partial<Keyframe> = {},
): Keyframe {
  return {
    id,
    clipId,
    property,
    time,
    value,
    easing: 'bezier',
    ...overrides,
  };
}

const pixelContext: PropertyAuthoringContext = {
  compositionId: 'comp-1',
  compositionWidth: 1920,
  compositionHeight: 1080,
  positionUnitMode: 'composition-pixels',
};

describe('universal global curve graph model', () => {
  it('builds exact universal series with absolute time and descriptor authoring units', () => {
    const clip = makeClip('video-a', 5);
    const position = propertyRegistry.getDescriptor('position.x', clip)!;
    const opacity = propertyRegistry.getDescriptor('opacity', clip)!;
    const blendMode = propertyRegistry.getDescriptor('blendMode', clip)!;
    const model = buildCurveGraphModel({
      propertyTargets: [
        { clipId: clip.id, path: 'position.x', descriptor: position },
        { clipId: clip.id, path: 'opacity', descriptor: opacity },
        { clipId: clip.id, path: 'blendMode', descriptor: blendMode },
      ],
      clips: [clip],
      clipKeyframes: new Map([[clip.id, [
        makeKeyframe('position-1', clip.id, 'position.x', 1, 0.2, {
          handleOut: { x: 0.5, y: 0.1 },
        }),
        makeKeyframe('position-2', clip.id, 'position.x', 3, 0.5),
        makeKeyframe('opacity-1', clip.id, 'opacity', 2, 0.4),
      ]]]),
      selectedKeyframeIds: new Set(['opacity-1']),
      authoringContextByClipId: new Map([[clip.id, pixelContext]]),
    });

    expect(model.series.map((series) => series.id)).toEqual([
      'video-a::position.x',
      'video-a::opacity',
    ]);
    expect(model.omittedSeries).toContainEqual({
      id: 'video-a::blendMode',
      reason: 'non-numeric',
    });
    expect(model.activeSeriesId).toBe('video-a::opacity');
    expect(model.selectedKeyframeIds).toEqual(new Set(['opacity-1']));

    const positionSeries = model.series[0];
    expect(positionSeries).toMatchObject({ unit: 'px', clipStartTime: 5, clipDuration: 8 });
    expect(positionSeries.keyframes[0]).toMatchObject({
      id: 'position-1',
      localTime: 1,
      compositionTime: 6,
      storageValue: 0.2,
      authoringValue: 192,
    });
    expect(curveStorageDeltaToAuthoring(position, 0.1, pixelContext)).toBe(96);
    expect(curveAuthoringDeltaToStorage(position, 96, pixelContext)).toBe(0.1);
    expect(curveAuthoringValueToStorage(positionSeries, 384)).toBe(0.4);

    expect(model.series[1]).toMatchObject({ unit: '%', range: { min: 0, max: 1 } });
  });

  it('uses canonical series identities and reversible absolute/local time adapters', () => {
    expect(getCurveSeriesId('clip::nested', 'effect.fx.gain')).toBe('clip::nested::effect.fx.gain');
    expect(curveLocalTimeToCompositionTime(12, 2.5)).toBe(14.5);
    expect(curveCompositionTimeToLocalTime(12, 5, 14.5)).toBe(2.5);
    expect(curveCompositionTimeToLocalTime(12, 5, 2)).toBe(0);
    expect(curveCompositionTimeToLocalTime(12, 5, 30)).toBe(5);
  });

  it('bounds rendered series and keyframes deterministically without changing canonical ids', () => {
    const clip = makeClip('bounded', 0);
    const position = propertyRegistry.getDescriptor('position.x', clip)!;
    const opacity = propertyRegistry.getDescriptor('opacity', clip)!;
    const model = buildCurveGraphModel({
      propertyTargets: [
        { clipId: clip.id, path: 'position.x', descriptor: position },
        { clipId: clip.id, path: 'position.x', descriptor: position },
        { clipId: clip.id, path: 'opacity', descriptor: opacity },
      ],
      clips: [clip],
      clipKeyframes: new Map([[clip.id, [
        makeKeyframe('position-1', clip.id, 'position.x', 1, 0),
        makeKeyframe('position-2', clip.id, 'position.x', 2, 0.1),
        makeKeyframe('opacity-1', clip.id, 'opacity', 1, 0.2),
        makeKeyframe('opacity-2', clip.id, 'opacity', 2, 0.8),
      ]]]),
      authoringContextByClipId: new Map([[clip.id, pixelContext]]),
      maxSeries: 1,
      maxKeyframes: 1,
    });

    expect(model.series).toHaveLength(1);
    expect(model.series[0].id).toBe('bounded::position.x');
    expect(model.series[0].keyframes.map((keyframe) => keyframe.id)).toEqual(['position-1']);
    expect(model).toMatchObject({
      totalCandidateSeries: 2,
      totalKeyframes: 4,
      renderedKeyframes: 1,
      truncatedSeries: true,
      truncatedKeyframes: true,
    });
  });

  it('plans shared composition-time movement with per-clip clamps and active-series-only values', () => {
    const firstClip = makeClip('first', 5);
    const secondClip = { ...makeClip('second', 20), duration: 4 };
    const firstOpacity = propertyRegistry.getDescriptor('opacity', firstClip)!;
    const secondOpacity = propertyRegistry.getDescriptor('opacity', secondClip)!;
    const model = buildCurveGraphModel({
      propertyTargets: [
        { clipId: firstClip.id, path: 'opacity', descriptor: firstOpacity },
        { clipId: secondClip.id, path: 'opacity', descriptor: secondOpacity },
      ],
      clips: [firstClip, secondClip],
      clipKeyframes: new Map([
        [firstClip.id, [
          makeKeyframe('first-a', firstClip.id, 'opacity', 1, 0.2),
          makeKeyframe('first-b', firstClip.id, 'opacity', 7, 0.7),
        ]],
        [secondClip.id, [
          makeKeyframe('second-a', secondClip.id, 'opacity', 2, 0.4),
        ]],
      ]),
    });
    const [firstSeries, secondSeries] = model.series;
    const planned = planCurveGraphKeyframeDrag({
      targets: [
        { series: firstSeries, keyframe: firstSeries.keyframes[0] },
        { series: firstSeries, keyframe: firstSeries.keyframes[1] },
        { series: secondSeries, keyframe: secondSeries.keyframes[0] },
      ],
      activeSeriesId: firstSeries.id,
      requestedCompositionDelta: 10,
      requestedAuthoringDelta: 0.1,
    });

    expect(planned.map((edit) => ({
      id: edit.keyframe.id,
      requested: edit.requestedLocalTime,
      resolved: edit.resolvedLocalTime,
      value: edit.storageValue === undefined
        ? undefined
        : Math.round(edit.storageValue * 1_000) / 1_000,
    }))).toEqual([
      { id: 'first-a', requested: 11, resolved: 2, value: 0.3 },
      { id: 'first-b', requested: 17, resolved: 8, value: 0.8 },
      { id: 'second-a', requested: 12, resolved: 4, value: undefined },
    ]);
  });

  it('fails closed for numeric descriptors whose authoring context cannot resolve', () => {
    const clip = makeClip('missing-context', 0);
    const position = propertyRegistry.getDescriptor('position.y', clip)!;
    const model = buildCurveGraphModel({
      propertyTargets: [{ clipId: clip.id, path: 'position.y', descriptor: position }],
      clips: [clip],
      clipKeyframes: new Map([[clip.id, [
        makeKeyframe('position-y', clip.id, 'position.y', 1, 0.2),
      ]]]),
    });

    expect(model.series).toEqual([]);
    expect(model.omittedSeries).toEqual([{
      id: 'missing-context::position.y',
      reason: 'authoring-conversion-failed',
    }]);
  });
});
