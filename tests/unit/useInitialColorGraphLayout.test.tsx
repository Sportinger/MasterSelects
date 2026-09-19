import { useRef } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useInitialColorGraphLayout } from '../../src/components/panels/color/useInitialColorGraphLayout';

function LayoutHarness({
  clipId,
  enabled,
  initialize,
  setViewport,
}: {
  clipId: string;
  enabled: boolean;
  initialize: (clipId: string, width: number, height: number, force?: boolean) => void;
  setViewport: (
    clipId: string,
    viewport: { x: number; y: number; zoom: number },
  ) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  useInitialColorGraphLayout({ canvasRef, clipId, enabled, initialize, setViewport });
  return <div ref={canvasRef} />;
}

describe('initial Color graph layout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forces Original Size when the layout mounts and when the selected clip changes', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 900,
      bottom: 500,
      width: 900,
      height: 500,
      toJSON: () => ({}),
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 1;
    });
    const initialize = vi.fn();
    const setViewport = vi.fn();
    const view = render(
      <LayoutHarness clipId="clip-1" enabled initialize={initialize} setViewport={setViewport} />,
    );

    expect(initialize).toHaveBeenLastCalledWith('clip-1', 900, 500);
    expect(setViewport).toHaveBeenLastCalledWith('clip-1', { x: 0, y: 0, zoom: 1 });

    view.rerender(
      <LayoutHarness clipId="clip-2" enabled initialize={initialize} setViewport={setViewport} />,
    );

    expect(initialize).toHaveBeenLastCalledWith('clip-2', 900, 500);
    expect(setViewport).toHaveBeenLastCalledWith('clip-2', { x: 0, y: 0, zoom: 1 });
    expect(initialize.mock.calls.some(call => call[3] === true)).toBe(false);
  });

  it('forces Original Size when the Color layout becomes active', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 450,
      width: 800,
      height: 450,
      toJSON: () => ({}),
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 1;
    });
    const initialize = vi.fn();
    const setViewport = vi.fn();
    const view = render(
      <LayoutHarness
        clipId="clip-1"
        enabled={false}
        initialize={initialize}
        setViewport={setViewport}
      />,
    );
    expect(initialize).not.toHaveBeenCalled();
    expect(setViewport).not.toHaveBeenCalled();

    view.rerender(
      <LayoutHarness clipId="clip-1" enabled initialize={initialize} setViewport={setViewport} />,
    );

    expect(initialize).toHaveBeenCalledWith('clip-1', 800, 450);
    expect(setViewport).toHaveBeenCalledWith('clip-1', { x: 0, y: 0, zoom: 1 });
  });
});
