import { render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RenderSource } from '../../src/types/renderTarget';
import { usePreviewRenderTargetRegistration } from '../../src/components/preview/usePreviewRenderTargetRegistration';

const mocks = vi.hoisted(() => ({
  registerPreviewTarget: vi.fn(() => true),
  setPreviewTargetTransparency: vi.fn(),
  setPreviewTargetViewportOverride: vi.fn(),
  unregisterPreviewTarget: vi.fn(),
}));

vi.mock('../../src/services/render/previewTargetRegistration', () => ({
  registerPreviewTarget: mocks.registerPreviewTarget,
  setPreviewTargetTransparency: mocks.setPreviewTargetTransparency,
  setPreviewTargetViewportOverride: mocks.setPreviewTargetViewportOverride,
  unregisterPreviewTarget: mocks.unregisterPreviewTarget,
}));

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: () => ({
      debug: vi.fn(),
    }),
  },
}));

const source: RenderSource = { type: 'activeComp' };
const setCompReady = vi.fn();

interface HarnessProps {
  showTransparencyGrid: boolean;
  viewportOverride?: { width: number; height: number; cameraOverride: null } | null;
}

function Harness({ showTransparencyGrid, viewportOverride }: HarnessProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  usePreviewRenderTargetRegistration({
    canvasRef,
    isEngineReady: true,
    panelId: 'preview-a',
    setCompReady,
    showTransparencyGrid,
    stableRenderSource: source,
    viewportOverride,
  });
  return <canvas ref={canvasRef} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registerPreviewTarget.mockReturnValue(true);
});

describe('usePreviewRenderTargetRegistration', () => {
  it('updates transparency in place without re-registering the preview target', async () => {
    const { rerender, unmount } = render(<Harness showTransparencyGrid={false} />);

    await waitFor(() => {
      expect(mocks.registerPreviewTarget).toHaveBeenCalledTimes(1);
    });
    expect(mocks.registerPreviewTarget).toHaveBeenCalledWith(expect.objectContaining({
      id: 'preview-a',
      source,
      showTransparencyGrid: false,
    }));
    expect(mocks.setPreviewTargetTransparency).toHaveBeenLastCalledWith('preview-a', false);

    rerender(<Harness showTransparencyGrid />);

    await waitFor(() => {
      expect(mocks.setPreviewTargetTransparency).toHaveBeenLastCalledWith('preview-a', true);
    });
    expect(mocks.registerPreviewTarget).toHaveBeenCalledTimes(1);
    expect(mocks.unregisterPreviewTarget).not.toHaveBeenCalled();

    unmount();

    expect(mocks.unregisterPreviewTarget).toHaveBeenCalledWith('preview-a', source);
  });

  it('updates the local viewport override without re-registering the canvas target', async () => {
    const override = { width: 640, height: 480, cameraOverride: null } as const;
    const { rerender } = render(<Harness showTransparencyGrid={false} />);

    await waitFor(() => expect(mocks.registerPreviewTarget).toHaveBeenCalledTimes(1));
    expect(mocks.setPreviewTargetViewportOverride).toHaveBeenLastCalledWith('preview-a', null);

    rerender(<Harness showTransparencyGrid={false} viewportOverride={override} />);

    await waitFor(() => {
      expect(mocks.setPreviewTargetViewportOverride).toHaveBeenLastCalledWith('preview-a', override);
    });
    expect(mocks.setPreviewTargetViewportOverride).toHaveBeenCalledTimes(2);
    expect(mocks.registerPreviewTarget).toHaveBeenCalledTimes(1);
  });
});
