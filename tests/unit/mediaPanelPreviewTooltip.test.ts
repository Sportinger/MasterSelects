import { act, renderHook } from '@testing-library/react';
import { isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MediaFile, ProjectItem } from '../../src/stores/mediaStore';
import {
  getMediaPanelPreviewSource,
  getMediaPanelPreviewTooltipPosition,
  useMediaPanelPreviewTooltip,
} from '../../src/components/panels/media/panel/useMediaPanelPreviewTooltip';

function mediaFile(patch: Partial<MediaFile>): MediaFile {
  return {
    id: patch.id ?? 'media',
    name: patch.name ?? 'media.png',
    type: patch.type ?? 'image',
    parentId: null,
    createdAt: 1,
    url: patch.url ?? 'blob:source',
    ...patch,
  };
}

function tooltipClassName(node: ReactNode): string | null {
  if (!isValidElement(node)) {
    return null;
  }

  return (node.props as { className?: string }).className ?? null;
}

function tooltipImageSrc(node: ReactNode): string | null {
  if (!isValidElement(node)) {
    return null;
  }

  const child = (node.props as { children?: ReactNode }).children;
  return isValidElement(child) ? (child.props as { src?: string }).src ?? null : null;
}

function tooltipMedia(node: ReactNode): ReactNode {
  return isValidElement(node) ? (node.props as { children?: ReactNode }).children : null;
}

describe('media panel preview tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses playable video sources and falls back to image thumbnails', () => {
    expect(getMediaPanelPreviewSource(mediaFile({
      type: 'video',
      thumbnailUrl: 'blob:thumb',
      url: 'blob:video',
      proxyVideoUrl: 'blob:proxy',
    }))).toBe('blob:proxy');

    expect(getMediaPanelPreviewSource(mediaFile({
      type: 'image',
      url: 'blob:image',
    }))).toBe('blob:image');

    expect(getMediaPanelPreviewSource(mediaFile({
      type: 'video',
      url: 'blob:video',
    }))).toBe('blob:video');
  });

  it('keeps the preview inside the viewport near edges', () => {
    expect(getMediaPanelPreviewTooltipPosition(790, 590, 800, 600)).toEqual({
      left: 532,
      top: 402,
    });
  });

  it('keeps an open preview alive while scanning across items', () => {
    const first = mediaFile({ id: 'first', name: 'first.mp4', type: 'video', thumbnailUrl: 'blob:first' });
    const second = mediaFile({ id: 'second', name: 'second.png', type: 'image', url: 'blob:second' });
    const itemsById = new Map<string, ProjectItem>([
      [first.id, first],
      [second.id, second],
    ]);
    const host = document.createElement('div');
    const firstNode = document.createElement('button');
    const secondNode = document.createElement('button');
    firstNode.dataset.itemId = first.id;
    secondNode.dataset.itemId = second.id;
    host.append(firstNode, secondNode);
    const { result } = renderHook(() => useMediaPanelPreviewTooltip({ itemsById }));
    const move = (target: Element) => {
      act(() => result.current.handleMouseMove({
        buttons: 0,
        clientX: 20,
        clientY: 30,
        target,
      } as Parameters<typeof result.current.handleMouseMove>[0]));
    };

    move(firstNode);
    expect(result.current.element).toBeNull();

    act(() => vi.advanceTimersByTime(400));
    const preview = tooltipMedia(result.current.element);
    expect(isValidElement(preview) && preview.type).toBe('video');
    expect(isValidElement(preview) && preview.props).toMatchObject({ autoPlay: true, loop: true, muted: true });
    expect(tooltipClassName(result.current.element)).toContain('visible');

    move(host);
    move(secondNode);
    expect(tooltipImageSrc(result.current.element)).toBe('blob:second');
    expect(tooltipClassName(result.current.element)).toContain('visible');
  });
});
