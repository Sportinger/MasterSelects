import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineContextMenu } from '../../src/components/timeline/TimelineContextMenu';
import { downloadBlob } from '../../src/engine/export';
import { captureCurrentPreviewFrameJpegBlob } from '../../src/services/previewFrameCapture';
import { useMediaStore, type MediaFile } from '../../src/stores/mediaStore';
import type { TimelineClip } from '../../src/types';

vi.mock('../../src/engine/export', () => ({
  downloadBlob: vi.fn(),
}));

vi.mock('../../src/services/previewFrameCapture', () => ({
  captureCurrentPreviewFrameJpegBlob: vi.fn(),
}));

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
  mediaFile?: MediaFile | null;
  contextClipId?: string;
  selectedClipIds?: Set<string>;
  generateWaveformForClip?: ReturnType<typeof vi.fn>;
  generateSpectrogramForClip?: ReturnType<typeof vi.fn>;
  deleteGapAtTime?: ReturnType<typeof vi.fn>;
  removeClip?: ReturnType<typeof vi.fn>;
  splitClipAtPlayhead?: ReturnType<typeof vi.fn>;
  rippleDeleteSelection?: ReturnType<typeof vi.fn>;
  deleteClipSelection?: ReturnType<typeof vi.fn>;
  createSubcompositionFromSelection?: ReturnType<typeof vi.fn>;
  syncClipsViaAudio?: ReturnType<typeof vi.fn>;
  copyClipEffects?: ReturnType<typeof vi.fn>;
  copyClipColor?: ReturnType<typeof vi.fn>;
}) {
  useMediaStore.setState({ files: params.mediaFile ? [params.mediaFile] : [] });

  const clipMap = new Map(params.clips.map((clip) => [clip.id, clip]));
  const setContextMenu = vi.fn();
  const generateWaveformForClip = params.generateWaveformForClip ?? vi.fn();
  const generateSpectrogramForClip = params.generateSpectrogramForClip ?? vi.fn();
  const deleteGapAtTime = params.deleteGapAtTime ?? vi.fn();
  const removeClip = params.removeClip ?? vi.fn();
  const splitClipAtPlayhead = params.splitClipAtPlayhead ?? vi.fn();
  const rippleDeleteSelection = params.rippleDeleteSelection ?? vi.fn();
  const deleteClipSelection = params.deleteClipSelection ?? vi.fn();
  const createSubcompositionFromSelection = params.createSubcompositionFromSelection ?? vi.fn();
  const syncClipsViaAudio = params.syncClipsViaAudio ?? vi.fn();
  const copyClipEffects = params.copyClipEffects ?? vi.fn();
  const copyClipColor = params.copyClipColor ?? vi.fn();
  const contextClipId = params.contextClipId ?? params.clips[0]?.id ?? 'missing-clip';

  render(
    <TimelineContextMenu
      contextMenu={{ x: 12, y: 18, clipId: contextClipId }}
      setContextMenu={setContextMenu}
      clipMap={clipMap}
      selectedClipIds={params.selectedClipIds ?? new Set([contextClipId])}
      isClipLocked={() => false}
      thumbnailsEnabled
      waveformsEnabled
      audioDisplayMode="compact"
      clipStemSeparationJobs={{}}
      selectClip={vi.fn()}
      removeClip={removeClip}
      splitClipAtPlayhead={splitClipAtPlayhead}
      rippleDeleteSelection={rippleDeleteSelection}
      deleteClipSelection={deleteClipSelection}
      deleteGapAtTime={deleteGapAtTime}
      toggleClipReverse={vi.fn()}
      unlinkGroup={vi.fn()}
      linkClips={vi.fn()}
      unlinkClips={vi.fn()}
      syncClipsViaAudio={syncClipsViaAudio}
      generateWaveformForClip={generateWaveformForClip}
      generateSpectrogramForClip={generateSpectrogramForClip}
      startClipStemSeparation={vi.fn().mockResolvedValue(null)}
      toggleThumbnailsEnabled={vi.fn()}
      toggleWaveformsEnabled={vi.fn()}
      setAudioDisplayMode={vi.fn()}
      convertSolidToMotionShape={vi.fn()}
      createSubcompositionFromSelection={createSubcompositionFromSelection}
      copyClipEffects={copyClipEffects}
      pasteClipEffects={vi.fn()}
      hasClipboardEffects={() => false}
      copyClipColor={copyClipColor}
      pasteClipColor={vi.fn()}
      hasClipboardColor={() => false}
      setMulticamDialogOpen={vi.fn()}
      showInExplorer={vi.fn().mockResolvedValue({ success: true, message: 'ok' })}
    />,
  );

  return {
    setContextMenu,
    generateWaveformForClip,
    generateSpectrogramForClip,
    deleteGapAtTime,
    removeClip,
    splitClipAtPlayhead,
    rippleDeleteSelection,
    deleteClipSelection,
    createSubcompositionFromSelection,
    syncClipsViaAudio,
    copyClipEffects,
    copyClipColor,
  };
}

