import { describe, expect, it } from 'vitest';

import {
  buildHostedAgentFastV2SemanticTimelineState,
} from '../../src/services/kernelClient/hostedAgent/fastV2SemanticTimelineState';
import type {
  CompositionTimelineData,
  TimelineClip,
} from '../../src/types/timeline';

describe('Fast V2 complete semantic timeline state', () => {
  it('preserves editable clip state and omits only binary-heavy browser payloads', () => {
    const runtimeClip = {
      id: 'text-1',
      analysis: { dominantColors: ['#ffffff'] },
      analysisStatus: 'completed',
      sceneDescriptions: [{ description: 'Recruiting title' }],
      transcriptStatus: 'completed',
    } as unknown as TimelineClip;
    const serializedTimeline = {
      clips: [{
        duration: 3,
        editableHook: { id: 'hook-recruiting', role: 'text', rowIndex: 0 },
        effects: [{ id: 'blur-1', type: 'gaussianBlur', enabled: true, params: {} }],
        id: 'text-1',
        inPoint: 0,
        linkedGroupId: 'hook-recruiting',
        mediaFileId: '',
        motion: undefined,
        name: 'Recruiting title',
        outPoint: 3,
        sourceType: 'text',
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
      schemaVersion: 2,
      selection: { selectedClipIds: ['text-1'] },
      timeline: {
        clips: [{
          analysis: { dominantColors: ['#ffffff'] },
          editableHook: { id: 'hook-recruiting', role: 'text', rowIndex: 0 },
          effects: [{ id: 'blur-1', type: 'gaussianBlur' }],
          textProperties: { color: '#ffffff', fontSize: 72, text: 'JOIN US' },
          transcript: [{ id: 'word-1', start: 0, end: 0.5, text: 'Join' }],
        }],
        timelineRevision: 12,
      },
    });
    expect(json).not.toContain('waveform');
    expect(json).not.toContain('thumbnails');
    expect(json).not.toContain('data:image');
  });
});
