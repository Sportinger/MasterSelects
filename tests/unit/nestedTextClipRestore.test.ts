import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendNestedTextClip } from '../../src/stores/timeline/nestedComposition/nestedCompositionTextClip';
import { textRenderer } from '../../src/services/textRenderer';
import { renderTimelineTextCanvasRuntime } from '../../src/services/timeline/timelineGeneratedCanvasRuntime';
import type { TextClipProperties } from '../../src/types/text';
import type { SerializableClip, TimelineClip } from '../../src/types/timeline';

const textProperties: TextClipProperties = {
  text: 'Nested editable text',
  fontFamily: 'Inter',
  fontSize: 64,
  fontWeight: 700,
  fontStyle: 'normal',
  color: '#ffffff',
  textAlign: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.1,
  letterSpacing: 0,
  strokeEnabled: false,
  strokeColor: '#000000',
  strokeWidth: 0,
  shadowEnabled: false,
  shadowColor: '#000000',
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowBlur: 0,
  pathEnabled: false,
  pathPoints: [],
};

describe('nested text clip restoration', () => {
  beforeEach(() => {
    vi.mocked(textRenderer.createCanvas).mockImplementation(() => document.createElement('canvas'));
  });
  it('hydrates a regular nested text clip as an editable text canvas', async () => {
    const serializedClip: SerializableClip = {
      id: 'nested-text',
      trackId: 'text-track',
      name: 'Nested Text',
      mediaFileId: '',
      startTime: 0,
      duration: 30,
      inPoint: 0,
      outPoint: 30,
      sourceType: 'text',
      naturalDuration: 30,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      },
      effects: [],
      textProperties,
    };
    const output: TimelineClip[] = [];

    expect(await appendNestedTextClip(output, serializedClip, 'runtime-text', {
      width: 1280,
      height: 720,
    })).toBe(true);
    expect(output[0].source?.type).toBe('text');
    expect(output[0].source?.textCanvas?.width).toBe(1280);
    expect(output[0].source?.textCanvas?.height).toBe(720);
    expect(output[0].textProperties?.text).toBe('Nested editable text');
  });

  it('shares only the immutable initial raster for repeated static template instances', async () => {
    const serializedClip: SerializableClip = {
      id: 'static-template-text',
      trackId: 'text-track',
      name: 'Static Template Text',
      mediaFileId: '',
      startTime: 0,
      duration: 1,
      inPoint: 0,
      outPoint: 1,
      sourceType: 'text',
      naturalDuration: 1,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      },
      effects: [],
      textProperties,
    };
    const output: TimelineClip[] = [];
    await appendNestedTextClip(output, serializedClip, 'instance-a', { width: 512, height: 184 });
    await appendNestedTextClip(output, serializedClip, 'instance-b', { width: 512, height: 184 });

    expect(output[1].source?.textCanvas).toBe(output[0].source?.textCanvas);
    expect(output[1].textProperties).not.toBe(output[0].textProperties);
    expect(output[1].textProperties).toEqual(output[0].textProperties);
    const editedCanvas = renderTimelineTextCanvasRuntime({
      textProperties: { ...output[0].textProperties!, text: 'Edited instance' },
      currentCanvas: output[0].source?.textCanvas,
      dimensions: { width: 512, height: 184 },
    });
    expect(editedCanvas).not.toBe(output[0].source?.textCanvas);

    const distinctOutput: TimelineClip[] = [];
    await appendNestedTextClip(distinctOutput, {
      ...serializedClip,
      id: 'distinct-template-text',
      textProperties: structuredClone(textProperties),
    }, 'instance-c', { width: 512, height: 184 });
    expect(distinctOutput[0].source?.textCanvas).toBe(output[0].source?.textCanvas);
    const differentOutput: TimelineClip[] = [];
    await appendNestedTextClip(differentOutput, {
      ...serializedClip,
      id: 'different-template-text',
      textProperties: { ...textProperties, text: 'Different pixels' },
    }, 'instance-d', { width: 512, height: 184 });
    expect(differentOutput[0].source?.textCanvas).not.toBe(output[0].source?.textCanvas);
  });

  it('keeps keyframed nested text canvases independent', async () => {
    const serializedClip = {
      id: 'dynamic-template-text',
      trackId: 'text-track',
      name: 'Dynamic Template Text',
      mediaFileId: '',
      startTime: 0,
      duration: 1,
      inPoint: 0,
      outPoint: 1,
      sourceType: 'text' as const,
      naturalDuration: 1,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal' as const,
      },
      effects: [],
      textProperties,
      keyframes: [{ id: 'opacity', clipId: 'dynamic-template-text', property: 'opacity' as const, time: 0, value: 1, easing: 'linear' as const }],
    } satisfies SerializableClip;
    const output: TimelineClip[] = [];
    await appendNestedTextClip(output, serializedClip, 'dynamic-a', { width: 512, height: 184 });
    await appendNestedTextClip(output, serializedClip, 'dynamic-b', { width: 512, height: 184 });
    expect(output[1].source?.textCanvas).not.toBe(output[0].source?.textCanvas);
  });
});
