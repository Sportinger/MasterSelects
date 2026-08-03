import { describe, expect, it } from 'vitest';

import {
  buildHostedAgentFastV2ProjectContext,
  describeHostedAgentFastV2AspectRatio,
  HOSTED_AGENT_FAST_V2_MEDIA_POOL_MAX_CHARACTERS,
} from '../../src/services/kernelClient/hostedAgent/fastV2ProjectContext';
import type { MediaFile, MediaState, TextItem } from '../../src/stores/mediaStore/types';

function emptyMediaState(overrides: Partial<MediaState> = {}): MediaState {
  return {
    activeCompositionId: null,
    cameraItems: [],
    compositions: [],
    currentProjectId: 'project-1',
    currentProjectName: 'Campaign',
    files: [],
    folders: [],
    lightItems: [],
    mathSceneItems: [],
    meshItems: [],
    motionShapeItems: [],
    openCompositionIds: [],
    selectedIds: [],
    signalAssets: [],
    solidItems: [],
    splatEffectorItems: [],
    textItems: [],
    ...overrides,
  } as unknown as MediaState;
}

describe('Fast V2 project context', () => {
  it('derives stable aspect labels and orientations', () => {
    expect(describeHostedAgentFastV2AspectRatio(1920, 1080)).toMatchObject({
      aspectLabel: '16:9',
      aspectRatio: 1.777778,
      orientation: 'landscape',
    });
    expect(describeHostedAgentFastV2AspectRatio(1080, 1920)).toMatchObject({
      aspectLabel: '9:16',
      aspectRatio: 0.5625,
      orientation: 'portrait',
    });
    expect(describeHostedAgentFastV2AspectRatio(1000, 1000)).toMatchObject({
      aspectLabel: '1:1',
      orientation: 'square',
    });
    expect(describeHostedAgentFastV2AspectRatio(0, 1080)).toBeUndefined();
  });

  it('includes the complete safe media index without runtime files, paths, URLs, hashes, or samples', () => {
    const video = {
      absolutePath: 'C:/Secret/interview.mp4',
      analysis: { frames: [], sampleInterval: 500 },
      analysisCoverage: 1,
      analysisStatus: 'ready',
      audioCodec: 'aac',
      codec: 'h264',
      container: 'mp4',
      createdAt: 1,
      duration: 84.2,
      fileHash: 'private-hash',
      filePath: 'C:/Secret/interview.mp4',
      fps: 25,
      hasAudio: true,
      height: 2160,
      id: 'media-1',
      name: 'Interview.mp4',
      parentId: null,
      projectPath: 'private/project/path',
      sceneDescriptions: [{ id: 'scene-1', start: 0, end: 5, text: 'Speaker enters.' }],
      sceneDescriptionStatus: 'ready',
      thumbnailUrl: 'data:image/png;base64,secret',
      transcript: [
        { id: 'word-1', start: 0, end: 0.5, text: 'Hello' },
        { id: 'word-2', start: 0.5, end: 1, text: 'world' },
      ],
      transcriptCoverage: 1,
      transcriptStatus: 'ready',
      type: 'video',
      url: 'blob:https://editor/private-runtime-url',
      waveform: [0.1, 0.2],
      waveformChannels: [[0.1], [0.2]],
      width: 3840,
    } as unknown as MediaFile;
    const result = buildHostedAgentFastV2ProjectContext(emptyMediaState({
      activeCompositionId: 'comp-vertical',
      compositions: [{
        backgroundColor: '#000000',
        createdAt: 2,
        duration: 60,
        frameRate: 30,
        height: 1920,
        id: 'comp-vertical',
        name: 'Vertical Cut',
        parentId: null,
        type: 'composition',
        width: 1080,
      }],
      files: [video],
      openCompositionIds: ['comp-vertical'],
      selectedIds: ['media-1'],
    }));

    expect(result).toMatchObject({
      schemaVersion: 2,
      mediaPool: {
        activeCompositionId: 'comp-vertical',
        complete: true,
        includedItemCount: 2,
        omittedItemCount: 0,
      },
    });
    expect(result.mediaPool.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'media-1',
        transcript: expect.objectContaining({
          previewText: 'Hello world',
          status: 'ready',
          wordCount: 2,
        }),
        videoGeometry: expect.objectContaining({
          aspectLabel: '16:9',
          orientation: 'landscape',
        }),
      }),
      expect.objectContaining({
        geometry: expect.objectContaining({ aspectLabel: '9:16', orientation: 'portrait' }),
        id: 'comp-vertical',
      }),
    ]));
    const json = JSON.stringify(result);
    expect(json).not.toContain('C:/Secret');
    expect(json).not.toContain('private-hash');
    expect(json).not.toContain('private-runtime-url');
    expect(json).not.toContain('data:image');
    expect(json).not.toContain('"waveform":');
    expect(json).not.toContain('waveformChannels');
    expect(json).toContain('waveformStatus');
  });

  it('stays bounded, marks truncation, and prioritizes selected or referenced items', () => {
    const textItems = Array.from({ length: 2_100 }, (_, index): TextItem => ({
      color: '#ffffff',
      createdAt: index,
      duration: 5,
      fontFamily: 'Inter',
      fontSize: 48,
      id: `text-${index}`,
      name: `Text ${index}`,
      parentId: null,
      text: 'x'.repeat(2_000),
      type: 'text',
    }));
    const result = buildHostedAgentFastV2ProjectContext(emptyMediaState({
      selectedIds: ['text-2099'],
      textItems,
    }), { referencedMediaItemIds: ['text-2098'] });

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      HOSTED_AGENT_FAST_V2_MEDIA_POOL_MAX_CHARACTERS,
    );
    expect(result.mediaPool.complete).toBe(false);
    expect(result.mediaPool.omittedItemCount).toBeGreaterThan(0);
    expect(result.mediaPool.items.slice(0, 2).map((item) => item.id))
      .toEqual(['text-2099', 'text-2098']);

    const tighter = buildHostedAgentFastV2ProjectContext(emptyMediaState({
      selectedIds: ['text-2099'],
      textItems,
    }), { maximumCharacters: 50_000 });
    expect(tighter.mediaPool.characterBudget).toBe(50_000);
    expect(JSON.stringify(tighter).length).toBeLessThanOrEqual(50_000);
    expect(tighter.mediaPool.items[0]?.id).toBe('text-2099');
  });

  it('indexes caption layers and their editable style for every composition', () => {
    const result = buildHostedAgentFastV2ProjectContext(emptyMediaState({
      compositions: [{
        backgroundColor: '#000000',
        createdAt: 2,
        duration: 10,
        frameRate: 30,
        height: 1920,
        id: 'comp-captioned',
        name: 'Captioned Vertical',
        parentId: null,
        timelineData: {
          clips: [{
            captionProperties: {
              background: {
                borderRadius: 16,
                color: '#000000',
                enabled: true,
                opacity: 0.7,
                paddingX: 26,
                paddingY: 14,
              },
              color: '#ffffff',
              fontFamily: 'Inter',
              fontSize: 64,
              fontStyle: 'normal',
              fontWeight: 700,
              gapThreshold: 0.8,
              highlight: {
                backgroundColor: '#ffe45c',
                backgroundOpacity: 0.95,
                enabled: true,
                mode: 'active-word',
                scale: 1.18,
                scaleEnabled: false,
                style: 'text',
                textColor: '#ffe45c',
                underlineColor: '#ffe45c',
                underlineWidth: 6,
              },
              holdAfter: 0.2,
              letterSpacing: 0,
              lineHeight: 1.12,
              maxLines: 2,
              maxWidth: 82,
              outlineColor: '#000000',
              outlineEnabled: true,
              outlineWidth: 4,
              positionX: 50,
              positionY: 84,
              schemaVersion: 1,
              sourceClipId: 'source-video',
              textAlign: 'center',
              textTransform: 'none',
              wordsPerCaption: 5,
            },
            duration: 10,
            effects: [],
            id: 'caption-1',
            inPoint: 0,
            mediaFileId: '',
            name: 'Captions',
            outPoint: 10,
            sourceType: 'text',
            startTime: 0,
            textProperties: {
              color: '#ffffff',
              fontFamily: 'Inter',
              fontSize: 64,
              fontStyle: 'normal',
              fontWeight: 700,
              letterSpacing: 0,
              lineHeight: 1.12,
              pathEnabled: false,
              pathPoints: [],
              shadowBlur: 0,
              shadowColor: '#000000',
              shadowEnabled: false,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
              strokeColor: '#000000',
              strokeEnabled: true,
              strokeWidth: 4,
              text: 'Caption preview',
              textAlign: 'center',
              verticalAlign: 'middle',
            },
            trackId: 'captions-track',
            transform: {
              blendMode: 'normal',
              opacity: 1,
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
          }],
          duration: 10,
          inPoint: null,
          loopPlayback: false,
          outPoint: null,
          playheadPosition: 0,
          scrollX: 0,
          tracks: [{
            height: 60,
            id: 'captions-track',
            muted: false,
            name: 'Captions',
            solo: false,
            type: 'video',
            visible: true,
          }],
          zoom: 100,
        },
        type: 'composition',
        width: 1080,
      }],
    }));

    expect(result.mediaPool.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'comp-captioned',
        timelineSummary: expect.objectContaining({
          captionLayerCount: 1,
          captionLayersTruncated: false,
          captionLayers: [expect.objectContaining({
            clipId: 'caption-1',
            trackId: 'captions-track',
            captionProperties: expect.objectContaining({
              sourceClipId: 'source-video',
              wordsPerCaption: 5,
            }),
            textStyle: expect.objectContaining({ fontFamily: 'Inter', fontSize: 64 }),
          })],
        }),
      }),
    ]));
  });
});
