import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineContextMenu } from '../../src/components/timeline/TimelineContextMenu';
import { useMediaStore, type MediaFile } from '../../src/stores/mediaStore';
import type { TimelineClip } from '../../src/types';

function createClip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip-video',
    trackId: 'track-video',
    name: 'Clip.mp4',
    file: new File(['video'], 'Clip.mp4', { type: 'video/mp4' }),
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    source: {
      type: 'video',
      videoElement: document.createElement('video'),
      naturalDuration: 10,
      mediaFileId: 'media-video',
    },
    mediaFileId: 'media-video',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      opacity: 1,
      anchorPoint: { x: 0.5, y: 0.5, z: 0 },
    },
    effects: [],
    ...overrides,
  } as TimelineClip;
}

function renderMenu(params: {
  clips: TimelineClip[];
  mediaFile: MediaFile;
  generateWaveformForClip?: ReturnType<typeof vi.fn>;
  generateSpectrogramForClip?: ReturnType<typeof vi.fn>;
}) {
  useMediaStore.setState({ files: [params.mediaFile] });

  const clipMap = new Map(params.clips.map((clip) => [clip.id, clip]));
  const setContextMenu = vi.fn();
  const generateWaveformForClip = params.generateWaveformForClip ?? vi.fn();
  const generateSpectrogramForClip = params.generateSpectrogramForClip ?? vi.fn();

  render(
    <TimelineContextMenu
      contextMenu={{ x: 12, y: 18, clipId: params.clips[0].id }}
      setContextMenu={setContextMenu}
      clipMap={clipMap}
      selectedClipIds={new Set([params.clips[0].id])}
      isClipLocked={() => false}
      thumbnailsEnabled
      waveformsEnabled
      audioDisplayMode="compact"
      clipStemSeparationJobs={{}}
      selectClip={vi.fn()}
      removeClip={vi.fn()}
      splitClipAtPlayhead={vi.fn()}
      rippleDeleteSelection={vi.fn()}
      deleteGapAtTime={vi.fn()}
      toggleClipReverse={vi.fn()}
      unlinkGroup={vi.fn()}
      linkClips={vi.fn()}
      unlinkClips={vi.fn()}
      generateWaveformForClip={generateWaveformForClip}
      generateSpectrogramForClip={generateSpectrogramForClip}
      startClipStemSeparation={vi.fn().mockResolvedValue(null)}
      toggleThumbnailsEnabled={vi.fn()}
      toggleWaveformsEnabled={vi.fn()}
      setAudioDisplayMode={vi.fn()}
      convertSolidToMotionShape={vi.fn()}
      createSubcompositionFromSelection={vi.fn()}
      copyClipEffects={vi.fn()}
      pasteClipEffects={vi.fn()}
      hasClipboardEffects={() => false}
      copyClipColor={vi.fn()}
      pasteClipColor={vi.fn()}
      hasClipboardColor={() => false}
      setMulticamDialogOpen={vi.fn()}
      showInExplorer={vi.fn().mockResolvedValue({ success: true, message: 'ok' })}
    />,
  );

  return { setContextMenu, generateWaveformForClip, generateSpectrogramForClip };
}

afterEach(() => {
  cleanup();
  useMediaStore.setState({ files: [] });
});

describe('TimelineContextMenu regenerate menu', () => {
  it('bundles video and audio regeneration actions for clips with linked audio', () => {
    const videoClip = createClip({ id: 'clip-video', linkedClipId: 'clip-audio' });
    const audioClip = createClip({
      id: 'clip-audio',
      trackId: 'track-audio',
      name: 'Clip (Audio)',
      linkedClipId: 'clip-video',
      source: {
        type: 'audio',
        audioElement: document.createElement('audio'),
        naturalDuration: 10,
        mediaFileId: 'media-video',
      },
      waveform: [0.1, 0.4, 0.2],
    });
    const generateWaveformForClip = vi.fn();

    renderMenu({
      clips: [videoClip, audioClip],
      mediaFile: {
        id: 'media-video',
        name: 'Clip.mp4',
        type: 'video',
        parentId: null,
        createdAt: 1,
        file: new File(['video'], 'Clip.mp4', { type: 'video/mp4' }),
        url: 'blob:video',
        duration: 10,
        hasAudio: true,
        audioCodec: 'aac',
        proxyStatus: 'ready',
        audioProxyStatus: 'ready',
        hasProxyAudio: true,
      } as MediaFile,
      generateWaveformForClip,
    });

    expect(screen.getByText('Regenerate')).toBeTruthy();
    expect(screen.getAllByText(/^Proxy/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Thumbnails/).length).toBeGreaterThan(0);
    expect(screen.getByText(/WAV Audio Proxy/)).toBeTruthy();
    expect(screen.getByText(/Waveform/)).toBeTruthy();
    expect(screen.getByText(/Spectral/)).toBeTruthy();

    fireEvent.click(screen.getByText(/Waveform/));
    expect(generateWaveformForClip).toHaveBeenCalledWith('clip-audio', { force: true });
  });

  it('hides audio regeneration actions when the source video has no audio', () => {
    const videoClip = createClip({ id: 'clip-video' });

    renderMenu({
      clips: [videoClip],
      mediaFile: {
        id: 'media-video',
        name: 'Silent.mp4',
        type: 'video',
        parentId: null,
        createdAt: 1,
        file: new File(['video'], 'Silent.mp4', { type: 'video/mp4' }),
        url: 'blob:video',
        duration: 10,
        hasAudio: false,
      } as MediaFile,
    });

    expect(screen.getByText('Regenerate')).toBeTruthy();
    expect(screen.queryByText(/WAV Audio Proxy/)).toBeNull();
    expect(screen.queryByText(/Waveform/)).toBeNull();
    expect(screen.queryByText(/Spectral/)).toBeNull();
  });
});
