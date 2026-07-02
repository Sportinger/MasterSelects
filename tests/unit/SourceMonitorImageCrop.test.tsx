import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SourceMonitorImageCrop } from '../../src/components/preview/sourceMonitor/SourceMonitorImageCrop';

function setImageReady(image: HTMLImageElement): void {
  Object.defineProperty(image, 'complete', { configurable: true, value: true });
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 800 });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 600 });
  Object.defineProperty(image, 'width', { configurable: true, value: 400 });
  Object.defineProperty(image, 'height', { configurable: true, value: 300 });
}

function leftPx(element: HTMLElement): number {
  return Number.parseFloat(element.style.left);
}

function topPx(element: HTMLElement): number {
  return Number.parseFloat(element.style.top);
}

function widthPx(element: HTMLElement): number {
  return Number.parseFloat(element.style.width);
}

function heightPx(element: HTMLElement): number {
  return Number.parseFloat(element.style.height);
}

function transformNumbers(element: HTMLElement): { panX: number; panY: number; scale: number } {
  const match = element.style.transform.match(/translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/);
  if (!match) throw new Error(`Unexpected transform: ${element.style.transform}`);
  return {
    panX: Number(match[1]),
    panY: Number(match[2]),
    scale: Number(match[3]),
  };
}

describe('SourceMonitorImageCrop', () => {
  it('zooms the crop preview with the mouse wheel', async () => {
    const { container } = render(
      <SourceMonitorImageCrop
        file={{ id: 'image-1', name: 'image.jpg', url: 'blob:image' } as never}
        busy={false}
        error={null}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const stage = container.querySelector('.source-monitor-image-crop') as HTMLElement;
    const image = container.querySelector('img') as HTMLImageElement;
    stage.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 500, height: 400 } as DOMRect));
    image.getBoundingClientRect = vi.fn(() => ({ left: 50, top: 50, width: 400, height: 300 } as DOMRect));
    setImageReady(image);
    fireEvent.load(image);

    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)');
    fireEvent.wheel(stage, { clientX: 250, clientY: 200, deltaY: -250 });

    await waitFor(() => expect(transformNumbers(image).scale).toBeCloseTo(1.2840, 4));
    fireEvent.wheel(stage, { clientX: 250, clientY: 200, deltaY: -5000 });
    await waitFor(() => expect(transformNumbers(image).scale).toBe(128));
  });

  it('pans the zoomed crop preview with the middle mouse button', async () => {
    const { container } = render(
      <SourceMonitorImageCrop
        file={{ id: 'image-1', name: 'image.jpg', url: 'blob:image' } as never}
        busy={false}
        error={null}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const stage = container.querySelector('.source-monitor-image-crop') as HTMLElement;
    const image = container.querySelector('img') as HTMLImageElement;
    stage.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 500, height: 400 } as DOMRect));
    image.getBoundingClientRect = vi.fn(() => ({ left: 50, top: 50, width: 400, height: 300 } as DOMRect));
    setImageReady(image);
    fireEvent.load(image);

    const cropBox = await waitFor(() => {
      const box = container.querySelector('.source-monitor-image-crop-box') as HTMLElement | null;
      expect(box).toBeTruthy();
      return box!;
    });
    fireEvent.pointerDown(stage, { button: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(document, { clientX: 130, clientY: 85 });
    fireEvent.pointerUp(document);

    await waitFor(() => {
      expect(image.style.transform).toBe('translate(30px, -15px) scale(1)');
      expect(leftPx(cropBox)).toBe(120);
    });

    fireEvent.wheel(stage, { clientX: 250, clientY: 200, deltaY: 1000 });
    await waitFor(() => expect(image.style.transform).toBe('translate(0px, 0px) scale(1)'));
  });

  it('applies fixed aspect ratio presets to the crop box', async () => {
    const { container, getByText } = render(
      <SourceMonitorImageCrop
        file={{ id: 'image-1', name: 'image.jpg', url: 'blob:image' } as never}
        busy={false}
        error={null}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const stage = container.querySelector('.source-monitor-image-crop') as HTMLElement;
    const image = container.querySelector('img') as HTMLImageElement;
    stage.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 500, height: 400 } as DOMRect));
    image.getBoundingClientRect = vi.fn(() => ({ left: 50, top: 50, width: 400, height: 300 } as DOMRect));
    setImageReady(image);
    fireEvent.load(image);

    const cropBox = await waitFor(() => {
      const box = container.querySelector('.source-monitor-image-crop-box') as HTMLElement | null;
      expect(box).toBeTruthy();
      return box!;
    });
    fireEvent.click(getByText('1:1'));

    await waitFor(() => expect(widthPx(cropBox)).toBe(heightPx(cropBox)));
  });

  it('keeps the opposite corner fixed when resizing a locked-aspect crop', async () => {
    const { container, getByText } = render(
      <SourceMonitorImageCrop
        file={{ id: 'image-1', name: 'image.jpg', url: 'blob:image' } as never}
        busy={false}
        error={null}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const stage = container.querySelector('.source-monitor-image-crop') as HTMLElement;
    const image = container.querySelector('img') as HTMLImageElement;
    stage.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 500, height: 400 } as DOMRect));
    image.getBoundingClientRect = vi.fn(() => ({ left: 50, top: 50, width: 400, height: 300 } as DOMRect));
    setImageReady(image);
    fireEvent.load(image);

    const cropBox = await waitFor(() => {
      const box = container.querySelector('.source-monitor-image-crop-box') as HTMLElement | null;
      expect(box).toBeTruthy();
      return box!;
    });
    fireEvent.click(getByText('1:1'));

    await waitFor(() => expect(widthPx(cropBox)).toBe(heightPx(cropBox)));
    const initialRight = leftPx(cropBox) + widthPx(cropBox);
    const initialBottom = topPx(cropBox) + heightPx(cropBox);
    const nwHandle = cropBox.querySelector('.source-monitor-image-crop-handle.nw') as HTMLElement;

    fireEvent.pointerDown(nwHandle, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { clientX: 40, clientY: 0 });
    fireEvent.pointerUp(document);

    await waitFor(() => {
      expect(widthPx(cropBox)).toBe(heightPx(cropBox));
      expect(leftPx(cropBox) + widthPx(cropBox)).toBeCloseTo(initialRight);
      expect(topPx(cropBox) + heightPx(cropBox)).toBeCloseTo(initialBottom);
    });
  });

  it('keeps crop dragging live after the first pointerup', async () => {
    const { container } = render(
      <SourceMonitorImageCrop
        file={{ id: 'image-1', name: 'image.jpg', url: 'blob:image' } as never}
        busy={false}
        error={null}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const stage = container.querySelector('.source-monitor-image-crop') as HTMLElement;
    const image = container.querySelector('img') as HTMLImageElement;
    stage.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 500, height: 400 } as DOMRect));
    image.getBoundingClientRect = vi.fn(() => ({ left: 50, top: 50, width: 400, height: 300 } as DOMRect));
    setImageReady(image);
    fireEvent.load(image);

    const cropBox = await waitFor(() => {
      const box = container.querySelector('.source-monitor-image-crop-box') as HTMLElement | null;
      expect(box).toBeTruthy();
      return box!;
    });

    fireEvent.pointerDown(cropBox, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(document, { clientX: 120, clientY: 100 });
    fireEvent.pointerUp(document);

    await waitFor(() => expect(leftPx(cropBox)).toBe(110));

    fireEvent.pointerDown(cropBox, { clientX: 120, clientY: 100 });
    fireEvent.pointerMove(document, { clientX: 140, clientY: 100 });
    fireEvent.pointerUp(document);

    await waitFor(() => expect(leftPx(cropBox)).toBe(130));
  });
});
