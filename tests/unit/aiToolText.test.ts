import { beforeEach, describe, expect, it } from 'vitest';

import { textToolDefinitions } from '../../src/services/aiTools/definitions/text';
import {
  handleAddTextBoundsKeyframe,
  handleCreateTextClip,
  handleGetTextProperties,
  handleSetTextBox,
  handleUpdateTextProperties,
} from '../../src/services/aiTools/handlers/text';
import { useTimelineStore } from '../../src/stores/timeline';

const initialTimelineState = useTimelineStore.getState();

function resetTimeline(): void {
  useTimelineStore.setState({
    ...initialTimelineState,
    clips: [],
    tracks: [
      {
        id: 'video-1',
        name: 'Video 1',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
      },
      {
        id: 'audio-1',
        name: 'Audio',
        type: 'audio',
        height: 48,
        muted: false,
        visible: true,
        solo: false,
      },
    ],
    playheadPosition: 2,
    clipKeyframes: new Map(),
  });
}

async function createTextClip() {
  const result = await handleCreateTextClip({
    text: 'MASTER\nSELECTS',
    duration: 6,
    fontFamily: 'Inter',
    fontSize: 128,
    fontWeight: 700,
    fontStyle: 'italic',
    color: '#f6ff00',
    textAlign: 'left',
    verticalAlign: 'bottom',
    lineHeight: 0.9,
    letterSpacing: 4,
    boxEnabled: true,
    boxX: 220,
    boxY: 300,
    boxWidth: 1480,
    boxHeight: 420,
    strokeEnabled: true,
    strokeColor: '#000000',
    strokeWidth: 8,
    shadowEnabled: true,
    shadowColor: 'rgba(0,0,0,0.7)',
    shadowOffsetX: 10,
    shadowOffsetY: 12,
    shadowBlur: 20,
  }, useTimelineStore.getState());
  expect(result.success).toBe(true);
  return result.data as {
    clipId: string;
    startTime: number;
    duration: number;
    textBox: { x: number; y: number; width: number; height: number };
    textProperties: Record<string, unknown>;
  };
}

