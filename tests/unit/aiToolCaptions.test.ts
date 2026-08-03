import { beforeEach, describe, expect, it } from 'vitest';

import { captionToolDefinitions } from '../../src/services/aiTools/definitions/captions';
import {
  handleCreateCaptionClip,
  handleGetCaptionProperties,
  handleUpdateCaptionProperties,
} from '../../src/services/aiTools/handlers/captions';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const initialTimelineState = useTimelineStore.getState();

function videoTrack(id: string): TimelineTrack {
  return {
    height: 60,
    id,
    muted: false,
    name: id,
    solo: false,
    type: 'video',
    visible: true,
  };
}

function sourceClip(): TimelineClip {
  return {
    duration: 10,
    effects: [],
    file: new File([], 'interview.mp4', { type: 'video/mp4' }),
    id: 'source-video',
    inPoint: 0,
    name: 'Interview',
    outPoint: 10,
    source: { naturalDuration: 10, type: 'video' },
    startTime: 0,
    trackId: 'video-source',
    transcript: [
      { end: 0.4, id: 'word-1', start: 0, text: 'Hello' },
      { end: 0.9, id: 'word-2', start: 0.5, text: 'world' },
    ],
    transform: {
      blendMode: 'normal',
      opacity: 1,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
}

function resetTimeline(): void {
  useTimelineStore.setState({
    ...initialTimelineState,
    clips: [sourceClip()],
    playheadPosition: 0,
    selectedClipIds: new Set(),
    tracks: [videoTrack('video-overlay'), videoTrack('video-source')],
  });
}

describe('AI caption authoring tools', () => {
  beforeEach(resetTimeline);

  it('publishes read, create, and update caption atoms', () => {
    expect(captionToolDefinitions.map((tool) => tool.function.name)).toEqual([
      'getCaptionProperties',
      'createCaptionClip',
      'updateCaptionProperties',
    ]);
  });

  it('creates a transcript-driven caption on a collision-free existing layer', async () => {
    const result = await handleCreateCaptionClip({
      sourceClipId: 'source-video',
      wordsPerCaption: 3,
      textStyle: { fontFamily: 'Inter', fontSize: 72, color: '#fefefe' },
      background: { enabled: true, opacity: 0.65 },
    }, useTimelineStore.getState());

    expect(result.success).toBe(true);
    const data = result.data as {
      allocatedNewTrack: boolean;
      captionProperties: { sourceClipId: string; wordsPerCaption: number };
      clipId: string;
      textProperties: { fontSize: number; color: string };
      trackId: string;
    };
    expect(data.allocatedNewTrack).toBe(false);
    expect(data.trackId).toBe('video-overlay');
    expect(data.captionProperties).toMatchObject({
      sourceClipId: 'source-video',
      wordsPerCaption: 3,
    });
    expect(data.textProperties).toMatchObject({ fontSize: 72, color: '#fefefe' });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === data.clipId))
      .toMatchObject({ startTime: 0, duration: 10, trackId: 'video-overlay' });
  });

  it('allocates a new top video layer when every existing layer overlaps', async () => {
    const first = await handleCreateCaptionClip(
      { sourceClipId: 'source-video' },
      useTimelineStore.getState(),
    );
    expect(first.success).toBe(true);

    const second = await handleCreateCaptionClip(
      { sourceClipId: 'source-video' },
      useTimelineStore.getState(),
    );
    expect(second.success).toBe(true);
    const data = second.data as { allocatedNewTrack: boolean; trackId: string };
    expect(data.allocatedNewTrack).toBe(true);
    expect(useTimelineStore.getState().tracks[0]?.id).toBe(data.trackId);
    const clipsOnAllocatedTrack = useTimelineStore.getState().clips
      .filter((clip) => clip.trackId === data.trackId);
    expect(clipsOnAllocatedTrack).toHaveLength(1);
  });

  it('rejects an explicit occupied layer without changing the timeline', async () => {
    const before = useTimelineStore.getState().clips.length;
    const result = await handleCreateCaptionClip({
      sourceClipId: 'source-video',
      trackId: 'video-source',
    }, useTimelineStore.getState());

    expect(result.success).toBe(false);
    expect(result.error).toContain('overlaps clip source-video');
    expect(useTimelineStore.getState().clips).toHaveLength(before);
  });

  it('updates and reads caption timing, layout, typography, and highlight style', async () => {
    const created = await handleCreateCaptionClip(
      { sourceClipId: 'source-video' },
      useTimelineStore.getState(),
    );
    const clipId = (created.data as { clipId: string }).clipId;
    const updated = await handleUpdateCaptionProperties({
      clipId,
      wordsPerCaption: 2,
      holdAfter: 0.35,
      positionY: 76,
      maxWidth: 70,
      textTransform: 'uppercase',
      textStyle: { fontSize: 88, strokeWidth: 7 },
      highlight: { mode: 'spoken-words', style: 'underline', underlineWidth: 8 },
    }, useTimelineStore.getState());

    expect(updated.success).toBe(true);
    const read = await handleGetCaptionProperties({ clipId }, useTimelineStore.getState());
    expect(read.success).toBe(true);
    expect(read.data).toMatchObject({
      captionProperties: {
        holdAfter: 0.35,
        maxWidth: 70,
        positionY: 76,
        textTransform: 'uppercase',
        wordsPerCaption: 2,
        highlight: { mode: 'spoken-words', style: 'underline', underlineWidth: 8 },
      },
      textProperties: {
        boxEnabled: true,
        fontSize: 88,
        strokeWidth: 7,
      },
    });
    expect((read.data as { availableSources: unknown[] }).availableSources).toHaveLength(1);
  });
});
