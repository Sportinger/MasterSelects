import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaRuntimeRegistry } from '../../src/services/mediaRuntime/registry';
import { updateTimelineClips } from '../../src/stores/mediaStore/slices/fileManage/timelineClipReload';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const initialTimelineState = useTimelineStore.getState();

function clip(id: string, trackId: string): TimelineClip {
  return {
    id,
    trackId,
    name: `${id}.braw`,
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    needsReload: true,
    source: {
      type: 'video',
      mediaFileId: 'media-prores',
      naturalDuration: 10,
    },
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      anchor: { x: 0.5, y: 0.5 },
    },
    effects: [],
  };
}

function track(id: string, type: 'video' | 'audio'): TimelineTrack {
  return {
    id,
    name: id,
    type,
    visible: true,
    locked: false,
    muted: false,
    solo: false,
    height: 64,
    order: 0,
  } as TimelineTrack;
}

describe('timeline clip runtime reload', () => {
  beforeEach(() => {
    mediaRuntimeRegistry.clear();
    const file = new File(['prores'], 'A006_Proxy.mov', { type: 'video/quicktime' });
    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [{
        id: 'media-prores',
        name: 'A006.braw',
        type: 'video',
        file,
        duration: 10,
        videoCodecId: 'apco',
      } as MediaFile],
    } as ReturnType<typeof useMediaStore.getState>);
    useTimelineStore.setState({
      clips: [clip('video-clip', 'video-track'), clip('audio-clip', 'audio-track')],
      tracks: [track('video-track', 'video'), track('audio-track', 'audio')],
    });
  });

  afterEach(() => {
    mediaRuntimeRegistry.clear();
    useTimelineStore.setState(initialTimelineState, true);
  });

  it('binds replacement files and corrects Premiere audio-track sources', async () => {
    const file = useMediaStore.getState().files[0].file!;

    await updateTimelineClips('media-prores', file, {
      generateThumbnails: false,
      invalidateCaches: false,
    });

    const [videoClip, audioClip] = useTimelineStore.getState().clips;
    expect(videoClip.source).toMatchObject({
      type: 'video',
      runtimeSourceId: 'media:media-prores',
      runtimeSessionKey: 'interactive:video-clip',
    });
    expect(audioClip.source).toMatchObject({
      type: 'audio',
      runtimeSourceId: 'media:media-prores',
      runtimeSessionKey: 'interactive:audio-clip',
    });
    expect(videoClip.needsReload).toBe(false);
    expect(audioClip.needsReload).toBe(false);
    expect(mediaRuntimeRegistry.getRuntime('media:media-prores')?.metadata.videoCodecId).toBe('apco');
  });

  it('keeps Premiere audio clips offline when the attached proxy has no audio', async () => {
    const mediaFile = useMediaStore.getState().files[0];
    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [{ ...mediaFile, hasAudio: false }],
    } as ReturnType<typeof useMediaStore.getState>);

    await updateTimelineClips('media-prores', mediaFile.file!, {
      generateThumbnails: false,
      invalidateCaches: false,
    });

    const [videoClip, audioClip] = useTimelineStore.getState().clips;
    expect(videoClip.needsReload).toBe(false);
    expect(audioClip).toMatchObject({
      file: undefined,
      needsReload: true,
      source: {
        type: 'audio',
        mediaFileId: 'media-prores',
      },
    });
  });
});
