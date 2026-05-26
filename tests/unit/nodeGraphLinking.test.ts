import { describe, expect, it } from 'vitest';
import {
  createNodeGraphOwnerClip,
  resolveLinkedClipNodeGraphContext,
} from '../../src/services/nodeGraph/clipGraphLinking';
import { createClipNodeGraphState } from '../../src/services/nodeGraph';
import { createMockClip, createMockTrack } from '../helpers/mockData';

describe('clip node graph linking', () => {
  it('uses the linked visual clip as graph owner when the selected clip is linked audio', () => {
    const videoClip = createMockClip({
      id: 'video-linked',
      trackId: 'video-1',
      source: { type: 'video', mediaFileId: 'media-video' },
      linkedClipId: 'audio-linked',
    });
    const audioClip = createMockClip({
      id: 'audio-linked',
      trackId: 'audio-1',
      source: { type: 'audio', mediaFileId: 'media-audio' },
      linkedClipId: 'video-linked',
    });
    const tracks = [
      createMockTrack({ id: 'video-1', name: 'Video 1', type: 'video' }),
      createMockTrack({ id: 'audio-1', name: 'Audio 1', type: 'audio' }),
    ];

    const context = resolveLinkedClipNodeGraphContext([videoClip, audioClip], tracks, 'audio-linked');

    expect(context).toMatchObject({
      selectedClip: expect.objectContaining({ id: 'audio-linked' }),
      selectedTrack: expect.objectContaining({ id: 'audio-1' }),
      ownerClip: expect.objectContaining({ id: 'video-linked' }),
      ownerTrack: expect.objectContaining({ id: 'video-1' }),
      linkedClip: expect.objectContaining({ id: 'audio-linked' }),
      linkedTrack: expect.objectContaining({ id: 'audio-1' }),
    });
  });

  it('keeps the visual clip as graph owner when the selected clip is linked video', () => {
    const videoClip = createMockClip({
      id: 'video-linked',
      trackId: 'video-1',
      source: { type: 'video', mediaFileId: 'media-video' },
      linkedClipId: 'audio-linked',
    });
    const audioClip = createMockClip({
      id: 'audio-linked',
      trackId: 'audio-1',
      source: { type: 'audio', mediaFileId: 'media-audio' },
      linkedClipId: 'video-linked',
    });

    const context = resolveLinkedClipNodeGraphContext(
      [videoClip, audioClip],
      [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      'video-linked',
    );

    expect(context?.ownerClip.id).toBe('video-linked');
    expect(context?.linkedClip?.id).toBe('audio-linked');
  });

  it('preserves legacy audio-side graph edits when resolving the visual owner clone', () => {
    const videoClip = createMockClip({
      id: 'video-linked',
      source: { type: 'video', mediaFileId: 'media-video' },
      linkedClipId: 'audio-linked',
    });
    const legacyAudioGraph = createClipNodeGraphState(videoClip);
    legacyAudioGraph.customNodes = [
      {
        id: 'custom-audio-ai',
        kind: 'ai-custom',
        label: 'Legacy Audio AI',
        definitionId: 'definition-audio-ai',
        layout: { x: 400, y: 320 },
      },
    ];
    const audioClip = createMockClip({
      id: 'audio-linked',
      source: { type: 'audio', mediaFileId: 'media-audio' },
      linkedClipId: 'video-linked',
      nodeGraph: legacyAudioGraph,
    });
    const context = resolveLinkedClipNodeGraphContext(
      [videoClip, audioClip],
      [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      'audio-linked',
    );

    const ownerClip = createNodeGraphOwnerClip(context!);

    expect(ownerClip.id).toBe('video-linked');
    expect(ownerClip).not.toBe(videoClip);
    expect(ownerClip.nodeGraph?.customNodes?.[0]).toMatchObject({
      id: 'custom-audio-ai',
      kind: 'ai-custom',
    });
  });

  it('does not let audio-side legacy graph edits override an existing visual owner graph', () => {
    const baseVideoClip = createMockClip({
      id: 'video-linked',
      source: { type: 'video', mediaFileId: 'media-video' },
      linkedClipId: 'audio-linked',
    });
    const baseAudioClip = createMockClip({
      id: 'audio-linked',
      source: { type: 'audio', mediaFileId: 'media-audio' },
      linkedClipId: 'video-linked',
    });
    const visualGraph = createClipNodeGraphState(baseVideoClip);
    visualGraph.customNodes = [
      {
        id: 'custom-video-ai',
        kind: 'ai-custom',
        label: 'Video AI',
        definitionId: 'definition-video-ai',
        layout: { x: 240, y: 120 },
      },
    ];
    const audioGraph = createClipNodeGraphState(baseAudioClip);
    audioGraph.customNodes = [
      {
        id: 'custom-audio-ai',
        kind: 'ai-custom',
        label: 'Audio AI',
        definitionId: 'definition-audio-ai',
        layout: { x: 400, y: 320 },
      },
    ];
    const videoClip = createMockClip({
      ...baseVideoClip,
      nodeGraph: visualGraph,
    });
    const audioClip = createMockClip({
      ...baseAudioClip,
      nodeGraph: audioGraph,
    });
    const context = resolveLinkedClipNodeGraphContext(
      [videoClip, audioClip],
      [],
      'audio-linked',
    );

    const ownerClip = createNodeGraphOwnerClip(context!);

    expect(ownerClip).toBe(videoClip);
    expect(ownerClip.nodeGraph?.customNodes?.map(node => node.id)).toEqual(['custom-video-ai']);
  });
});
