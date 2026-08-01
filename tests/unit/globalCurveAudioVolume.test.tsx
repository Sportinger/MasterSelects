import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  TimelineGlobalCurveSurface,
} from '../../src/components/timeline/TimelineGlobalCurveSurface';
import {
  buildCurveGraphModel,
  getCurveSeriesId,
} from '../../src/components/timeline/utils/curveGraphModel';
import { buildMotionPropertyTargetModel } from '../../src/services/motionDesign/propertyTargets';
import { propertyRegistry } from '../../src/services/properties';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip } from '../helpers/mockData';

const CLIP_ID = 'audio-clip:global-volume';
const VOLUME_EFFECT_ID = 'clip-volume';
const VOLUME_PATH = `effect.${VOLUME_EFFECT_ID}.volume`;

function audioClip(): TimelineClip {
  return createMockClip({
    id: CLIP_ID,
    trackId: 'audio-track:dialogue',
    name: 'Dialogue Clip',
    source: { type: 'audio', naturalDuration: 6 },
    duration: 6,
    outPoint: 6,
    effects: [{
      id: VOLUME_EFFECT_ID,
      name: 'Volume',
      type: 'audio-volume',
      enabled: true,
      params: { volume: 0.8 },
    }],
  });
}

function volumeKeyframes(): Keyframe[] {
  return [{
    id: 'volume:quiet',
    clipId: CLIP_ID,
    property: VOLUME_PATH,
    time: 0,
    value: 0.25,
    easing: 'linear',
  }, {
    id: 'volume:full',
    clipId: CLIP_ID,
    property: VOLUME_PATH,
    time: 4,
    value: 1,
    easing: 'easeInOut',
  }];
}

describe('Global Curve clip-volume regression', () => {
  it('shows an existing audio-volume automation path as one numeric Volume series only', () => {
    const clip = audioClip();
    const keyframes = volumeKeyframes();
    const clipKeyframes = new Map([[clip.id, keyframes]]);
    const descriptor = propertyRegistry.getDescriptor(VOLUME_PATH, clip);

    expect(descriptor).toMatchObject({
      path: VOLUME_PATH,
      label: 'Volume',
      valueType: 'number',
      animatable: true,
    });

    const targets = buildMotionPropertyTargetModel({
      registry: propertyRegistry,
      clips: [clip],
      animatedByClip: clipKeyframes,
    });
    expect(targets.targets).toEqual([
      expect.objectContaining({
        id: `${CLIP_ID}::${VOLUME_PATH}`,
        clipId: CLIP_ID,
        path: VOLUME_PATH,
        priority: 'animated',
        descriptor: expect.objectContaining({
          label: 'Volume',
          valueType: 'number',
        }),
      }),
    ]);

    const graph = buildCurveGraphModel({
      propertyTargets: targets.targets,
      clips: [clip],
      clipKeyframes,
      activeSeriesId: getCurveSeriesId(CLIP_ID, VOLUME_PATH),
    });
    expect(graph.series).toEqual([
      expect.objectContaining({
        id: getCurveSeriesId(CLIP_ID, VOLUME_PATH),
        clipId: CLIP_ID,
        clipName: 'Dialogue Clip',
        property: VOLUME_PATH,
        label: 'Volume',
        unit: '%',
        descriptor: expect.objectContaining({ valueType: 'number' }),
        keyframes: [
          expect.objectContaining({ id: 'volume:quiet', authoringValue: 0.25 }),
          expect.objectContaining({ id: 'volume:full', authoringValue: 1 }),
        ],
      }),
    ]);
    expect(graph.omittedSeries).toEqual([]);

    const { container } = render(
      <TimelineGlobalCurveSurface
        activeComposition={null}
        applyTimelineEditOperation={vi.fn((operation) => ({
          success: true,
          operationId: operation.id,
          changedClipIds: [],
          warnings: [],
        }))}
        clipKeyframes={clipKeyframes}
        clips={[clip]}
        height={260}
        onSelectKeyframe={vi.fn()}
        pixelToTime={(pixel) => pixel / 100}
        preferredTarget={{ clipId: CLIP_ID, property: VOLUME_PATH }}
        primaryClipId={CLIP_ID}
        scrollX={0}
        selectedClipIds={new Set([CLIP_ID])}
        selectedKeyframeIds={new Set()}
        timeToPixel={(time) => time * 100}
        trackHeaderWidth={240}
        width={760}
      />,
    );

    expect(screen.getByRole('tab', { name: /Volume/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(container.querySelectorAll('.global-curve-editor-series')).toHaveLength(1);
    expect(container.querySelectorAll('.global-curve-editor-keyframe')).toHaveLength(2);
    expect(container.querySelector(
      `.global-curve-editor-series[data-series-id="${getCurveSeriesId(CLIP_ID, VOLUME_PATH)}"]`,
    )).not.toBeNull();
    expect(screen.queryByText(/Track Volume|Master Volume/)).not.toBeInTheDocument();
  });
});
