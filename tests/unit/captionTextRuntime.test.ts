import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneDefaultCaptionProperties } from '../../src/services/captions/captionDefaults';
import {
  getCaptionWordEditSnapshot,
  getCaptionWordPulseScale,
  getCaptionWordPulseSpacing,
  renderCaptionTextClipFrame,
} from '../../src/services/captions/captionTextRuntime';
import { textRenderer } from '../../src/services/textRenderer';
import type { TextClipProperties } from '../../src/types/text';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const tracks: TimelineTrack[] = [
  { id: 'captions', name: 'Captions', type: 'video', height: 60, muted: false, visible: true, solo: false },
  { id: 'video', name: 'Video', type: 'video', height: 60, muted: false, visible: true, solo: false },
];

const textProperties: TextClipProperties = {
  text: 'Caption preview',
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

function transform() {
  return {
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    opacity: 1,
    blendMode: 'normal' as const,
  };
}

describe('caption text binding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('grows an active word to the configured peak and returns to its base size', () => {
    expect(getCaptionWordPulseScale(0, 1.4)).toBeCloseTo(1);
    expect(getCaptionWordPulseScale(0.5, 1.4)).toBeCloseTo(1.4);
    expect(getCaptionWordPulseScale(1, 1.4)).toBeCloseTo(1);
  });

  it('opens symmetrical space around the scaled word for its neighbors', () => {
    expect(getCaptionWordPulseSpacing(100, 1.4)).toEqual({
      activeWidth: 140,
      previousWordsShift: -20,
      followingWordsShift: 20,
    });
  });

  it('repaints scaled multi-line words instead of stretching sliced caption bitmaps', () => {
    const drawImage = vi.fn();
    const context = {
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineJoin: 'miter',
      lineCap: 'butt',
      shadowColor: 'transparent',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      globalAlpha: 1,
      measureText: vi.fn((text: string) => ({ width: text.length * 35 })),
      clearRect: vi.fn(),
      drawImage,
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 400;
    const captionProperties = cloneDefaultCaptionProperties();
    captionProperties.highlight.scaleEnabled = true;
    captionProperties.highlight.scale = 1.4;
    const caption: TimelineClip = {
      id: 'caption-pulse',
      trackId: 'captions',
      name: 'Captions',
      file: new File([], 'caption.txt'),
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'text', textCanvas: canvas, naturalDuration: 10 },
      transform: transform(),
      effects: [],
      textProperties: {
        ...textProperties,
        boxEnabled: true,
        boxX: 200,
        boxY: 80,
        boxWidth: 400,
        boxHeight: 220,
      },
      captionProperties,
    };
    const source: TimelineClip = {
      id: 'source-pulse',
      trackId: 'video',
      name: 'Video',
      file: new File([], 'video.mp4'),
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 10 },
      transform: transform(),
      effects: [],
      transcript: [
        { id: 'one', text: 'KEDHER', start: 0, end: 1 },
        { id: 'two', text: 'ICH', start: 1.1, end: 2 },
        { id: 'three', text: 'KOMME', start: 2.1, end: 3 },
      ],
    };

    renderCaptionTextClipFrame({
      captionClip: caption,
      clips: [caption, source],
      tracks,
      timelineTime: 0.5,
    });

    expect(context.scale).toHaveBeenCalledWith(1.4, 1.4);
    expect(context.fillText).toHaveBeenCalled();
    expect(drawImage).not.toHaveBeenCalled();
    getContext.mockRestore();
  });

  it('streams transcript text into the ordinary text canvas and clears it outside cues', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const captionProperties = cloneDefaultCaptionProperties();
    captionProperties.highlight.enabled = false;
    const caption: TimelineClip = {
      id: 'caption',
      trackId: 'captions',
      name: 'Captions',
      file: new File([], 'caption.txt'),
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'text', textCanvas: canvas, naturalDuration: 10 },
      transform: transform(),
      effects: [],
      textProperties,
      captionProperties,
    };
    const source: TimelineClip = {
      id: 'source',
      trackId: 'video',
      name: 'Video',
      file: new File([], 'video.mp4'),
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 10 },
      transform: transform(),
      effects: [],
      transcript: [
        { id: 'one', text: 'live', start: 0, end: 0.4 },
        { id: 'two', text: 'caption', start: 0.5, end: 0.9 },
      ],
    };

    renderCaptionTextClipFrame({
      captionClip: caption,
      clips: [caption, source],
      tracks,
      timelineTime: 0.6,
    });
    expect(textRenderer.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'live caption' }),
      canvas,
    );

    renderCaptionTextClipFrame({
      captionClip: caption,
      clips: [caption, source],
      tracks,
      timelineTime: 5,
    });
    expect(textRenderer.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: '' }),
      canvas,
    );
    expect(caption.textProperties?.text).toBe('Caption preview');
  });

  it('pages wrapped caption text without exceeding the visible line limit', () => {
    const context = {
      font: '',
      measureText: vi.fn((text: string) => ({ width: text.length * 20 })),
    };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 500;
    const captionProperties = cloneDefaultCaptionProperties();
    captionProperties.highlight.enabled = false;
    captionProperties.maxLines = 1;
    captionProperties.wordsPerCaption = 5;
    const caption: TimelineClip = {
      id: 'caption-lines',
      trackId: 'captions',
      name: 'Captions',
      file: new File([], 'caption.txt'),
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'text', textCanvas: canvas, naturalDuration: 10 },
      transform: transform(),
      effects: [],
      textProperties: {
        ...textProperties,
        boxEnabled: true,
        boxX: 140,
        boxY: 80,
        boxWidth: 220,
        boxHeight: 280,
      },
      captionProperties,
    };
    const source: TimelineClip = {
      id: 'source-lines',
      trackId: 'video',
      name: 'Video',
      file: new File([], 'video.mp4'),
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 10 },
      transform: transform(),
      effects: [],
      transcript: [
        { id: 'one', text: 'one', start: 0, end: 0.4 },
        { id: 'two', text: 'two', start: 0.5, end: 0.9 },
        { id: 'three', text: 'three', start: 1, end: 1.4 },
        { id: 'four', text: 'four', start: 1.5, end: 1.9 },
        { id: 'five', text: 'five', start: 2, end: 2.4 },
      ],
    };

    renderCaptionTextClipFrame({
      captionClip: caption,
      clips: [caption, source],
      tracks,
      timelineTime: 0.6,
    });
    expect(textRenderer.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'one two' }),
      canvas,
    );
    const editSnapshot = getCaptionWordEditSnapshot(canvas);
    expect(editSnapshot).toMatchObject({
      sourceClipId: 'source-lines',
      words: [
        { id: 'one', displayText: 'one' },
        { id: 'two', displayText: 'two' },
      ],
    });
    expect(editSnapshot?.words.every(word => word.rects[0]?.width > 0)).toBe(true);

    renderCaptionTextClipFrame({
      captionClip: caption,
      clips: [caption, source],
      tracks,
      timelineTime: 1.6,
    });
    expect(textRenderer.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'three four' }),
      canvas,
    );
    getContext.mockRestore();
  });
});
