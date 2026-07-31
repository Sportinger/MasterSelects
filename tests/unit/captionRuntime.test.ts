import { describe, expect, it } from 'vitest';
import {
  cloneDefaultCaptionProperties,
  createCaptionTextProperties,
} from '../../src/services/captions/captionDefaults';
import {
  createCaptionFrameModel,
  defaultCaptionSourceTime,
  getCaptionSourceCandidates,
  groupCaptionWords,
  resolveCaptionSourceAtTime,
} from '../../src/services/captions/captionRuntime';
import type { TranscriptWord } from '../../src/types/clipMetadata';
import type { TextClipProperties } from '../../src/types/text';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const tracks: TimelineTrack[] = [
  {
    id: 'captions',
    name: 'Captions',
    type: 'video',
    height: 60,
    muted: false,
    visible: true,
    solo: false,
  },
  {
    id: 'video-top',
    name: 'Video 2',
    type: 'video',
    height: 60,
    muted: false,
    visible: true,
    solo: false,
  },
  {
    id: 'video-bottom',
    name: 'Video 1',
    type: 'video',
    height: 60,
    muted: false,
    visible: true,
    solo: false,
  },
  {
    id: 'audio',
    name: 'Audio 1',
    type: 'audio',
    height: 60,
    muted: false,
    visible: true,
    solo: false,
  },
];

function words(prefix: string, count = 6): TranscriptWord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    text: `${prefix}${index + 1}`,
    start: index * 0.5,
    end: index * 0.5 + 0.4,
  }));
}

function clip(input: {
  id: string;
  trackId: string;
  type?: 'video' | 'audio' | 'text';
  transcript?: TranscriptWord[];
  linkedClipId?: string;
  caption?: boolean;
  startTime?: number;
  duration?: number;
  inPoint?: number;
  outPoint?: number;
  speed?: number;
  reversed?: boolean;
}): TimelineClip {
  const duration = input.duration ?? 10;
  return {
    id: input.id,
    trackId: input.trackId,
    name: input.id,
    file: new File([], `${input.id}.mp4`),
    startTime: input.startTime ?? 0,
    duration,
    inPoint: input.inPoint ?? 0,
    outPoint: input.outPoint ?? duration,
    source: { type: input.type ?? 'video', naturalDuration: duration },
    transform: {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      opacity: 1,
      blendMode: 'normal',
    },
    effects: [],
    transcript: input.transcript,
    linkedClipId: input.linkedClipId,
    captionProperties: input.caption ? cloneDefaultCaptionProperties() : undefined,
    speed: input.speed,
    reversed: input.reversed,
  };
}

describe('caption runtime', () => {
  it('deduplicates linked video/audio sources and exposes the visible video clip', () => {
    const transcript = words('linked');
    const video = clip({
      id: 'video',
      trackId: 'video-top',
      linkedClipId: 'audio-linked',
    });
    const audio = clip({
      id: 'audio-linked',
      trackId: 'audio',
      type: 'audio',
      transcript,
      linkedClipId: 'video',
    });

    const candidates = getCaptionSourceCandidates([video, audio]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].clip.id).toBe('video');
    expect(candidates[0].words).toEqual(transcript);
  });

  it('auto-selects the top-most active transcript video and honors an explicit source', () => {
    const caption = clip({
      id: 'caption',
      trackId: 'captions',
      type: 'text',
      caption: true,
    });
    const top = clip({
      id: 'top',
      trackId: 'video-top',
      transcript: words('top'),
    });
    const bottom = clip({
      id: 'bottom',
      trackId: 'video-bottom',
      transcript: words('bottom'),
    });
    const clips = [caption, bottom, top];

    expect(resolveCaptionSourceAtTime({
      captionClip: caption,
      clips,
      tracks,
      timelineTime: 1,
    })?.clip.id).toBe('top');

    caption.captionProperties!.sourceClipId = 'bottom';
    expect(resolveCaptionSourceAtTime({
      captionClip: caption,
      clips,
      tracks,
      timelineTime: 1,
    })?.clip.id).toBe('bottom');
  });

  it('groups on word limits and speech gaps', () => {
    const transcript = [
      ...words('a', 3),
      { id: 'late', text: 'late', start: 4, end: 4.4 },
    ];
    const groups = groupCaptionWords(transcript, {
      wordsPerCaption: 2,
      gapThreshold: 0.8,
    });

    expect(groups.map(group => group.words.map(word => word.id))).toEqual([
      ['a-0', 'a-1'],
      ['a-2'],
      ['late'],
    ]);
  });

  it('creates word-synchronized highlight frames with casing', () => {
    const caption = clip({
      id: 'caption',
      trackId: 'captions',
      type: 'text',
      caption: true,
    });
    caption.captionProperties = {
      ...caption.captionProperties!,
      wordsPerCaption: 4,
      textTransform: 'uppercase',
      highlight: {
        ...caption.captionProperties!.highlight,
        enabled: true,
        mode: 'spoken-words',
      },
    };
    const source = clip({
      id: 'source',
      trackId: 'video-top',
      transcript: words('word', 4),
    });

    const model = createCaptionFrameModel({
      captionClip: caption,
      clips: [caption, source],
      tracks,
      timelineTime: 1.1,
      resolveSourceTime: () => 1.1,
    });

    expect(model?.tokens.map(token => token.text)).toEqual([
      'WORD1',
      'WORD2',
      'WORD3',
      'WORD4',
    ]);
    expect(model?.tokens.map(token => token.highlighted)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(model?.tokens.map(token => token.active)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(model?.cueStart).toBe(0);
    expect(model?.cueEnd).toBe(1.9);
    expect(model?.cueTime).toBe(1.1);
    expect(model?.cueProgress).toBeCloseTo(1.1 / 1.9);
    expect(model?.tokens[2].progress).toBeCloseTo(0.25);
  });

  it('maps trimmed, sped-up and reversed timeline positions into source time', () => {
    const forward = clip({
      id: 'forward',
      trackId: 'video-top',
      startTime: 10,
      duration: 4,
      inPoint: 2,
      outPoint: 10,
      speed: 2,
    });
    const reverse = clip({
      id: 'reverse',
      trackId: 'video-top',
      startTime: 10,
      duration: 4,
      inPoint: 2,
      outPoint: 10,
      speed: 2,
      reversed: true,
    });

    expect(defaultCaptionSourceTime(forward, 11.5)).toBe(5);
    expect(defaultCaptionSourceTime(reverse, 11.5)).toBe(7);
  });

  it('initializes captions as regular editable text properties', () => {
    const caption = cloneDefaultCaptionProperties();
    const base = {
      text: 'Text',
      fontFamily: 'Arial',
      fontSize: 32,
      fontWeight: 400,
      fontStyle: 'normal',
      color: '#ffffff',
      textAlign: 'left',
      verticalAlign: 'top',
      lineHeight: 1,
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
    } satisfies TextClipProperties;
    const text = createCaptionTextProperties({
      caption,
      base,
      width: 1920,
      height: 1080,
    });

    expect(text.text).toBe('Caption preview');
    expect(text.fontFamily).toBe(caption.fontFamily);
    expect(text.strokeEnabled).toBe(caption.outlineEnabled);
    expect(text.textBounds?.vertices).toHaveLength(4);
  });
});
