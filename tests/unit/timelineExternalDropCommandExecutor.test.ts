import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeTimelineExternalDropCommand } from '../../src/services/timeline/timelineExternalDropCommandExecutor';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { MediaFile } from '../../src/stores/mediaStore';

const mockedGetMediaState = useMediaStore.getState as unknown as ReturnType<typeof vi.fn>;

function setMediaState(overrides: Record<string, unknown> = {}): void {
  mockedGetMediaState.mockReturnValue({
    files: [],
    compositions: [],
    textItems: [],
    solidItems: [],
    meshItems: [],
    cameraItems: [],
    splatEffectorItems: [],
    mathSceneItems: [],
    motionShapeItems: [],
    signalAssets: [],
    ...overrides,
  });
}

function createActions() {
  return {
    addClip: vi.fn(),
    addCompClip: vi.fn(),
    addTextClip: vi.fn(),
    addSolidClip: vi.fn(),
    addMeshClip: vi.fn(),
    addCameraClip: vi.fn(),
    addLightClip: vi.fn(),
    addSplatEffectorClip: vi.fn(),
    addMathSceneClip: vi.fn(),
    addMotionShapeClip: vi.fn(),
    addSignalAssetClip: vi.fn(),
  };
}

function mediaFile(overrides: Partial<MediaFile>): MediaFile {
  return {
    id: 'media-1',
    name: 'media.mp4',
    type: 'video',
    parentId: null,
    createdAt: 1,
    ...overrides,
  } as MediaFile;
}

