import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const timelineState = vi.hoisted(() => ({
  clips: [],
  duration: 10,
  inPoint: null as number | null,
  isPlaying: false,
  loopPlayback: false,
  masterAudioState: { volumeDb: 0 },
  pause: vi.fn(),
  play: vi.fn(),
  playheadPosition: 0,
  outPoint: null as number | null,
  setDraggingPlayhead: vi.fn(),
  setInPoint: vi.fn(),
  setInPointAtPlayhead: vi.fn(),
  setMasterAudioVolumeDb: vi.fn(),
  setOutPoint: vi.fn(),
  setOutPointAtPlayhead: vi.fn(),
  setPlayheadPosition: vi.fn(),
  stop: vi.fn(),
  toggleLoopPlayback: vi.fn(),
  tracks: [],
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: (selector: (state: typeof timelineState) => unknown) => selector(timelineState),
}));

import { PreviewTransport } from '../../src/components/preview/PreviewTransport';
import { PreviewDockPanelContext } from '../../src/components/preview/PreviewDockPanelContext';
import { PreviewTransportPortalContext } from '../../src/components/preview/PreviewTransportPortalContext';
import { useDockStore } from '../../src/stores/dockStore';

afterEach(() => {
  cleanup();
  timelineState.inPoint = null;
  timelineState.masterAudioState.volumeDb = 0;
  timelineState.outPoint = null;
  vi.clearAllMocks();
  useDockStore.setState({ maximizedPanelId: null });
});

