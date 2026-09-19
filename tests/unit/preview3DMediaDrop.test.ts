import { describe, expect, it, vi } from 'vitest';

import {
  canDropMediaFileIn3DPreview,
  placeMediaFileIn3DPreview,
  type Preview3DMediaPlacementActions,
} from '../../src/components/preview/usePreview3DMediaDrop';
import type { MediaFile } from '../../src/stores/mediaStore';

function mediaFile(overrides: Partial<MediaFile> = {}): MediaFile {
  return {
    id: 'media-1',
    name: 'shot.mp4',
    type: 'video',
    parentId: null,
    createdAt: 1,
    url: 'blob:shot',
    duration: 8,
    file: new File(['video'], 'shot.mp4', { type: 'video/mp4' }),
    ...overrides,
  } as MediaFile;
}

function actions(overrides: Partial<Preview3DMediaPlacementActions> = {}): Preview3DMediaPlacementActions {
  return {
    addClip: vi.fn(async () => 'clip-1'),
    addVideoTrack: vi.fn(() => 'video-new'),
    getClip: vi.fn(() => ({ is3D: true })),
    placeLiveInput: vi.fn(() => 'clip-live'),
    removeTrack: vi.fn(),
    resolveMediaFile: vi.fn(async (item) => item.file ?? null),
    selectClip: vi.fn(),
    toggle3D: vi.fn(),
    ...overrides,
  };
}

describe('Preview 3D media drop', () => {
  it('adds a Media Panel video to a new track as a fitted 3D layer', async () => {
    const item = mediaFile();
    const placementActions = actions();

    await expect(placeMediaFileIn3DPreview(item, 3, placementActions)).resolves.toBe('clip-1');
    expect(placementActions.addVideoTrack).toHaveBeenCalledOnce();
    expect(placementActions.addClip).toHaveBeenCalledWith(
      'video-new',
      item.file,
      3,
      8,
      'media-1',
      undefined,
      { is3D: true, visualScaleMode: 'fit' },
    );
    expect(placementActions.selectClip).toHaveBeenCalledWith('clip-1');
    expect(placementActions.toggle3D).not.toHaveBeenCalled();
  });

  it('turns a dropped live input into a 3D layer synchronously', async () => {
    const item = mediaFile({
      file: undefined,
      liveInput: { kind: 'video-device' },
      url: '',
    });
    const placementActions = actions({ getClip: vi.fn(() => ({ is3D: false })) });

    await expect(placeMediaFileIn3DPreview(item, 4, placementActions)).resolves.toBe('clip-live');
    expect(placementActions.resolveMediaFile).not.toHaveBeenCalled();
    expect(placementActions.placeLiveInput).toHaveBeenCalledWith(item, 'video-new', 4);
    expect(placementActions.toggle3D).toHaveBeenCalledWith('clip-live');
  });

  it('rejects audio-only media without creating a track', async () => {
    const item = mediaFile({
      type: 'audio',
      file: new File(['audio'], 'sound.wav', { type: 'audio/wav' }),
    });
    const placementActions = actions();

    expect(canDropMediaFileIn3DPreview(item)).toBe(false);
    await expect(placeMediaFileIn3DPreview(item, 0, placementActions)).resolves.toBeNull();
    expect(placementActions.addVideoTrack).not.toHaveBeenCalled();
  });

  it('removes the empty track when placement fails', async () => {
    const placementActions = actions({ addClip: vi.fn(async () => undefined) });

    await expect(placeMediaFileIn3DPreview(mediaFile(), 0, placementActions)).resolves.toBeNull();
    expect(placementActions.removeTrack).toHaveBeenCalledWith('video-new');
  });
});
