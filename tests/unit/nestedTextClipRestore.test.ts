import { describe, expect, it } from 'vitest';
import { appendNestedTextClip } from '../../src/stores/timeline/nestedComposition/nestedCompositionTextClip';
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
});