describe('PreviewTransport scrubbing', () => {
  it('uses the shared interactive playhead drag state', () => {
    const { unmount } = render(
      <PreviewTransport
        playbackControlsVisible
        onTogglePlaybackControls={vi.fn()}
        onToggleSceneObjectOverlay={vi.fn()}
        onToggleTransparency={vi.fn()}
        previewQuality={1}
        sceneObjectOverlayEnabled
        setPreviewQuality={vi.fn()}
        showTransparencyGrid={false}
      />,
    );
    const scrubber = screen.getByRole('slider', { name: 'Preview playhead' });
    Object.assign(scrubber, {
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
    });

    fireEvent.pointerDown(scrubber, { button: 0, pointerId: 17 });
    fireEvent.change(scrubber, { target: { value: '4' } });
    fireEvent.pointerUp(scrubber, { button: 0, pointerId: 17 });

    expect(timelineState.setDraggingPlayhead).toHaveBeenNthCalledWith(1, true);
    expect(timelineState.setDraggingPlayhead).toHaveBeenNthCalledWith(2, false);
    expect(timelineState.setPlayheadPosition).toHaveBeenCalledWith(4);

    timelineState.setDraggingPlayhead.mockClear();
    unmount();
  });

  it('toggles the playback controls independently of viewer overlays', () => {
    const onTogglePlaybackControls = vi.fn();
    const { rerender } = render(
      <PreviewTransport
        playbackControlsVisible
        onTogglePlaybackControls={onTogglePlaybackControls}
        onToggleSceneObjectOverlay={vi.fn()}
        onToggleTransparency={vi.fn()}
        previewQuality={1}
        sceneObjectOverlayEnabled
        setPreviewQuality={vi.fn()}
        showTransparencyGrid={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide playback controls' }));
    expect(onTogglePlaybackControls).toHaveBeenCalledOnce();

    rerender(
      <PreviewTransport
        playbackControlsVisible={false}
        onTogglePlaybackControls={onTogglePlaybackControls}
        onToggleSceneObjectOverlay={vi.fn()}
        onToggleTransparency={vi.fn()}
        previewQuality={1}
        sceneObjectOverlayEnabled
        setPreviewQuality={vi.fn()}
        showTransparencyGrid={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Show playback controls' })).toBeInTheDocument();
    expect(screen.getByLabelText('Preview playback controls')).toHaveClass('collapsed');
    expect(document.querySelector('.preview-transport-scrubber')).toHaveAttribute('tabindex', '-1');
  });

  it('sets timeline In and Out points from the shared Preview transport', () => {
    const renderTransport = () => (
      <PreviewTransport
        playbackControlsVisible
        onTogglePlaybackControls={vi.fn()}
        onToggleSceneObjectOverlay={vi.fn()}
        onToggleTransparency={vi.fn()}
        previewQuality={1}
        sceneObjectOverlayEnabled
        setPreviewQuality={vi.fn()}
        showTransparencyGrid={false}
      />
    );
    const { rerender } = render(renderTransport());
    const inButton = screen.getByRole('button', { name: 'Set In point at playhead' });
    const outButton = screen.getByRole('button', { name: 'Set Out point at playhead' });

    fireEvent.click(inButton);
    fireEvent.click(outButton);

    expect(timelineState.setInPointAtPlayhead).toHaveBeenCalledOnce();
    expect(timelineState.setOutPointAtPlayhead).toHaveBeenCalledOnce();

    timelineState.inPoint = 1;
    timelineState.outPoint = 6;
    rerender(renderTransport());
    expect(inButton).toHaveClass('active');
    expect(outButton).toHaveClass('active');

    fireEvent.click(screen.getByRole('button', { name: 'Clear In point' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear Out point' }));
    expect(timelineState.setInPoint).toHaveBeenCalledWith(null);
    expect(timelineState.setOutPoint).toHaveBeenCalledWith(null);
  });

  it('maximizes and restores its docked Preview panel', () => {
    render(
      <PreviewDockPanelContext.Provider value="preview-test">
        <PreviewTransport
          playbackControlsVisible
          onTogglePlaybackControls={vi.fn()}
          onToggleSceneObjectOverlay={vi.fn()}
          onToggleTransparency={vi.fn()}
          previewQuality={1}
          sceneObjectOverlayEnabled
          setPreviewQuality={vi.fn()}
          showTransparencyGrid={false}
        />
      </PreviewDockPanelContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Maximize preview panel' }));
    expect(useDockStore.getState().maximizedPanelId).toBe('preview-test');

    fireEvent.click(screen.getByRole('button', { name: 'Restore preview panel' }));
    expect(useDockStore.getState().maximizedPanelId).toBeNull();
  });

  it('uses the shared transport shell for source-specific controls', () => {
    const setSourceControlsTarget = vi.fn();
    const { container } = render(
      <PreviewTransportPortalContext.Provider value={{
        externalSourceControls: true,
        sourceControlsTarget: null,
        setSourceControlsTarget,
      }}>
        <PreviewTransport
          playbackControlsVisible
          onTogglePlaybackControls={vi.fn()}
          onToggleSceneObjectOverlay={vi.fn()}
          onToggleTransparency={vi.fn()}
          previewQuality={1}
          sceneObjectOverlayEnabled
          sourceMonitorActive
          setPreviewQuality={vi.fn()}
          showTransparencyGrid={false}
        />
      </PreviewTransportPortalContext.Provider>,
    );

    expect(screen.getByLabelText('Source playback controls')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide playback controls' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Preview playhead' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Preview quality' })).not.toBeInTheDocument();
    expect(container.querySelector('.preview-source-transport-slot')).toBeInTheDocument();
    expect(setSourceControlsTarget).toHaveBeenCalledWith(
      container.querySelector('.preview-source-transport-slot'),
    );
  });

  it('hides every viewer tool until the overlay toggle is enabled', () => {
    const setPreviewQuality = vi.fn();
    const renderPreview = (sceneObjectOverlayEnabled: boolean) => (
      <PreviewDockPanelContext.Provider value="preview-test">
        <PreviewTransport
          playbackControlsVisible
          onTogglePlaybackControls={vi.fn()}
          onToggleSceneObjectOverlay={vi.fn()}
          onToggleTransparency={vi.fn()}
          previewQuality={0.5}
          sceneObjectOverlayEnabled={sceneObjectOverlayEnabled}
          setPreviewQuality={setPreviewQuality}
          showTransparencyGrid={false}
        />
      </PreviewDockPanelContext.Provider>
    );
    const { rerender } = render(
      renderPreview(false),
    );

    expect(screen.queryByRole('button', { name: 'Toggle transparency grid' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide playback controls' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Maximize preview panel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Toggle viewer overlays' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Preview quality' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mute all audio' })).not.toBeInTheDocument();

    rerender(renderPreview(true));
    expect(document.querySelector('.preview-transport-quality-text')).toHaveTextContent('Half');

    fireEvent.change(screen.getByRole('combobox', { name: 'Preview quality' }), {
      target: { value: '0.25' },
    });
    expect(setPreviewQuality).toHaveBeenCalledWith(0.25);

    fireEvent.click(screen.getByRole('button', { name: 'Mute all audio' }));
    expect(timelineState.setMasterAudioVolumeDb).toHaveBeenCalledWith(-60);

    timelineState.masterAudioState.volumeDb = -60;
    rerender(renderPreview(true));
    const unmuteButton = screen.getByRole('button', { name: 'Unmute all audio' });
    expect(unmuteButton.querySelector('.tabler-icon-volume-off')).toBeInTheDocument();

    fireEvent.click(unmuteButton);
    expect(timelineState.setMasterAudioVolumeDb).toHaveBeenLastCalledWith(0);
  });
});