describe('AI text authoring tools', () => {
  beforeEach(resetTimeline);

  it('publishes the complete eight-tool text surface', () => {
    expect(textToolDefinitions.map((tool) => tool.function.name)).toEqual([
      'getTextProperties',
      'createEditableTitleStack',
      'manageEditableHook',
      'refineEditableHook',
      'createTextClip',
      'updateTextProperties',
      'setTextBox',
      'addTextBoundsKeyframe',
    ]);

    const createDefinition = textToolDefinitions.find(
      (tool) => tool.function.name === 'createTextClip',
    )!;
    expect(Object.keys(createDefinition.function.parameters.properties)).toEqual(
      expect.arrayContaining([
        'text',
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'color',
        'textAlign',
        'verticalAlign',
        'lineHeight',
        'letterSpacing',
        'boxEnabled',
        'boxX',
        'boxY',
        'boxWidth',
        'boxHeight',
        'strokeEnabled',
        'strokeColor',
        'strokeWidth',
        'shadowEnabled',
        'shadowColor',
        'shadowOffsetX',
        'shadowOffsetY',
        'shadowBlur',
        'pathEnabled',
        'pathPoints',
      ]),
    );
  });

  it('creates an editable styled text clip at the playhead with exact pixel bounds', async () => {
    const data = await createTextClip();
    const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === data.clipId)!;

    expect(data.startTime).toBe(2);
    expect(data.duration).toBe(6);
    expect(data.textBox).toEqual({ x: 220, y: 300, width: 1480, height: 420 });
    expect(clip.trackId).toBe('video-1');
    expect(clip.source?.type).toBe('text');
    expect(clip.textProperties).toMatchObject({
      text: 'MASTER\nSELECTS',
      fontFamily: 'Inter',
      fontSize: 128,
      fontWeight: 700,
      fontStyle: 'italic',
      color: '#f6ff00',
      textAlign: 'left',
      verticalAlign: 'bottom',
      lineHeight: 0.9,
      letterSpacing: 4,
      boxEnabled: true,
      boxX: 220,
      boxY: 300,
      boxWidth: 1480,
      boxHeight: 420,
      strokeEnabled: true,
      strokeWidth: 8,
      shadowEnabled: true,
      shadowBlur: 20,
    });
    expect(clip.textProperties?.textBounds?.vertices).toHaveLength(4);
  });

  it('updates every style family and normalizes omitted bezier handles', async () => {
    const created = await createTextClip();
    const result = await handleUpdateTextProperties({
      clipId: created.clipId,
      text: 'CURVED',
      fontSize: 96,
      color: '#22d3ee',
      strokeEnabled: false,
      shadowEnabled: false,
      pathEnabled: true,
      pathPoints: [
        { x: 0.2, y: 0.6 },
        {
          x: 0.8,
          y: 0.4,
          handleIn: { x: -0.1, y: 0.1 },
          handleOut: { x: 0.1, y: -0.1 },
        },
      ],
    }, useTimelineStore.getState());

    expect(result.success).toBe(true);
    const props = useTimelineStore.getState().clips
      .find((clip) => clip.id === created.clipId)!.textProperties!;
    expect(props).toMatchObject({
      text: 'CURVED',
      fontSize: 96,
      color: '#22d3ee',
      strokeEnabled: false,
      shadowEnabled: false,
      pathEnabled: true,
    });
    expect(props.pathPoints[0]).toEqual({
      x: 0.2,
      y: 0.6,
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
    });
  });

  it('moves and resizes a text field without clamping it to the frame', async () => {
    const created = await createTextClip();
    const result = await handleSetTextBox({
      clipId: created.clipId,
      x: -80,
      y: 160,
      width: 960,
      height: 240,
    }, useTimelineStore.getState());

    expect(result.success).toBe(true);
    const data = result.data as { textBox: { x: number; y: number; width: number; height: number } };
    expect(data.textBox).toEqual({ x: -80, y: 160, width: 960, height: 240 });

    const read = await handleGetTextProperties(
      { clipId: created.clipId },
      useTimelineStore.getState(),
    );
    expect(read.success).toBe(true);
    expect((read.data as typeof data).textBox).toEqual(data.textBox);
  });

  it('adds clip-local keyframes for text-field position and size', async () => {
    const created = await createTextClip();
    const first = await handleAddTextBoundsKeyframe({
      clipId: created.clipId,
      time: 0,
      x: -600,
      y: 300,
      width: 700,
      height: 220,
      easing: 'ease-out',
    }, useTimelineStore.getState());
    const second = await handleAddTextBoundsKeyframe({
      clipId: created.clipId,
      time: 1,
      x: 220,
      y: 300,
      width: 1480,
      height: 420,
      easing: 'ease-in-out',
    }, useTimelineStore.getState());

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    const keyframes = useTimelineStore.getState().getClipKeyframes(created.clipId);
    expect(keyframes.map((keyframe) => keyframe.property)).toEqual([
      'textBounds.path',
      'textBounds.path',
    ]);
    expect(keyframes.map((keyframe) => keyframe.time)).toEqual([0, 1]);
    expect(keyframes.every((keyframe) => keyframe.pathValue?.vertices.length === 4)).toBe(true);
  });

  it('rejects unsafe ranges and incomplete text paths', async () => {
    expect((await handleCreateTextClip({
      text: 'Too large',
      fontSize: 501,
    }, useTimelineStore.getState())).error).toContain('fontSize');

    expect((await handleCreateTextClip({
      text: 'Broken path',
      pathEnabled: true,
      pathPoints: [{ x: 0.5, y: 0.5 }],
    }, useTimelineStore.getState())).error).toContain('at least two');
  });
});