afterEach(() => {
  cleanup();
  useMediaStore.setState({ files: [] });
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('TimelineContextMenu regenerate menu', () => {
  it('shows video-specific effect and thumbnail actions for video clips', () => {
    const videoClip = createClip({ id: 'clip-video' });

    renderMenu({
      clips: [videoClip],
      mediaFile: {
        id: 'media-video',
        name: 'Clip.mp4',
        type: 'video',
        parentId: null,
        createdAt: 1,
        file: new File(['video'], 'Clip.mp4', { type: 'video/mp4' }),
        url: 'blob:video',
        duration: 10,
        hasAudio: false,
      } as MediaFile,
    });

    expect(screen.getByText('Effects')).toBeTruthy();
    expect(screen.getByText('Copy Video Effects')).toBeTruthy();
    expect(screen.getByText('Paste Video Effects')).toBeTruthy();
    expect(screen.getByText('Copy Color')).toBeTruthy();
    expect(screen.getByText('Paste Color')).toBeTruthy();
    expect(screen.getByText(/Show Thumbnail/)).toBeTruthy();
    expect(screen.queryByText('Copy Audio Effects')).toBeNull();
    expect(screen.queryByText('Audio Display')).toBeNull();
  });

  it('shows audio-specific effects without color clipboard actions for audio clips', () => {
    const audioClip = createClip({
      id: 'clip-audio',
      trackId: 'track-audio',
      name: 'Clip.wav',
      mediaFileId: 'media-audio',
      source: {
        type: 'audio',
        audioElement: document.createElement('audio'),
        naturalDuration: 10,
        mediaFileId: 'media-audio',
      },
    });

    renderMenu({
      clips: [audioClip],
      mediaFile: {
        id: 'media-audio',
        name: 'Clip.wav',
        type: 'audio',
        parentId: null,
        createdAt: 1,
        file: new File(['audio'], 'Clip.wav', { type: 'audio/wav' }),
        url: 'blob:audio',
        duration: 10,
      } as MediaFile,
    });

    expect(screen.getByText('Effects')).toBeTruthy();
    expect(screen.getByText('Copy Audio Effects')).toBeTruthy();
    expect(screen.getByText('Paste Audio Effects')).toBeTruthy();
    expect(screen.getByText('Audio Display')).toBeTruthy();
    expect(screen.queryByText('Copy Video Effects')).toBeNull();
    expect(screen.queryByText('Copy Color')).toBeNull();
    expect(screen.queryByText('Paste Color')).toBeNull();
    expect(screen.queryByText(/Show Thumbnail/)).toBeNull();
  });

  it('exports the current frame as a jpg from visual clip menus', async () => {
    const blob = new Blob(['jpg'], { type: 'image/jpeg' });
    vi.mocked(captureCurrentPreviewFrameJpegBlob).mockResolvedValueOnce(blob);
    renderMenu({
      clips: [createClip({ id: 'clip-video' })],
      mediaFile: {
        id: 'media-video',
        name: 'Clip.mp4',
        type: 'video',
        parentId: null,
        createdAt: 1,
        file: new File(['video'], 'Clip.mp4', { type: 'video/mp4' }),
        url: 'blob:video',
        duration: 10,
        hasAudio: false,
      } as MediaFile,
    });

    fireEvent.click(screen.getByText('Export Current Frame'));

    await waitFor(() => {
      expect(captureCurrentPreviewFrameJpegBlob).toHaveBeenCalledTimes(1);
      expect(downloadBlob).toHaveBeenCalledWith(blob, 'Clip_frame_0_00s.jpg');
    });
  });

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

  it('shows sync via audio for multi-audio selections and hides the old multicam command', async () => {
    const videoA = createClip({ id: 'clip-video-a', linkedClipId: 'clip-audio-a' });
    const audioA = createClip({
      id: 'clip-audio-a',
      trackId: 'track-audio',
      name: 'A (Audio)',
      linkedClipId: 'clip-video-a',
      source: { type: 'audio', naturalDuration: 10, mediaFileId: 'media-a' },
    });
    const videoB = createClip({
      id: 'clip-video-b',
      mediaFileId: 'media-b',
      linkedClipId: 'clip-audio-b',
      source: { type: 'video', naturalDuration: 10, mediaFileId: 'media-b' },
    });
    const audioB = createClip({
      id: 'clip-audio-b',
      trackId: 'track-audio',
      name: 'B (Audio)',
      mediaFileId: 'media-b',
      linkedClipId: 'clip-video-b',
      source: { type: 'audio', naturalDuration: 10, mediaFileId: 'media-b' },
    });
    const syncClipsViaAudio = vi.fn(async () => null);

    renderMenu({
      clips: [videoA, audioA, videoB, audioB],
      selectedClipIds: new Set(['clip-video-a', 'clip-video-b']),
      syncClipsViaAudio,
      mediaFile: {
        id: 'media-a',
        name: 'A.mp4',
        type: 'video',
        parentId: null,
        createdAt: 1,
        file: new File(['video'], 'A.mp4', { type: 'video/mp4' }),
        url: 'blob:a',
        duration: 10,
        hasAudio: true,
      } as MediaFile,
    });

    expect(screen.getByText('Sync via Audio')).toBeTruthy();
    expect(screen.queryByText(/Combine Multicam/)).toBeNull();

    fireEvent.click(screen.getByText('Sync via Audio'));
    await Promise.resolve();

    expect(syncClipsViaAudio).toHaveBeenCalledWith(['clip-video-a', 'clip-video-b'], 'clip-video-a');
  });

  it('keeps a disabled thumbnail regeneration command open when no source URL is available', () => {
    const videoClip = createClip({ id: 'clip-video' });
    const { setContextMenu } = renderMenu({
      clips: [videoClip],
      mediaFile: {
        id: 'media-video',
        name: 'No Source.mp4',
        type: 'video',
        parentId: null,
        createdAt: 1,
        duration: 10,
        hasAudio: false,
      } as MediaFile,
    });

    fireEvent.click(screen.getByText(/Thumbnails/));

    expect(setContextMenu).not.toHaveBeenCalled();
  });

  it('does not delete a gap for a stale context-menu clip id', () => {
    const deleteGapAtTime = vi.fn();
    const { setContextMenu } = renderMenu({
      clips: [],
      mediaFile: null,
      contextClipId: 'missing-clip',
      deleteGapAtTime,
    });

    fireEvent.click(screen.getByText('Delete Gap at Clip Start'));

    expect(deleteGapAtTime).not.toHaveBeenCalled();
    expect(setContextMenu).not.toHaveBeenCalled();
  });

  it('keeps stale clip mutation commands inert and open', async () => {
    const removeClip = vi.fn();
    const splitClipAtPlayhead = vi.fn();
    const rippleDeleteSelection = vi.fn();
    const deleteClipSelection = vi.fn();
    const createSubcompositionFromSelection = vi.fn();
    const copyClipEffects = vi.fn();
    const copyClipColor = vi.fn();
    const { setContextMenu } = renderMenu({
      clips: [],
      mediaFile: null,
      contextClipId: 'missing-clip',
      removeClip,
      splitClipAtPlayhead,
      rippleDeleteSelection,
      deleteClipSelection,
      createSubcompositionFromSelection,
      copyClipEffects,
      copyClipColor,
    });

    fireEvent.click(screen.getByText('Copy Effects'));
    fireEvent.click(screen.getByText('Copy Color'));
    fireEvent.click(screen.getByText('Split at Playhead (C)'));
    fireEvent.click(screen.getByText('Ripple Delete'));
    fireEvent.click(screen.getByText('Create Subcomposition'));
    fireEvent.click(screen.getByText('Delete Clip From Timeline'));
    await Promise.resolve();
    await Promise.resolve();

    expect(copyClipEffects).not.toHaveBeenCalled();
    expect(copyClipColor).not.toHaveBeenCalled();
    expect(splitClipAtPlayhead).not.toHaveBeenCalled();
    expect(rippleDeleteSelection).not.toHaveBeenCalled();
    expect(deleteClipSelection).not.toHaveBeenCalled();
    expect(createSubcompositionFromSelection).not.toHaveBeenCalled();
    expect(removeClip).not.toHaveBeenCalled();
    expect(setContextMenu).not.toHaveBeenCalled();
  });

  it('keeps a disabled transcription command open while a clip is already transcribing', async () => {
    const videoClip = createClip({
      id: 'clip-video',
      transcriptStatus: 'transcribing',
      transcriptProgress: 42,
    });
    const { setContextMenu } = renderMenu({
      clips: [videoClip],
      mediaFile: {
        id: 'media-video',
        name: 'Clip.mp4',
        type: 'video',
        parentId: null,
        createdAt: 1,
        file: new File(['video'], 'Clip.mp4', { type: 'video/mp4' }),
        url: 'blob:video',
        duration: 10,
        hasAudio: false,
      } as MediaFile,
    });

    fireEvent.click(screen.getByText(/Transcribing/));
    await Promise.resolve();

    expect(setContextMenu).not.toHaveBeenCalled();
  });

  it('keeps label-color swatches inert when no media item target exists', async () => {
    const videoClip = createClip({ id: 'clip-video', mediaFileId: 'missing-media' });
    const { setContextMenu } = renderMenu({
      clips: [videoClip],
      mediaFile: null,
    });

    fireEvent.click(screen.getByTitle('Red'));
    await waitFor(() => {
      expect(setContextMenu).not.toHaveBeenCalled();
    });
  });
});
