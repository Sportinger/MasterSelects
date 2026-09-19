import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mediaStoreMock = vi.hoisted(() => ({
  state: {
    activeCompositionId: 'comp-1',
    compositions: [] as Array<{ id: string; width: number; height: number }>,
  },
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: Object.assign(
    vi.fn((selector: (state: typeof mediaStoreMock.state) => unknown) => selector(mediaStoreMock.state)),
    {
      getState: vi.fn(() => mediaStoreMock.state),
      setState: vi.fn((partial: Partial<typeof mediaStoreMock.state>) => {
        Object.assign(mediaStoreMock.state, partial);
      }),
      subscribe: vi.fn(),
    },
  ),
}));

import { useMobilePreviewLayoutFit } from '../../src/components/dock/useMobilePreviewLayoutFit';
import {
  FACTORY_MOBILE_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  getFactoryDockLayouts,
  useDockStore,
} from '../../src/stores/dockStore';
import { DEFAULT_COMPOSITION } from '../../src/stores/mediaStore/constants';
import { useMediaStore } from '../../src/stores/mediaStore';
import { findNodeById } from '../../src/utils/dockLayout';

function setClientSize(element: HTMLElement, width: number, height: number): void {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: height },
    clientWidth: { configurable: true, value: width },
  });
}

function createLandscapeMobileDockFixture(): HTMLDivElement {
  const container = document.createElement('div');
  const rootSplit = document.createElement('div');
  const previewChild = document.createElement('div');
  const remainingChild = document.createElement('div');
  const divider = document.createElement('div');
  const previewPane = document.createElement('div');
  const previewContainer = document.createElement('div');

  rootSplit.dataset.splitId = 'mobile-root-split';
  previewChild.className = 'dock-split-child';
  previewChild.style.minHeight = '200px';
  remainingChild.className = 'dock-split-child';
  remainingChild.style.minHeight = '304px';
  divider.className = 'dock-resize-handle';
  previewPane.dataset.groupId = 'preview-group';
  previewContainer.className = 'preview-container';

  setClientSize(rootSplit, 768, 1_000);
  setClientSize(divider, 4, 4);
  setClientSize(previewPane, 768, 520);
  setClientSize(previewContainer, 768, 440);

  previewPane.append(previewContainer);
  previewChild.append(previewPane);
  rootSplit.append(previewChild, divider, remainingChild);
  container.append(rootSplit);
  return container;
}

function readLandscapeRootRatio(): number {
  const node = findNodeById(useDockStore.getState().layout.root, 'mobile-root-split');
  if (node?.kind !== 'split') throw new Error('Mobile root split is missing');
  return node.ratio;
}

function readLandscapeLowerRatio(): number {
  const node = findNodeById(useDockStore.getState().layout.root, 'mobile-lower-split');
  if (node?.kind !== 'split') throw new Error('Mobile lower split is missing');
  return node.ratio;
}

describe('useMobilePreviewLayoutFit', () => {
  let frameCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    frameCallbacks = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    useDockStore.setState({
      activeSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      mediumLayoutOverride: null,
      mobileLayoutOverride: null,
      savedLayouts: getFactoryDockLayouts(),
    });
    useDockStore.getState().loadSavedLayout(FACTORY_MOBILE_LAYOUT_ID, {
      transitionDurationMs: 0,
    });
    useMediaStore.setState({
      activeCompositionId: DEFAULT_COMPOSITION.id,
      compositions: [{ ...DEFAULT_COMPOSITION, width: 1920, height: 1080 }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useDockStore.setState({
      activeSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      mediumLayoutOverride: null,
      mobileLayoutOverride: null,
      savedLayouts: getFactoryDockLayouts(),
    });
    useDockStore.getState().loadSavedLayout(FACTORY_VIDEO_EDIT_LAYOUT_ID, {
      transitionDurationMs: 0,
    });
  });

  const flushFrames = () => {
    act(() => {
      const pending = frameCallbacks.splice(0);
      pending.forEach((callback) => callback(0));
    });
  };

  it('fits on entry, preserves user resizing, and fits again after re-entry', () => {
    const container = createLandscapeMobileDockFixture();
    const containerRef = { current: container };
    const { rerender, unmount } = renderHook(() => useMobilePreviewLayoutFit({ containerRef }));

    flushFrames();
    expect(readLandscapeRootRatio()).toBeCloseTo(0.514);

    act(() => useDockStore.getState().setSplitRatio('mobile-root-split', 0.7));
    window.dispatchEvent(new Event('resize'));
    flushFrames();
    expect(readLandscapeRootRatio()).toBe(0.7);

    act(() => {
      useMediaStore.setState({
        compositions: [{ ...DEFAULT_COMPOSITION, width: 1280, height: 720 }],
      });
      rerender();
    });
    flushFrames();
    expect(readLandscapeRootRatio()).toBe(0.7);

    act(() => {
      useDockStore.getState().loadSavedLayout(FACTORY_VIDEO_EDIT_LAYOUT_ID, {
        transitionDurationMs: 0,
      });
    });
    act(() => {
      useDockStore.getState().loadSavedLayout(FACTORY_MOBILE_LAYOUT_ID, {
        transitionDurationMs: 0,
      });
    });
    flushFrames();
    expect(readLandscapeRootRatio()).toBeCloseTo(0.514);

    unmount();
  });

  it('reserves visible timeline space when Medium and Mobile are stacked', () => {
    const container = createLandscapeMobileDockFixture();
    const containerRef = { current: container };
    const { rerender, unmount } = renderHook(() => useMobilePreviewLayoutFit({ containerRef }));

    flushFrames();
    expect(readLandscapeRootRatio()).toBeCloseTo(0.514);

    act(() => {
      useDockStore.setState({ mediumLayoutOverride: true });
      rerender();
    });
    flushFrames();

    expect(readLandscapeRootRatio()).toBe(0.42);
    expect(readLandscapeLowerRatio()).toBe(0.45);
    unmount();
  });
});
