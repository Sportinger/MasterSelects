import { beforeEach, describe, expect, it } from 'vitest';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  applyLegacyMediaArtifactSeeds,
  collectLegacyMediaArtifactSeeds,
} from '../../src/services/project/load/loadMediaArtifactMigration';
import { projectMediaSourceArtifactsOntoClip } from '../../src/services/mediaArtifacts/mediaSourceArtifacts';
import type { ProjectFile } from '../../src/services/project/types';
import type { TranscriptWord } from '../../src/types';
import { createMockClip } from '../helpers/mockData';

const initialTimelineState = useTimelineStore.getState();

const transcript: TranscriptWord[] = [
  { id: 'word-1', text: 'Hallo', start: 0.1, end: 0.5 },
  { id: 'word-2', text: 'Welt', start: 9.2, end: 9.8 },
];

function legacyProject(): ProjectFile {
  return {
    media: [{ id: 'media-1', duration: 10 }],
    compositions: [
      {
        id: 'comp-empty',
        clips: [{ id: 'empty', mediaId: 'media-1' }],
      },
      {
        id: 'comp-ready',
        clips: [{
          id: 'ready',
          mediaId: 'media-1',
          transcript,
          transcriptStatus: 'ready',
          analysis: {
            frames: [{
              brightness: 0.5,
              faceCount: 0,
              focus: 1,
              globalMotion: 0,
              localMotion: 0,
              motion: 0,
              timestamp: 2,
            }],
            sampleInterval: 1000,
          },
          analysisStatus: 'ready',
          sceneDescriptions: [{ id: 'scene-1', text: 'Intro', start: 0, end: 3 }],
          sceneDescriptionStatus: 'ready',
        }],
      },
    ],
  } as unknown as ProjectFile;
}

describe('media-scoped source artifact ownership', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
  });

  it('recovers legacy artifacts from every composition, not only the active one', () => {
    const seeds = collectLegacyMediaArtifactSeeds(legacyProject());
    const seed = seeds.get('media-1');

    expect(seed?.transcript).toEqual(transcript);
    expect(seed?.transcriptRange).toEqual([0, 10]);
    expect(seed?.analysis?.frames).toHaveLength(1);
    expect(seed?.sceneDescriptions).toHaveLength(1);

    const [file] = applyLegacyMediaArtifactSeeds([{
      id: 'media-1',
      name: 'source.mp4',
      type: 'video',
      parentId: null,
      createdAt: 1,
      url: 'blob:source',
      duration: 10,
    }], seeds);

    expect(file).toMatchObject({
      transcriptStatus: 'ready',
      transcript,
      analysisStatus: 'ready',
      sceneDescriptionStatus: 'ready',
    });
  });

  it('does not serialize media artifacts into timeline clips', () => {
    useMediaStore.setState({
      files: [{
        id: 'media-1',
        name: 'source.mp4',
        type: 'video',
        parentId: null,
        createdAt: 1,
        url: 'blob:source',
      }],
    });
    useTimelineStore.setState({
      clips: [createMockClip({
        id: 'clip-1',
        mediaFileId: 'media-1',
        source: { type: 'video', mediaFileId: 'media-1' },
        transcript,
        transcriptStatus: 'ready',
        analysis: {
          frames: [],
          sampleInterval: 1000,
        },
        analysisStatus: 'ready',
        sceneDescriptions: [{ id: 'scene-1', text: 'Intro', start: 0, end: 1 }],
        sceneDescriptionStatus: 'ready',
      })],
    });

    const [serialized] = useTimelineStore.getState().getSerializableState().clips;
    expect(serialized.transcript).toBeUndefined();
    expect(serialized.transcriptStatus).toBeUndefined();
    expect(serialized.analysis).toBeUndefined();
    expect(serialized.analysisStatus).toBeUndefined();
    expect(serialized.sceneDescriptions).toBeUndefined();
    expect(serialized.sceneDescriptionStatus).toBeUndefined();
  });

  it('finds runtime source IDs before a save strips active timeline copies', () => {
    const runtimeClip = createMockClip({
      id: 'runtime-ready',
      mediaFileId: undefined,
      source: { type: 'video', mediaFileId: 'media-1' },
      transcript,
      transcriptStatus: 'ready',
    });
    const seeds = collectLegacyMediaArtifactSeeds({
      media: [{ id: 'media-1', duration: 10 }],
      compositions: [{ clips: [runtimeClip] }],
    });

    expect(seeds.get('media-1')?.transcript).toEqual(transcript);
  });

  it('keeps clip identity when no media artifact exists', () => {
    const clip = createMockClip({
      id: 'runtime-empty',
      mediaFileId: 'media-1',
      source: { type: 'video', mediaFileId: 'media-1' },
    });

    expect(projectMediaSourceArtifactsOntoClip(clip, {})).toBe(clip);
  });
});