describe('timeline external drop command executor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMediaState();
  });

  it('executes visual panel item commands through injected timeline actions', async () => {
    const actions = createActions();
    setMediaState({
      solidItems: [{
        id: 'solid-1',
        name: 'Blue',
        type: 'solid',
        parentId: null,
        createdAt: 1,
        color: '#0000ff',
        duration: 7,
      }],
    });

    const result = await executeTimelineExternalDropCommand({
      actions,
      command: { kind: 'solid', itemId: 'solid-1' },
      isAudioOnlyMediaFile: () => false,
      isVideoTrack: true,
      mediaFilePolicy: 'allow-video-on-audio',
      resolveStartTime: (duration) => (duration ?? 0) + 3,
      trackId: 'video-1',
    });

    expect(result).toEqual({ handled: true });
    expect(actions.addSolidClip).toHaveBeenCalledWith('video-1', 10, '#0000ff', 7, true);
  });

  it('executes media-file commands with existing file resolution and media overrides', async () => {
    const actions = createActions();
    const file = new File(['model'], 'hero.glb', { type: 'model/gltf-binary' });
    setMediaState({
      files: [mediaFile({
        id: 'media-model',
        name: 'hero.glb',
        type: 'model',
        file,
        duration: 12,
      })],
    });

    const result = await executeTimelineExternalDropCommand({
      actions,
      command: { kind: 'media-file', itemId: 'media-model' },
      isAudioOnlyMediaFile: () => false,
      isVideoTrack: true,
      mediaFilePolicy: 'strict-track-type',
      resolveStartTime: () => 4,
      trackId: 'video-1',
    });

    expect(result).toEqual({ handled: true });
    expect(actions.addClip).toHaveBeenCalledWith(
      'video-1',
      file,
      4,
      12,
      'media-model',
      'model',
    );
  });

  it('places audio media on audio tracks under strict track validation', async () => {
    const actions = createActions();
    const file = new File(['audio'], 'dialog.wav', { type: 'audio/wav' });
    setMediaState({
      files: [mediaFile({
        id: 'media-audio',
        name: 'dialog.wav',
        type: 'audio',
        file,
        duration: 12,
      })],
    });

    const result = await executeTimelineExternalDropCommand({
      actions,
      command: { kind: 'media-file', itemId: 'media-audio' },
      isAudioOnlyMediaFile: (candidate) => candidate.type === 'audio',
      isVideoTrack: false,
      mediaFilePolicy: 'strict-track-type',
      resolveStartTime: () => 3,
      trackId: 'audio-1',
    });

    expect(result).toEqual({ handled: true });
    expect(actions.addClip).toHaveBeenCalledWith(
      'audio-1',
      file,
      3,
      12,
      'media-audio',
      undefined,
    );
  });

  it('rejects strict media-file commands before creating clips on the wrong track type', async () => {
    const actions = createActions();
    setMediaState({
      files: [mediaFile({
        id: 'media-video',
        type: 'video',
        file: new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
      })],
    });

    const result = await executeTimelineExternalDropCommand({
      actions,
      command: { kind: 'media-file', itemId: 'media-video' },
      isAudioOnlyMediaFile: () => false,
      isVideoTrack: false,
      mediaFilePolicy: 'strict-track-type',
      resolveStartTime: () => 0,
      trackId: 'audio-1',
    });

    expect(result).toEqual({
      handled: true,
      reason: 'visual-media-on-audio-track',
    });
    expect(actions.addClip).not.toHaveBeenCalled();
  });

  it('routes video with audio from the hovered audio lane to the base video lane', async () => {
    const actions = createActions();
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    setMediaState({
      files: [mediaFile({
        id: 'media-video',
        type: 'video',
        file,
        duration: 8,
        hasAudio: true,
      })],
    });

    const result = await executeTimelineExternalDropCommand({
      actions,
      command: { kind: 'media-file', itemId: 'media-video' },
      isAudioOnlyMediaFile: () => false,
      isVideoTrack: false,
      mediaFilePolicy: 'allow-video-on-audio',
      resolveLinkedVideoTrackId: () => 'video-1',
      resolveStartTime: () => 4,
      trackId: 'audio-2',
    });

    expect(result).toEqual({ handled: true });
    expect(actions.addClip).toHaveBeenCalledWith(
      'video-1',
      file,
      4,
      8,
      'media-video',
      undefined,
      { linkedAudioTrackId: 'audio-2' },
    );
  });

  it('rejects visual media without linked audio on an audio lane', async () => {
    const actions = createActions();
    setMediaState({
      files: [mediaFile({
        id: 'silent-video',
        type: 'video',
        file: new File(['video'], 'silent.mp4', { type: 'video/mp4' }),
        hasAudio: false,
      })],
    });

    const result = await executeTimelineExternalDropCommand({
      actions,
      command: { kind: 'media-file', itemId: 'silent-video' },
      isAudioOnlyMediaFile: () => false,
      isVideoTrack: false,
      mediaFilePolicy: 'allow-video-on-audio',
      resolveLinkedVideoTrackId: () => 'video-1',
      resolveStartTime: () => 0,
      trackId: 'audio-1',
    });

    expect(result).toEqual({
      handled: true,
      reason: 'media-without-linked-audio-on-audio-track',
    });
    expect(actions.addClip).not.toHaveBeenCalled();
  });

  it('rejects video with unknown audio metadata on an audio lane', async () => {
    const actions = createActions();
    setMediaState({
      files: [mediaFile({
        id: 'unknown-audio-video',
        type: 'video',
        file: new File(['video'], 'pending.mp4', { type: 'video/mp4' }),
        hasAudio: undefined,
      })],
    });

    const result = await executeTimelineExternalDropCommand({
      actions,
      command: { kind: 'media-file', itemId: 'unknown-audio-video' },
      isAudioOnlyMediaFile: () => false,
      isVideoTrack: false,
      mediaFilePolicy: 'allow-video-on-audio',
      resolveLinkedVideoTrackId: () => 'video-1',
      resolveStartTime: () => 0,
      trackId: 'audio-1',
    });

    expect(result).toEqual({
      handled: true,
      reason: 'media-without-linked-audio-on-audio-track',
    });
    expect(actions.addClip).not.toHaveBeenCalled();
  });

  it('resolves the linked video lane using the authoritative media duration', async () => {
    const actions = createActions();
    const file = new File(['video'], 'long.mp4', { type: 'video/mp4' });
    const resolveLinkedVideoTrackId = vi.fn(() => 'video-2');
    setMediaState({
      files: [mediaFile({
        id: 'long-video',
        type: 'video',
        file,
        duration: 60,
        hasAudio: true,
      })],
    });

    await executeTimelineExternalDropCommand({
      actions,
      command: { kind: 'media-file', itemId: 'long-video' },
      isAudioOnlyMediaFile: () => false,
      isVideoTrack: false,
      mediaFilePolicy: 'allow-video-on-audio',
      resolveLinkedVideoTrackId,
      resolveStartTime: () => 7,
      trackId: 'audio-1',
    });

    expect(resolveLinkedVideoTrackId).toHaveBeenCalledWith(7, 60);
    expect(actions.addClip).toHaveBeenCalledWith(
      'video-2',
      file,
      7,
      60,
      'long-video',
      undefined,
      { linkedAudioTrackId: 'audio-1' },
    );
  });
});
