import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const liveInputMocks = vi.hoisted(() => ({
  getRevision: vi.fn(() => 1),
  getVideoElement: vi.fn(),
  registerPresentationVideo: vi.fn(() => () => undefined),
  refreshPresentationVideo: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
}));

vi.mock('../../src/services/mediaRuntime/liveInputRuntime', () => ({
  liveInputRuntime: liveInputMocks,
}));

import { LiveInputPreviewCanvas } from '../../src/components/panels/media/LiveInputPreviewCanvas';

describe('LiveInputPreviewCanvas', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    liveInputMocks.getVideoElement.mockReset();
    liveInputMocks.registerPresentationVideo.mockReset();
    liveInputMocks.registerPresentationVideo.mockImplementation(() => () => undefined);
    liveInputMocks.refreshPresentationVideo.mockReset();
  });

  it('presents the existing camera stream through a visible native video', () => {
    const stream = {} as MediaStream;
    const source = document.createElement('video');
    source.srcObject = stream;
    liveInputMocks.getVideoElement.mockReturnValue(source);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

    const view = render(
      <LiveInputPreviewCanvas className="live-preview" liveInputId="live-1" />,
    );
    const preview = view.container.querySelector('video');

    expect(preview).not.toBeNull();
    expect(preview?.srcObject).toBe(stream);
    expect(preview).toHaveClass('live-preview');
    expect(preview).toHaveAttribute('autoplay');
    expect(preview).toHaveAttribute('data-live-input-presentation-role', 'media-panel');
    expect(play).toHaveBeenCalled();
    expect(liveInputMocks.registerPresentationVideo).toHaveBeenCalledWith('live-1', preview);

    vi.useFakeTimers();
    window.dispatchEvent(new Event('orientationchange'));
    vi.advanceTimersByTime(180);
    expect(liveInputMocks.refreshPresentationVideo).toHaveBeenCalledWith('live-1', preview);
    vi.useRealTimers();

    view.unmount();
    expect(pause).toHaveBeenCalled();
    expect(preview?.srcObject).toBeNull();
  });

  it('marks composition-preview surfaces separately from Media Panel videos', () => {
    const stream = {} as MediaStream;
    const source = document.createElement('video');
    source.srcObject = stream;
    liveInputMocks.getVideoElement.mockReturnValue(source);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    const view = render(
      <LiveInputPreviewCanvas
        liveInputId="live-1"
        presentationRole="composition-preview"
      />,
    );

    expect(view.container.querySelector('video')).toHaveAttribute(
      'data-live-input-presentation-role',
      'composition-preview',
    );
  });
});
