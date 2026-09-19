import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cloneDefaultCaptionProperties } from '../../src/services/captions/captionDefaults';
import {
  CAPTION_DELETE_DE_CLICK_SECONDS,
  deleteCaptionTimelineRange,
  deleteTranscriptTimelineRange,
  moveTranscriptTimelineRange,
} from '../../src/services/captions/captionTimelineEditing';
import {
  createCaptionTimelineTranscript,
  createTimelineTranscript,
} from '../../src/services/captions/captionTimelineTranscript';
import {
  clearTranscriptReviewEdits,
  getTranscriptReviewOmissions,
  isTranscriptReviewOmissionRemoved,
  restoreTranscriptReviewOmission,
} from '../../src/services/captions/transcriptReviewEdits';
import { useMediaStore } from '../../src/stores/mediaStore';
import { getHistoryStateView, initHistoryStoreRefs, undo } from '../../src/stores/historyStore';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TranscriptWord } from '../../src/types/clipMetadata';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const initialTimelineState = useTimelineStore.getState();

const tracks: TimelineTrack[] = [
  { id: 'captions', name: 'Captions', type: 'video', height: 60, muted: false, visible: true, solo: false },
  { id: 'video', name: 'Video', type: 'video', height: 60, muted: false, visible: true, solo: false },
  { id: 'audio', name: 'Audio', type: 'audio', height: 60, muted: false, visible: true, solo: false },
];

function clip(input: {
  caption?: boolean;
  duration?: number;
  id: string;
  inPoint?: number;
  linkedClipId?: string;
  outPoint?: number;
  sourceType?: 'audio' | 'text' | 'video';
  startTime?: number;
  trackId: string;
  transcript?: TranscriptWord[];
}): TimelineClip {
  const duration = input.duration ?? 10;
  const sourceType = input.sourceType ?? 'video';
  return {
    id: input.id,
    trackId: input.trackId,
    name: input.id,
    file: new File([], `${input.id}.${sourceType === 'audio' ? 'wav' : 'mp4'}`, {
      type: sourceType === 'audio' ? 'audio/wav' : 'video/mp4',
    }),
    startTime: input.startTime ?? 0,
    duration,
    inPoint: input.inPoint ?? 0,
    outPoint: input.outPoint ?? duration,
    source: { type: sourceType, naturalDuration: duration },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    transcript: input.transcript,
    linkedClipId: input.linkedClipId,
    captionProperties: input.caption ? cloneDefaultCaptionProperties() : undefined,
  };
}

