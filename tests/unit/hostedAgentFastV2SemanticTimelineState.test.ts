import { describe, expect, it } from 'vitest';

import {
  buildHostedAgentFastV2SemanticTimelineState,
} from '../../src/services/kernelClient/hostedAgent/fastV2SemanticTimelineState';
import { buildHostedAgentFastV2BrowserRequest } from '../../src/services/kernelClient/hostedAgent/fastV2BrowserRequest';
import type {
  CompositionTimelineData,
  TimelineClip,
  TimelineTrack,
} from '../../src/types/timeline';
import type { ClipAnalysis, TranscriptWord } from '../../src/types/clipMetadata';

describe('Fast V2 complete semantic timeline state', () => {
  it('preserves editable clip state and stores source intelligence once per media source', () => {
    const runtimeClip = {
      id: 'text-1',
      analysis: { dominantColors: ['#ffffff'] },
      analysisStatus: 'ready',
      mediaFileId: 'media-1',
      sceneDescriptions: [{ description: 'Recruiting title' }],
      source: { mediaFileId: 'media-1', type: 'video' },
      transcriptStatus: 'ready',
    } as unknown as TimelineClip;
    const serializedTimeline = {
      clips: [{
        duration: 3,
        editableHook: { id: 'hook-recruiting', role: 'text', rowIndex: 0 },
        effects: [{ id: 'blur-1', type: 'gaussianBlur', enabled: true, params: {} }],
        id: 'text-1',
        inPoint: 0,
        linkedGroupId: 'hook-recruiting',
        mediaFileId: 'media-1',
        motion: undefined,
        name: 'Recruiting title',
        outPoint: 3,
        sourceType: 'video',
        startTime: 0,
        textProperties: { color: '#ffffff', fontSize: 72, text: 'JOIN US' },
        thumbnails: ['data:image/png;base64,large'],
        trackId: 'video-1',
        transform: {
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
          position: { x: 0, y: 0 },
          rotation: 0,
          scale: { x: 1, y: 1 },
        },
        waveform: [0.1, 0.2],
        waveformChannels: [[0.1], [0.2]],
      }],
      duration: 3,
      inPoint: null,
      loopPlayback: false,
      outPoint: null,
      playheadPosition: 0,
      scrollX: 0,
      tracks: [{
        height: 64,
        id: 'video-1',
        muted: false,
        name: 'Video 1',
        solo: false,
        type: 'video',
        visible: true,
      }],
      zoom: 10,
    } as CompositionTimelineData;

    const result = buildHostedAgentFastV2SemanticTimelineState({
      activeComposition: {
        aspectLabel: '9:16',
        aspectRatio: 0.5625,
        backgroundColor: '#000000',
        duration: 3,
        frameRate: 30,
        height: 1920,
        id: 'comp-1',
        name: 'Vertical Cut',
        orientation: 'portrait',
        width: 1080,
      },
      activeMaskId: null,
      layers: [],
      primarySelectedClipId: 'text-1',
      projectContext: {
        mediaPool: {
          activeCompositionId: 'comp-1',
          characterBudget: 350000,
          complete: true,
          counts: { compositions: 1 },
          folderCount: 0,
          folders: [],
          includedFolderCount: 0,
          includedItemCount: 1,
          itemCount: 1,
          items: [{
            id: 'media-1',
            name: 'Portrait source',
            type: 'video',
            videoGeometry: {
              aspectLabel: '9:16',
              aspectRatio: 0.5625,
              height: 1920,
              orientation: 'portrait',
              width: 1080,
            },
          }],
          omittedFolderCount: 0,
          omittedItemCount: 0,
          openCompositionIds: ['comp-1'],
          selectedItemIds: [],
        },
        project: { id: 'project-1', name: 'Campaign' },
        schemaVersion: 2,
      },
      propertiesSelection: { kind: 'clip', clipId: 'text-1' },
      runtimeClips: [runtimeClip],
      selectedClipIds: ['text-1'],
      selectedKeyframeIds: [],
      selectedLayerId: null,
      selectedVertexIds: [],
      serializedTimeline,
      storyboard: {
        schemaVersion: 1,
        plans: {},
        scenes: {},
        generationBriefs: {},
        candidates: {},
        evidenceRefs: {},
        coverageBySceneId: {},
        variantSets: {},
        variantOptions: {},
        decisions: {},
        templates: {},
      },
      timelineRangeSelection: null,
      timelineRevision: 12,
      transcriptsByClipId: new Map([[
        'text-1',
        [{ id: 'word-1', start: 0, end: 0.5, text: 'Join' }],
      ]]),
    });

    const json = JSON.stringify(result);
    expect(result).toMatchObject({
      activeComposition: {
        aspectLabel: '9:16',
        id: 'comp-1',
        orientation: 'portrait',
        width: 1080,
        height: 1920,
      },
      projectContext: {
        mediaPool: {
          complete: true,
          items: [{ id: 'media-1', videoGeometry: { aspectLabel: '9:16' } }],
        },
        schemaVersion: 2,
      },
      schemaVersion: 3,
      selection: { selectedClipIds: ['text-1'] },
      sourceIntelligence: {
        schemaVersion: 1,
        sources: [{
          artifacts: {
            analysis: { dominantColors: ['#ffffff'] },
            analysisStatus: 'ready',
            sceneDescriptions: [{ description: 'Recruiting title' }],
            transcript: [{ id: 'word-1', start: 0, end: 0.5, text: 'Join' }],
            transcriptStatus: 'ready',
          },
          clipIds: ['text-1'],
          id: 'media:media-1',
          kind: 'media',
          mediaFileId: 'media-1',
        }],
      },
      timeline: {
        clips: [{
          editableHook: { id: 'hook-recruiting', role: 'text', rowIndex: 0 },
          effects: [{ id: 'blur-1', type: 'gaussianBlur' }],
          sourceIntelligenceId: 'media:media-1',
          textProperties: { color: '#ffffff', fontSize: 72, text: 'JOIN US' },
        }],
        timelineRevision: 12,
      },
    });
    const timelineClip = (result.timeline as { clips: Array<Record<string, unknown>> }).clips[0];
    expect(timelineClip).not.toHaveProperty('analysis');
    expect(timelineClip).not.toHaveProperty('transcript');
    expect(timelineClip).not.toHaveProperty('sceneDescriptions');
    expect(json).not.toContain('waveform');
    expect(json).not.toContain('thumbnails');
    expect(json).not.toContain('data:image');
  });

  it('keeps a split-heavy source snapshot inside the Fast V2 contract budget', async () => {
    const transcript: TranscriptWord[] = Array.from({ length: 528 }, (_, index) => ({
      id: `word-${index}`,
      text: `word-${index}`,
      start: index * 0.4,
      end: index * 0.4 + 0.3,
      confidence: 0.99,
      speaker: 'Speaker 1',
      alignedStart: index * 0.4 + 0.01,
      alignedEnd: index * 0.4 + 0.29,
      alignmentConfidence: 0.95,
      alignmentMethod: 'acoustic-refine',
      emphasis: 0.5,
    }));
    const analysis: ClipAnalysis = {
      frames: Array.from({ length: 450 }, (_, index) => ({
        timestamp: index * 0.5,
        motion: 0.2,
        globalMotion: 0.1,
        localMotion: 0.1,
        focus: 0.9,
        brightness: 0.5,
        faceCount: 1,
      })),
      sampleInterval: 500,
    };
    const tracks: TimelineTrack[] = [
      {
        height: 64,
        id: 'video-1',
        muted: false,
        name: 'Video 1',
        solo: false,
        type: 'video',
        visible: true,
      },
      {
        height: 64,
        id: 'audio-1',
        muted: false,
        name: 'Audio 1',
        solo: false,
        type: 'audio',
        visible: true,
      },
    ];
    const runtimeClips: TimelineClip[] = [];
    const serializedClips: CompositionTimelineData['clips'] = [];
    for (let index = 0; index < 31; index += 1) {
      const startTime = index * 4;
      const inPoint = index * 7;
      for (const type of ['video', 'audio'] as const) {
        const id = `${type}-${index}`;
        const partnerId = `${type === 'video' ? 'audio' : 'video'}-${index}`;
        runtimeClips.push({
          ...(type === 'video' ? { analysis, analysisStatus: 'ready' as const } : {}),
          duration: 4,
          effects: [],
          id,
          inPoint,
          linkedClipId: partnerId,
          mediaFileId: 'media-interview',
          name: `Interview ${type}`,
          outPoint: inPoint + 4,
          source: { mediaFileId: 'media-interview', type },
          startTime,
          trackId: `${type}-1`,
          transcript,
          transcriptStatus: 'ready',
          transform: {
            anchor: { x: 0.5, y: 0.5 },
            opacity: 1,
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: { x: 1, y: 1 },
          },
        } as TimelineClip);
        serializedClips.push({
          duration: 4,
          effects: [],
          id,
          inPoint,
          linkedClipId: partnerId,
          mediaFileId: 'media-interview',
          name: `Interview ${type}`,
          outPoint: inPoint + 4,
          sourceType: type,
          startTime,
          trackId: `${type}-1`,
          transform: {
            anchor: { x: 0.5, y: 0.5 },
            opacity: 1,
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: { x: 1, y: 1 },
          },
        });
      }
    }
    const serializedTimeline = {
      clips: serializedClips,
      duration: 124,
      inPoint: null,
      loopPlayback: false,
      outPoint: null,
      playheadPosition: 0,
      scrollX: 0,
      tracks,
      zoom: 10,
    } as CompositionTimelineData;
    const semanticTimelineState = buildHostedAgentFastV2SemanticTimelineState({
      activeComposition: null,
      activeMaskId: null,
      layers: [],
      primarySelectedClipId: null,
      projectContext: {
        mediaPool: {
          activeCompositionId: null,
          characterBudget: 350000,
          complete: true,
          counts: { video: 1 },
          folderCount: 0,
          folders: [],
          includedFolderCount: 0,
          includedItemCount: 1,
          itemCount: 1,
          items: [{ id: 'media-interview', name: 'Interview', type: 'video' }],
          omittedFolderCount: 0,
          omittedItemCount: 0,
          openCompositionIds: [],
          selectedItemIds: [],
        },
        project: { id: 'project-split', name: 'Split regression' },
        schemaVersion: 2,
      },
      propertiesSelection: null,
      runtimeClips,
      selectedClipIds: [],
      selectedKeyframeIds: [],
      selectedLayerId: null,
      selectedVertexIds: [],
      serializedTimeline,
      sourceArtifactsByMediaFileId: new Map([[
        'media-interview',
        { analysis, analysisStatus: 'ready', transcript, transcriptStatus: 'ready' },
      ]]),
      storyboard: {
        schemaVersion: 1,
        plans: {},
        scenes: {},
        generationBriefs: {},
        candidates: {},
        evidenceRefs: {},
        coverageBySceneId: {},
        variantSets: {},
        variantOptions: {},
        decisions: {},
        templates: {},
      },
      timelineRangeSelection: null,
      timelineRevision: 399,
      transcriptsByClipId: new Map(runtimeClips.map((clip) => [clip.id, transcript])),
    });

    const sources = (
      semanticTimelineState.sourceIntelligence as {
        sources: Array<{
          artifacts: { analysis?: ClipAnalysis; transcript?: TranscriptWord[] };
        }>;
      }
    ).sources;
    const semanticClips = (
      semanticTimelineState.timeline as { clips: Array<Record<string, unknown>> }
    ).clips;
    expect(sources).toHaveLength(1);
    expect(sources[0]?.artifacts.transcript).toHaveLength(528);
    expect(sources[0]?.artifacts.analysis?.frames).toHaveLength(450);
    expect(semanticClips).toHaveLength(62);
    expect(semanticClips.every((clip) => (
      !Object.hasOwn(clip, 'transcript')
      && !Object.hasOwn(clip, 'analysis')
      && clip.sourceIntelligenceId === 'media:media-interview'
    ))).toBe(true);

    const request = await buildHostedAgentFastV2BrowserRequest({
      clientInstanceId: 'client-split-regression',
      request: 'Scale all clips from 130% to 100%.',
      runSource: 'ui',
      snapshot: {
        clips: runtimeClips,
        duration: 124,
        inPoint: null,
        outPoint: null,
        playheadPosition: 0,
        selectedClipIds: new Set(),
        semanticTimelineState,
        timelineRevision: 399,
        tracks,
      },
      turnId: 'turn-split-regression',
    });
    expect(request.compactSnapshot.timelineRevision).toBe(399);
    expect(new TextEncoder().encode(JSON.stringify(request)).byteLength).toBeLessThan(1_400_000);
  });
});
