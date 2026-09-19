import { describe, expect, it, vi } from 'vitest';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip } from '../../src/types/timeline';
import type { PropertyDescriptor } from '../../src/types/propertyRegistry';
import { createFlockProperty } from '../../src/types/flock';
import {
  buildFlockDisplayClipKeyframes,
  getDisplayKeyframesForClip,
  getFlockPropertyLabel,
} from '../../src/components/timeline/utils/flockKeyframeDisplay';
import { buildCurveGraphModel } from '../../src/components/timeline/utils/curveGraphModel';
import { getHeaderPropertyLabel } from '../../src/components/timeline/utils/timelineHeaderPropertyLabels';
import {
  createTimelineEmptyContextMenuModel,
  executeTimelineEmptyContextMenuCommand,
} from '../../src/components/timeline/utils/timelineEmptyContextMenu';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';

const secondSplitPiece = {
  id: 'clip-b',
  name: 'Flock B',
  startTime: 12,
  duration: 6,
  inPoint: 4,
  outPoint: 10,
  speed: 1,
} as unknown as TimelineClip;

function keyframe(id: string, property: string, time: number, value = 1): Keyframe {
  return { id, clipId: secondSplitPiece.id, property: property as Keyframe['property'], time, value, easing: 'linear' };
}

describe('flock source-time keyframe display', () => {
  const cohesion = createFlockProperty('fn-rules', 'cohesion');

  it('returns the original map when no clip has flock keys', () => {
    const map = new Map([[secondSplitPiece.id, [keyframe('k1', 'opacity', 1)]]]);
    expect(buildFlockDisplayClipKeyframes([secondSplitPiece], map)).toBe(map);
    const list = map.get(secondSplitPiece.id)!;
    expect(getDisplayKeyframesForClip(secondSplitPiece, list)).toBe(list);
  });

  it('maps source-time keys into clip-local display time and leaves other keys untouched', () => {
    const map = new Map([[secondSplitPiece.id, [
      keyframe('k-opacity', 'opacity', 5),
      keyframe('k-visible', cohesion, 6),
      keyframe('k-history', cohesion, 1),
    ]]]);
    const display = buildFlockDisplayClipKeyframes([secondSplitPiece], map);
    expect(display).not.toBe(map);
    const byId = new Map(display.get(secondSplitPiece.id)!.map((entry) => [entry.id, entry.time]));
    expect(byId.get('k-opacity')).toBe(5);
    expect(byId.get('k-visible')).toBeCloseTo(2, 4);
    // Source history before the visible window survives with a negative local time.
    expect(byId.get('k-history')).toBeCloseTo(-3, 3);
    expect(map.get(secondSplitPiece.id)!.find((entry) => entry.id === 'k-visible')!.time).toBe(6);
  });

  it('uses the clip speed resolver for retimed clips', () => {
    const resolver = vi.fn((_clipId: string, local: number) => local * 2);
    const display = getDisplayKeyframesForClip(
      { ...secondSplitPiece, speed: 2 },
      [keyframe('k', cohesion, 8)],
      resolver,
    );
    expect(display[0].time).toBeCloseTo(2, 3);
    expect(resolver).toHaveBeenCalled();
  });

  it('positions flock keys in the global curve graph at clip-local time', () => {
    const map = new Map([[secondSplitPiece.id, [keyframe('k-visible', cohesion, 7, 2)]]]);
    const display = buildFlockDisplayClipKeyframes([secondSplitPiece], map);
    const descriptor: PropertyDescriptor = {
      path: cohesion,
      label: 'Cohesion',
      group: 'Flock',
      valueType: 'number',
      animatable: true,
      defaultValue: 1,
    };
    const model = buildCurveGraphModel({
      propertyTargets: [{ clipId: secondSplitPiece.id, path: cohesion, descriptor }],
      clips: [secondSplitPiece],
      clipKeyframes: display,
    });
    expect(model.series).toHaveLength(1);
    expect(model.series[0].keyframes[0].localTime).toBeCloseTo(3, 4);
    expect(model.series[0].keyframes[0].compositionTime).toBeCloseTo(15, 4);
  });
});

describe('flock property labels', () => {
  const definition = createFlockPresetDefinition('free-swarm');
  const rules = definition.nodes.find((node) => node.operator === 'flock.rules')!;
  const emitter = definition.nodes.find((node) => node.operator === 'flock.emitter')!;

  it('labels node parameters and vector components', () => {
    expect(getFlockPropertyLabel(createFlockProperty(rules.id, 'cohesion'), definition)).toBe('Flock Rules / Cohesion');
    expect(getFlockPropertyLabel(createFlockProperty(emitter.id, 'center', 'x'), definition)).toBe('Emitter / Center X');
    expect(getFlockPropertyLabel(createFlockProperty('missing', 'strength'))).toBe('Flock / strength');
  });

  it('is used by the timeline header label resolver', () => {
    const clip = { id: 'c', startTime: 0, duration: 5, flock: definition };
    expect(getHeaderPropertyLabel(createFlockProperty(rules.id, 'separation'), clip)).toBe('Flock Rules / Separation');
  });
});

describe('flock Add Layer command', () => {
  it('passes the preset target to the add-layer handler', () => {
    const onAddTimelineLayer = vi.fn();
    const model = createTimelineEmptyContextMenuModel({ time: 2.5, trackId: 'video-1', trackType: 'video' });
    const command = model.layerCommands.find((candidate) => candidate.key === 'add-flock-krill-cloud')!;
    expect(executeTimelineEmptyContextMenuCommand(command, {
      onAddTimelineLayer,
      onEraseGap: vi.fn(),
      onEraseLayerGaps: vi.fn(),
      onEraseAllGaps: vi.fn(),
      onFitCompToWindow: vi.fn(),
    })).toBe(true);
    expect(onAddTimelineLayer).toHaveBeenCalledWith(2.5, 'video-1', 'flock:krill-cloud');
  });
});
