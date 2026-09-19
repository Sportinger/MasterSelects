import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureProvider: vi.fn(),
  releaseSource: vi.fn(),
  updateMetadata: vi.fn(),
}));

vi.mock('../../src/services/mediaRuntime/clipBindings', () => ({
  bindSourceRuntimeForOwner: vi.fn((input: { source: object }) => ({
    ...input.source,
    runtimeSourceId: 'media:media-prores',
    runtimeSessionKey: 'interactive:source-monitor:media-prores',
  })),
  releaseClipSourceRuntime: mocks.releaseSource,
}));

vi.mock('../../src/services/mediaRuntime/registry', () => ({
  mediaRuntimeRegistry: {
    getRuntime: vi.fn(() => ({ updateMetadata: mocks.updateMetadata })),
  },
}));

vi.mock('../../src/services/mediaRuntime/runtimePlayback', () => ({
  ensureRuntimeFrameProvider: mocks.ensureProvider,
}));

import {
  TurboResSourceMonitorCanvas,
  type TurboResSourceMonitorHandle,
} from '../../src/components/preview/sourceMonitor/TurboResSourceMonitorCanvas';
import type { MediaFile } from '../../src/stores/mediaStore/types';

describe('TurboResSourceMonitorCanvas', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mocks.ensureProvider.mockReset();
    mocks.releaseSource.mockReset();
    mocks.updateMetadata.mockReset();
  });

  it('draws provider frames and exposes seek/play controls without HTML video', async () => {
    const sourceFile = new File(['prores'], 'camera.mov', { type: 'video/quicktime' });
    const frame = {} as VideoFrame;
    const provider = {
      getCurrentFrame: vi.fn(() => frame),
      seek: vi.fn(),
      scrubSeek: vi.fn(),
      advanceToTime: vi.fn(),
      pause: vi.fn(),
      destroy: vi.fn(),
    };
    let onFrame: (() => void) | undefined;
    mocks.ensureProvider.mockImplementation(async (
      _source: unknown,
      _policy: unknown,
      _time: unknown,
      options: { onFrame?: () => void },
    ) => {
      onFrame = options.onFrame;
      return provider;
    });
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(17);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const ref = createRef<TurboResSourceMonitorHandle>();
    const onTimeChange = vi.fn();
    const onPlayingChange = vi.fn();
    const onTogglePlayback = vi.fn();
    const file = {
      id: 'media-prores',
      name: 'camera.mov',
      type: 'video',
      file: sourceFile,
      width: 1920,
      height: 1080,
    } as MediaFile;

    const result = render(
      <TurboResSourceMonitorCanvas
        ref={ref}
        file={file}
        sourceFile={sourceFile}
        fourCC="apch"
        onTimeChange={onTimeChange}
        onPlayingChange={onPlayingChange}
        onTogglePlayback={onTogglePlayback}
      />,
    );
    await waitFor(() => expect(provider.seek).toHaveBeenCalledWith(0));

    act(() => onFrame?.());
    const canvas = result.container.querySelector('canvas');
    expect(drawImage).toHaveBeenCalledWith(frame, 0, 0, 1920, 1080);
    expect(result.container.querySelector('video')).toBeNull();

    act(() => ref.current?.seek(2.5));
    expect(provider.scrubSeek).toHaveBeenCalledWith(2.5);
    act(() => ref.current?.play(1, 5));
    expect(onPlayingChange).toHaveBeenCalledWith(true);
    if (canvas) fireEvent.click(canvas);
    expect(onTogglePlayback).toHaveBeenCalledOnce();

    result.unmount();
    expect(mocks.releaseSource).toHaveBeenCalledWith(expect.objectContaining({
      id: 'source-monitor:media-prores',
    }));
    expect(provider.destroy).not.toHaveBeenCalled();
  });
});