describe('Caption timeline transcript', () => {
  beforeEach(() => {
    clearTranscriptReviewEdits();
    initHistoryStoreRefs({
      timeline: {
        getState: useTimelineStore.getState,
        setState: useTimelineStore.setState,
      },
      media: {
        getState: () => ({
          files: [], compositions: [], folders: [], selectedIds: [], expandedFolderIds: [],
          textItems: [], solidItems: [], mathSceneItems: [], motionShapeItems: [],
          signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [],
        }),
        setState: () => undefined,
      },
      dock: {
        getState: () => ({ layout: null }),
        setState: () => undefined,
      },
    });
    getHistoryStateView().clearHistory();
    useMediaStore.setState({ activeCompositionId: 'comp-1' });
    useTimelineStore.setState({
      ...initialTimelineState,
      clips: [],
      tracks,
      duration: 20,
      playheadPosition: 0,
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
    });
  });

  afterEach(() => {
    clearTranscriptReviewEdits();
    getHistoryStateView().clearHistory();
    useTimelineStore.setState(initialTimelineState);
  });

  it('shows only timeline-visible words and inserts visible pause events', () => {
    const words: TranscriptWord[] = [
      { id: 'before', text: 'before', start: 0.2, end: 0.4 },
      { id: 'one', text: 'one', start: 1, end: 1.25 },
      { id: 'two', text: 'two', start: 1.8, end: 2.1 },
      { id: 'three', text: 'three', start: 2.2, end: 2.4 },
      { id: 'after', text: 'after', start: 4.2, end: 4.5 },
    ];
    const caption = clip({
      id: 'caption',
      trackId: 'captions',
      sourceType: 'text',
      caption: true,
      startTime: 1,
      duration: 3,
      outPoint: 3,
    });
    const source = clip({ id: 'source', trackId: 'video', transcript: words, duration: 5 });

    const events = createCaptionTimelineTranscript({
      captionClip: caption,
      clips: [caption, source],
      tracks,
    });

    expect(events.map(event => event.kind === 'word' ? event.text : 'pause')).toEqual([
      'one',
      'pause',
      'two',
      'three',
    ]);
    expect(events[1]).toMatchObject({
      kind: 'pause',
      sourceClipId: 'source',
      timelineStart: 1.25,
      timelineEnd: 1.8,
    });
  });

  it('maps trimmed source time into the caption clip timeline', () => {
    const words: TranscriptWord[] = [
      { id: 'visible', text: 'visible', start: 4.2, end: 4.5 },
      { id: 'later', text: 'later', start: 5.1, end: 5.4 },
    ];
    const caption = clip({
      id: 'caption',
      trackId: 'captions',
      sourceType: 'text',
      caption: true,
      startTime: 10,
      duration: 2,
      outPoint: 2,
    });
    caption.captionProperties!.sourceClipId = 'source';
    const source = clip({
      id: 'source',
      trackId: 'video',
      transcript: words,
      startTime: 10,
      duration: 2,
      inPoint: 4,
      outPoint: 6,
    });

    const events = createCaptionTimelineTranscript({
      captionClip: caption,
      clips: [caption, source],
      tracks,
    }).filter(event => event.kind === 'word');

    expect(events.map(event => ({ text: event.text, start: event.timelineStart }))).toEqual([
      { text: 'visible', start: 10.2 },
      { text: 'later', start: 11.1 },
    ]);
  });

  it('builds the same editable word and pause stream without requiring a Caption clip', () => {
    const source = clip({
      id: 'source',
      trackId: 'video',
      duration: 4,
      transcript: [
        { id: 'one', text: 'one', start: 0.4, end: 0.7 },
        { id: 'two', text: 'two', start: 1.2, end: 1.5 },
      ],
    });

    const events = createTimelineTranscript({
      clips: [source],
      timelineEnd: 4,
      tracks,
    });

    expect(events.map(event => event.kind === 'word' ? event.text : 'pause')).toEqual([
      'one',
      'pause',
      'two',
    ]);
  });

  it('ripple-cuts linked video/audio, de-clicks both audio edges, and keeps captions in sync', () => {
    const transcript: TranscriptWord[] = [
      { id: 'before', text: 'before', start: 1, end: 1.4 },
      { id: 'remove', text: 'remove', start: 3, end: 4 },
      { id: 'after', text: 'after', start: 5, end: 5.4 },
    ];
    const video = clip({
      id: 'video-source',
      trackId: 'video',
      linkedClipId: 'audio-source',
      transcript,
    });
    const audio = clip({
      id: 'audio-source',
      trackId: 'audio',
      sourceType: 'audio',
      linkedClipId: 'video-source',
      transcript,
    });
    const caption = clip({
      id: 'caption',
      trackId: 'captions',
      sourceType: 'text',
      caption: true,
    });
    const laterCaption = clip({
      id: 'caption-later',
      trackId: 'captions',
      sourceType: 'text',
      caption: true,
      startTime: 12,
      duration: 3,
      outPoint: 3,
    });
    useTimelineStore.setState({
      clips: [caption, laterCaption, video, audio],
      selectedClipIds: new Set([caption.id]),
      primarySelectedClipId: caption.id,
    });

    const result = deleteCaptionTimelineRange({
      captionClipId: caption.id,
      sourceClipId: video.id,
      timelineStart: 3,
      timelineEnd: 4,
      label: 'Delete caption word',
    });

    expect(result).toEqual({
      ok: true,
      deClickFadesApplied: 2,
      removedDuration: 1,
    });
    const state = useTimelineStore.getState();
    const videoParts = state.clips
      .filter(candidate => candidate.trackId === 'video')
      .toSorted((left, right) => left.startTime - right.startTime);
    expect(videoParts.map(part => ({
      start: part.startTime,
      duration: part.duration,
      inPoint: part.inPoint,
      outPoint: part.outPoint,
    }))).toEqual([
      { start: 0, duration: 3, inPoint: 0, outPoint: 3 },
      { start: 3, duration: 6, inPoint: 4, outPoint: 10 },
    ]);
    const audioParts = state.clips
      .filter(candidate => candidate.trackId === 'audio')
      .toSorted((left, right) => left.startTime - right.startTime);
    expect(audioParts).toHaveLength(2);
    const deClickOperations = audioParts.flatMap(part => part.audioState?.editStack ?? []);
    expect(deClickOperations.map(operation => operation.params.label)).toEqual([
      'Automatic cut de-click',
      'Automatic cut de-click',
    ]);
    for (const operation of deClickOperations) {
      expect(operation.timeRange.end - operation.timeRange.start)
        .toBeCloseTo(CAPTION_DELETE_DE_CLICK_SECONDS, 6);
    }
    expect(state.clips.find(candidate => candidate.id === caption.id)?.duration).toBe(9);
    expect(state.clips.find(candidate => candidate.id === laterCaption.id)?.startTime).toBe(11);
    expect(state.playheadPosition).toBe(3);

    expect(undo()?.label).toBe('Delete caption word');
    const restored = useTimelineStore.getState();
    expect(restored.clips.filter(candidate => candidate.trackId === 'video')).toHaveLength(1);
    expect(restored.clips.find(candidate => candidate.id === caption.id)?.duration).toBe(10);
    expect(restored.clips.find(candidate => candidate.id === laterCaption.id)?.startTime).toBe(12);
  });

  it('keeps a removed word restorable and reflects timeline undo state', () => {
    const transcript: TranscriptWord[] = [
      { id: 'before', text: 'before', start: 1, end: 1.4 },
      { id: 'remove', text: 'remove', start: 3, end: 4 },
      { id: 'after', text: 'after', start: 5, end: 5.4 },
    ];
    const video = clip({
      id: 'video-source',
      trackId: 'video',
      linkedClipId: 'audio-source',
      transcript,
    });
    const audio = clip({
      id: 'audio-source',
      trackId: 'audio',
      linkedClipId: 'video-source',
      sourceType: 'audio',
      transcript,
    });
    useTimelineStore.setState({ clips: [video, audio] });
    const transcriptEvent = createTimelineTranscript({
      clips: [video, audio],
      timelineEnd: 10,
      tracks,
    }).find(event => event.kind === 'word' && event.text === 'remove');
    expect(transcriptEvent).toBeDefined();

    expect(deleteTranscriptTimelineRange({
      compositionId: 'comp-1',
      label: 'Hide transcript word',
      sourceClipId: video.id,
      timelineEnd: 4,
      timelineStart: 3,
      transcriptEvent: transcriptEvent!,
    }).ok).toBe(true);

    const compositionId = 'comp-1';
    const [omission] = getTranscriptReviewOmissions(compositionId);
    expect(omission).toMatchObject({ kind: 'word', text: 'remove', timelineStart: 3 });
    expect(isTranscriptReviewOmissionRemoved(omission!, useTimelineStore.getState().clips)).toBe(true);

    expect(undo()?.label).toBe('Hide transcript word');
    expect(isTranscriptReviewOmissionRemoved(omission!, useTimelineStore.getState().clips)).toBe(false);

    expect(deleteTranscriptTimelineRange({
      compositionId: 'comp-1',
      label: 'Hide transcript word again',
      sourceClipId: video.id,
      timelineEnd: 4,
      timelineStart: 3,
      transcriptEvent: transcriptEvent!,
    }).ok).toBe(true);
    const activeOmission = getTranscriptReviewOmissions(compositionId)
      .find(candidate => isTranscriptReviewOmissionRemoved(candidate, useTimelineStore.getState().clips));
    expect(activeOmission).toBeDefined();
    expect(restoreTranscriptReviewOmission(compositionId, activeOmission!.id)).toEqual({ ok: true });
    expect(isTranscriptReviewOmissionRemoved(activeOmission!, useTimelineStore.getState().clips)).toBe(false);
  });

  it('moves the selected edit range with linked audio and overlay tracks', () => {
    const makePair = (suffix: string, startTime: number) => [
      clip({
        duration: 2,
        id: `video-${suffix}`,
        linkedClipId: `audio-${suffix}`,
        startTime,
        trackId: 'video',
      }),
      clip({
        duration: 2,
        id: `audio-${suffix}`,
        linkedClipId: `video-${suffix}`,
        sourceType: 'audio',
        startTime,
        trackId: 'audio',
      }),
    ];
    const overlay = clip({
      caption: true,
      duration: 6,
      id: 'caption-overlay',
      sourceType: 'text',
      trackId: 'captions',
    });
    useTimelineStore.setState({
      clips: [overlay, ...makePair('a', 0), ...makePair('b', 2), ...makePair('c', 4)],
      duration: 6,
    });

    expect(moveTranscriptTimelineRange({
      compositionId: useMediaStore.getState().activeCompositionId ?? undefined,
      sourceClipIds: ['video-b'],
      timelineEnd: 4,
      timelineStart: 2,
      targetTime: 0,
    })).toMatchObject({ ok: true, movedDuration: 2, targetStart: 0 });

    const moved = useTimelineStore.getState().clips;
    expect(moved.find(candidate => candidate.id === 'video-b')?.startTime).toBe(0);
    expect(moved.find(candidate => candidate.id === 'audio-b')?.startTime).toBe(0);
    expect(moved.find(candidate => candidate.id === 'video-a')?.startTime).toBe(2);
    expect(moved.filter(candidate => candidate.trackId === 'captions').map(candidate => candidate.startTime).toSorted((a, b) => a - b)).toEqual([0, 2, 4]);
  });
});
