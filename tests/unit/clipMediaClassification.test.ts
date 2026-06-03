import { describe, expect, it } from 'vitest';
import type { TimelineClip } from '../../src/types';
import { resolveClipMediaClassification } from '../../src/components/timeline/utils/clipMediaClassification';

function makeClip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    name: 'clip.mp4',
    file: new File(['x'], 'clip.mp4', { type: 'video/mp4' }),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video' },
    transform: {} as TimelineClip['transform'],
    effects: [],
    ...overrides,
  } as TimelineClip;
}

describe('clip media classification', () => {
  it('classifies audio by source type, MIME type, or extension', () => {
    expect(resolveClipMediaClassification(makeClip({
      source: { type: 'audio' },
    })).isAudioClip).toBe(true);

    expect(resolveClipMediaClassification(makeClip({
      file: new File(['x'], 'voice.bin', { type: 'audio/wav' }),
    })).isAudioClip).toBe(true);

    expect(resolveClipMediaClassification(makeClip({
      name: 'voice.flac',
      file: new File(['x'], 'voice.flac', { type: '' }),
    }))).toMatchObject({
      isAudioClip: true,
      clipTypeClass: 'audio',
    });
  });

  it('separates text, 3D text, and model clips', () => {
    expect(resolveClipMediaClassification(makeClip({
      source: { type: 'text' },
    }))).toMatchObject({
      isTextClip: true,
      clipTypeClass: 'text',
    });

    expect(resolveClipMediaClassification(makeClip({
      source: { type: 'model', meshType: 'text3d' },
    }))).toMatchObject({
      isText3DClip: true,
      isModelClip: false,
      clipTypeClass: 'text',
    });

    expect(resolveClipMediaClassification(makeClip({
      source: { type: 'model' },
    }))).toMatchObject({
      isModelClip: true,
      staticClipIconKind: 'model',
      showsStaticClipArtwork: true,
      clipTypeClass: 'model',
    });
  });

  it('resolves vector and static artwork metadata', () => {
    expect(resolveClipMediaClassification(makeClip({
      source: { type: 'rive' },
    }))).toMatchObject({
      isVectorAnimationClip: true,
      vectorAnimationIcon: 'R',
      vectorAnimationTitle: 'Rive Clip',
      clipTypeClass: 'rive',
    });

    expect(resolveClipMediaClassification(makeClip({
      source: { type: 'camera' },
    }))).toMatchObject({
      isCameraClip: true,
      staticClipIconKind: 'camera',
      showsStaticClipArtwork: true,
      clipTypeClass: 'camera',
    });

    expect(resolveClipMediaClassification(makeClip({
      source: { type: 'splat-effector' },
    }))).toMatchObject({
      isSplatEffectorClip: true,
      staticClipIconKind: null,
      showsStaticClipArtwork: false,
      clipTypeClass: 'splat-effector',
    });
  });
});
