import { afterEach, describe, expect, it } from 'vitest';

import { createHistorySnapshot } from '../../src/stores/historyStore/snapshotCapture';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import type { ClipAnalysis, SceneSegment, TranscriptWord } from '../../src/types/clipMetadata';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip } from '../helpers/mockData';

const transcript: TranscriptWord[] = [{
  id: 'word-1',
  text: 'Shared once',
  start: 0,
  end: 0.5,
}];
const analysis: ClipAnalysis = {
  frames: [{
    timestamp: 0,
    motion: 0.1,
    globalMotion: 0.1,
    localMotion: 0,
    focus: 0.9,
    brightness: 0.5,
    faceCount: 0,
  }],
  sampleInterval: 500,
};
const sceneDescriptions: SceneSegment[] = [{
  id: 'scene-1',
  text: 'Interview close-up',
  start: 0,
  end: 4,
}];

function sourceClip(id: string): TimelineClip {
  return createMockClip({
    id,
    analysis,
    analysisStatus: 'ready',
    mediaFileId: 'media-1',
    sceneDescriptions,
    sceneDescriptionStatus: 'ready',
    source: { type: 'video', mediaFileId: 'media-1', naturalDuration: 4 },
    transcript,
    transcriptStatus: 'ready',
  });
}

function sourceMediaFile(): MediaFile {
  return {
    id: 'media-1',
    name: 'Interview.mp4',
    type: 'video',
    parentId: null,
    createdAt: 1,
    url: 'blob:interview',
    duration: 4,
    transcript,
    transcriptStatus: 'ready',
    analysis,
    analysisStatus: 'ready',
    sceneDescriptions,
    sceneDescriptionStatus: 'ready',
  };
}

const previousFiles = useMediaStore.getState().files;

afterEach(() => {
  useMediaStore.setState({ files: previousFiles });
});

describe('media-owned source intelligence', () => {
  it('omits source artifacts from serialized timeline clips', () => {
    const clip = sourceClip('clip-1');
    const serialized = createSerializableTimelineState({
      tracks: [],
      clips: [clip],
      playheadPosition: 0,
      duration: 4,
      durationLocked: false,
      zoom: 10,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
      clipKeyframes: new Map(),
      markers: [],
      tempoMap: undefined,
      rulerLanes: [],
      activeRulerLaneId: null,
      videoBakeRegions: [],
      masterAudioState: undefined,
    } as unknown as Parameters<typeof createSerializableTimelineState>[0]);

    expect(serialized.clips[0]).not.toHaveProperty('transcript');
    expect(serialized.clips[0]).not.toHaveProperty('analysis');
    expect(serialized.clips[0]).not.toHaveProperty('sceneDescriptions');
    expect(serialized.clips[0]?.mediaFileId).toBe('media-1');
  });

  it('stores source artifacts once in history media state, not once per split clip', () => {
    const file = sourceMediaFile();
    useMediaStore.setState({ files: [file] });
    const clips = Array.from({ length: 31 }, (_, index) => sourceClip(`clip-${index}`));
    const timeline = {
      clips,
      tracks: [],
      selectedClipIds: new Set<string>(),
      selectedKeyframeIds: new Set<string>(),
      zoom: 10,
      scrollX: 0,
      layers: [],
      selectedLayerId: null,
      clipKeyframes: new Map(),
      markers: [],
      duration: 4,
      durationLocked: false,
      tempoMap: undefined,
      masterAudioState: undefined,
    };
    const media = {
      activeCompositionId: null,
      files: [file],
      compositions: [],
      folders: [],
      selectedIds: [],
      expandedFolderIds: [],
      textItems: [],
      solidItems: [],
      mathSceneItems: [],
      motionShapeItems: [],
      signalAssets: [],
      signalArtifacts: [],
      signalGraphs: [],
      signalOperators: [],
    };

    const snapshot = createHistorySnapshot('Split source', {
      getTimelineState: () => timeline,
      getMediaState: () => media,
    });

    expect(snapshot.timeline.clips).toHaveLength(31);
    expect(snapshot.timeline.clips.every((clip) => (
      !Object.hasOwn(clip, 'transcript')
      && !Object.hasOwn(clip, 'analysis')
      && !Object.hasOwn(clip, 'sceneDescriptions')
    ))).toBe(true);
    expect(snapshot.media.files).toHaveLength(1);
    expect(snapshot.media.files[0]?.transcript).toEqual(transcript);
    expect(snapshot.media.files[0]?.analysis).toEqual(analysis);
    expect(snapshot.media.files[0]?.sceneDescriptions).toEqual(sceneDescriptions);
  });
});
