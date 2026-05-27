import { describe, expect, it } from 'vitest';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import { resolveTimelineToolOverlayLayout } from '../../src/components/timeline/tools/timelineToolOverlayLayout';

const tracks = [
  { id: 'video-1', type: 'video', height: 40, locked: false, visible: true },
  { id: 'video-2', type: 'video', height: 50, locked: true, visible: true },
  { id: 'audio-1', type: 'audio', height: 30, locked: false, visible: true },
] as TimelineTrack[];

const clips = [
  {
    id: 'clip-1',
    trackId: 'video-1',
    startTime: 2,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
  },
] as TimelineClip[];

const baseArgs = {
  tracks,
  clips,
  duration: 10,
  timeToPixel: (time: number) => time * 10,
  getTrackHeight: (track: TimelineTrack) => track.height ?? 40,
};

describe('timeline tool overlay layer layout', () => {
  it('lays track-select-all previews over visible unlocked tracks only', () => {
    const layout = resolveTimelineToolOverlayLayout({
      ...baseArgs,
      preview: {
        toolId: 'track-select-forward-all',
        plane: 'section-scrolled',
        trackId: 'video-1',
        clipId: 'clip-1',
        time: 3,
      },
    });

    expect(layout.contentHeight).toBe(120);
    expect(layout.items).toEqual([
      expect.objectContaining({
        kind: 'track-selection',
        trackId: 'video-1',
        left: 30,
        width: 70,
        top: 3,
        height: 34,
        direction: 'forward',
      }),
      expect.objectContaining({
        kind: 'track-selection',
        trackId: 'audio-1',
        left: 30,
        width: 70,
        top: 93,
        height: 24,
        direction: 'forward',
      }),
    ]);
  });

  it('creates one section-scrolled blade line for blade-all-tracks hover', () => {
    const layout = resolveTimelineToolOverlayLayout({
      ...baseArgs,
      preview: {
        toolId: 'blade-all-tracks',
        plane: 'section-scrolled',
        trackId: 'video-1',
        clipId: 'clip-1',
        time: 4,
      },
    });

    expect(layout.items).toEqual([
      expect.objectContaining({
        kind: 'blade-line',
        left: 39,
        width: 2,
        top: 0,
        height: 120,
      }),
    ]);
  });

  it('anchors blocked tool messages to the target clip row', () => {
    const layout = resolveTimelineToolOverlayLayout({
      ...baseArgs,
      preview: {
        toolId: 'blade',
        plane: 'clip-local',
        trackId: 'video-1',
        clipId: 'clip-1',
        blocked: true,
        message: 'Track is locked.',
      },
    });

    expect(layout.items).toEqual([
      expect.objectContaining({
        kind: 'blocked-message',
        trackId: 'video-1',
        left: 22.5,
        top: 6,
        height: 24,
        message: 'Track is locked.',
      }),
    ]);
  });

  it('renders placement ghost previews on the requested unlocked tracks', () => {
    const layout = resolveTimelineToolOverlayLayout({
      ...baseArgs,
      preview: {
        toolId: 'insert',
        plane: 'section-scrolled',
        trackId: 'video-1',
        trackIds: ['video-1', 'video-2', 'audio-1'],
        startTime: 2,
        endTime: 5,
        sourceInPoint: 1,
        sourceOutPoint: 4,
        label: 'Source',
      },
    });

    expect(layout.items).toEqual([
      expect.objectContaining({
        kind: 'placement-ghost',
        trackId: 'video-1',
        left: 20,
        width: 30,
        top: 4,
        height: 32,
        sourceInPoint: 1,
        sourceOutPoint: 4,
        label: 'Source',
      }),
      expect.objectContaining({
        kind: 'placement-ghost',
        trackId: 'audio-1',
        left: 20,
        width: 30,
        top: 94,
        height: 22,
      }),
    ]);
  });

  it('renders trim and ripple operation ghost ranges', () => {
    const layout = resolveTimelineToolOverlayLayout({
      ...baseArgs,
      preview: {
        toolId: 'ripple-trim',
        plane: 'section-scrolled',
        trackId: 'video-1',
        clipId: 'clip-1',
        ghostRanges: [
          {
            id: 'target',
            trackId: 'video-1',
            startTime: 2,
            endTime: 4,
            variant: 'trim-target',
            label: 'Trim',
          },
          {
            id: 'shift',
            trackId: 'audio-1',
            startTime: 4,
            endTime: 7,
            variant: 'ripple-shift',
          },
        ],
      },
    });

    expect(layout.items).toEqual([
      expect.objectContaining({
        kind: 'operation-ghost',
        trackId: 'video-1',
        left: 20,
        width: 20,
        variant: 'trim-target',
        label: 'Trim',
      }),
      expect.objectContaining({
        kind: 'operation-ghost',
        trackId: 'audio-1',
        left: 40,
        width: 30,
        variant: 'ripple-shift',
      }),
    ]);
  });
});
