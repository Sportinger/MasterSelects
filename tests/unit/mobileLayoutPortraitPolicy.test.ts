import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mediaStoreMock = vi.hoisted(() => ({
  state: {
    activeCompositionId: 'comp-1',
    compositions: [] as Array<{ id: string; width: number; height: number }>,
  },
}));

const settingsStoreMock = vi.hoisted(() => ({
  state: {
    automaticMobileLayoutEnabled: true,
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

vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    vi.fn((selector: (state: typeof settingsStoreMock.state) => unknown) => selector(settingsStoreMock.state)),
    {
      getState: vi.fn(() => settingsStoreMock.state),
      setState: vi.fn((partial: Partial<typeof settingsStoreMock.state>) => {
        Object.assign(settingsStoreMock.state, partial);
      }),
      subscribe: vi.fn(),
    },
  ),
}));

import { useOverLayoutSync } from '../../src/components/dock/useOverLayoutSync';
import {
  FACTORY_MEDIUM_EDIT_LAYOUT_ID,
  FACTORY_MOBILE_LAYOUT_ID,
  FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
  FACTORY_COLOR_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  getFactoryDockLayouts,
  useDockStore,
} from '../../src/stores/dockStore';
import { DEFAULT_COMPOSITION } from '../../src/stores/mediaStore/constants';
import { useMediaStore } from '../../src/stores/mediaStore';

const originalMatchMedia = window.matchMedia;

function installMediaQueryMatches(initialMatches: Record<string, boolean>): {
  setMatches: (query: string, matches: boolean) => void;
} {
  const matchesByQuery = new Map(Object.entries(initialMatches));
  const listenersByQuery = new Map<string, Set<() => void>>();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string): MediaQueryList => {
      const listeners = listenersByQuery.get(query) ?? new Set<() => void>();
      listenersByQuery.set(query, listeners);
      return {
        get matches() {
          return matchesByQuery.get(query) ?? false;
        },
        media: query,
        onchange: null,
        addListener: (listener: () => void) => listeners.add(listener),
        removeListener: (listener: () => void) => listeners.delete(listener),
        addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
          if (typeof listener === 'function') listeners.add(listener as () => void);
        },
        removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
          if (typeof listener === 'function') listeners.delete(listener as () => void);
        },
        dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList;
    }),
  });

  return {
    setMatches(query, matches) {
      matchesByQuery.set(query, matches);
      listenersByQuery.get(query)?.forEach((listener) => listener());
    },
  };
}

describe('Mobile layout portrait policy', () => {
  beforeEach(() => {
    settingsStoreMock.state.automaticMobileLayoutEnabled = true;
    useDockStore.setState({
      savedLayouts: getFactoryDockLayouts(),
      activeSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      overLayoutBaseId: null,
      mediumLayoutOverride: null,
      mobileLayoutOverride: null,
    });
    useMediaStore.setState({
      activeCompositionId: DEFAULT_COMPOSITION.id,
      compositions: [{ ...DEFAULT_COMPOSITION }],
    });
  });

  afterEach(() => {
    settingsStoreMock.state.automaticMobileLayoutEnabled = true;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    useMediaStore.setState({
      activeCompositionId: DEFAULT_COMPOSITION.id,
      compositions: [{ ...DEFAULT_COMPOSITION }],
    });
  });

  it('lets the shared dock constraints control the timeline minimum height', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/dock/dock.css'), 'utf8');

    expect(css).not.toMatch(/\[data-split-id=['"]mobile-lower-split['"]\]/);
  });

  it('never gives the app shell a document-level horizontal scroll surface', () => {
    const shellCss = readFileSync(join(process.cwd(), 'src/styles/app-shell.css'), 'utf8');
    const baseCss = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8');

    expect(shellCss).not.toContain('min-width: 900px');
    expect(shellCss).toMatch(/\.app\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s);
    expect(baseCss).toMatch(/html, body, #root\s*\{[^}]*overflow:\s*hidden;/s);
  });

  it('switches H/V Mobile with the active composition orientation', async () => {
    useDockStore.getState().loadSavedLayout(FACTORY_MOBILE_LAYOUT_ID, {
      transitionDurationMs: 0,
    });
    useMediaStore.setState({
      compositions: [{ ...DEFAULT_COMPOSITION, width: 1080, height: 1920 }],
    });

    const { rerender, unmount } = renderHook(() => useOverLayoutSync());
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
    });

    act(() => {
      useMediaStore.setState({
        compositions: [{ ...DEFAULT_COMPOSITION, width: 1920, height: 1080 }],
      });
      rerender();
    });
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_MOBILE_LAYOUT_ID);
    });
    unmount();
  });

  it('keeps Mobile active while a coarse-pointer device is detected', async () => {
    installMediaQueryMatches({ '(pointer: coarse)': true });
    useMediaStore.setState({
      compositions: [{ ...DEFAULT_COMPOSITION, width: 1080, height: 1920 }],
    });

    const { unmount } = renderHook(() => useOverLayoutSync());
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
    });

    act(() => {
      useDockStore.getState().loadSavedLayout(FACTORY_VIDEO_EDIT_LAYOUT_ID, {
        transitionDurationMs: 0,
      });
    });
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
    });
    unmount();
  });

  it('keeps Mobile above a newly selected base layout while the viewport is compact', async () => {
    const mediaQueries = installMediaQueryMatches({
      '(pointer: coarse)': false,
      '(max-width: 900px)': false,
    });
    useMediaStore.setState({
      compositions: [{ ...DEFAULT_COMPOSITION, width: 1080, height: 1920 }],
    });

    const { unmount } = renderHook(() => useOverLayoutSync());
    expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);

    act(() => mediaQueries.setMatches('(max-width: 900px)', true));
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
    });

    act(() => {
      useDockStore.getState().loadSavedLayout(FACTORY_COLOR_LAYOUT_ID, {
        transitionDurationMs: 0,
      });
    });
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
      expect(useDockStore.getState().overLayoutBaseId).toBe(FACTORY_COLOR_LAYOUT_ID);
    });
    unmount();
  });

  it('lets the global toggle enter Mobile and restore the exact base layout', async () => {
    installMediaQueryMatches({
      '(pointer: coarse)': false,
      '(max-width: 900px)': false,
    });
    useMediaStore.setState({
      compositions: [{ ...DEFAULT_COMPOSITION, width: 1080, height: 1920 }],
    });
    useDockStore.getState().setSplitRatio('root-split', 0.57);
    const previousLayout = JSON.parse(JSON.stringify(useDockStore.getState().layout));

    const { unmount } = renderHook(() => useOverLayoutSync());
    act(() => useDockStore.getState().setMobileLayoutOverride(true));
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
      expect(useDockStore.getState().overLayoutBaseId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    });

    act(() => useDockStore.getState().setMobileLayoutOverride(false));
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
      expect(useDockStore.getState().layout).toEqual(previousLayout);
      expect(useDockStore.getState().overLayoutBaseId).toBeNull();
    });
    unmount();
  });

  it('can re-enter Mobile after restoring an exact unsaved desktop layout', async () => {
    installMediaQueryMatches({
      '(pointer: coarse)': false,
      '(max-width: 900px)': false,
    });
    useMediaStore.setState({
      compositions: [{ ...DEFAULT_COMPOSITION, width: 1080, height: 1920 }],
    });
    useDockStore.setState({ activeSavedLayoutId: null });

    const { unmount } = renderHook(() => useOverLayoutSync());
    act(() => useDockStore.getState().setMobileLayoutOverride(true));
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
    });

    act(() => useDockStore.getState().setMobileLayoutOverride(false));
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBeNull();
    });

    act(() => useDockStore.getState().setMobileLayoutOverride(true));
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
    });
    unmount();
  });

  it('lets the global toggle force desktop mode on a detected mobile device', async () => {
    installMediaQueryMatches({
      '(pointer: coarse)': true,
      '(max-width: 900px)': true,
    });
    useMediaStore.setState({
      compositions: [{ ...DEFAULT_COMPOSITION, width: 1080, height: 1920 }],
    });

    const { unmount } = renderHook(() => useOverLayoutSync());
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
    });

    act(() => useDockStore.getState().setMobileLayoutOverride(false));
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    });
    unmount();
  });

  it('restores the exact previous layout when the viewport becomes wide again', async () => {
    const mediaQueries = installMediaQueryMatches({
      '(pointer: coarse)': false,
      '(max-width: 900px)': false,
    });
    useMediaStore.setState({
      compositions: [{ ...DEFAULT_COMPOSITION, width: 1080, height: 1920 }],
    });
    useDockStore.getState().setSplitRatio('root-split', 0.57);
    const previousLayout = JSON.parse(JSON.stringify(useDockStore.getState().layout));
    const previousLayoutId = useDockStore.getState().activeSavedLayoutId;

    const { unmount } = renderHook(() => useOverLayoutSync());
    act(() => mediaQueries.setMatches('(max-width: 900px)', true));
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
    });

    act(() => mediaQueries.setMatches('(max-width: 900px)', false));
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(previousLayoutId);
      expect(useDockStore.getState().layout).toEqual(previousLayout);
    });
    unmount();
  });

  it('does not enter Mobile for compact desktop space when the automatic setting is disabled', () => {
    settingsStoreMock.state.automaticMobileLayoutEnabled = false;
    installMediaQueryMatches({
      '(pointer: coarse)': false,
      '(max-width: 900px)': true,
    });
    useMediaStore.setState({
      compositions: [{ ...DEFAULT_COMPOSITION, width: 1080, height: 1920 }],
    });

    const { unmount } = renderHook(() => useOverLayoutSync());
    expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    unmount();
  });

  it('still enters Mobile on a detected mobile device when the automatic setting is disabled', async () => {
    settingsStoreMock.state.automaticMobileLayoutEnabled = false;
    installMediaQueryMatches({
      '(pointer: coarse)': true,
      '(max-width: 900px)': false,
    });
    useMediaStore.setState({
      compositions: [{ ...DEFAULT_COMPOSITION, width: 1080, height: 1920 }],
    });

    const { unmount } = renderHook(() => useOverLayoutSync());
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
    });
    unmount();
  });

  it('does not replace the Chat start surface when layout syncing is disabled', () => {
    installMediaQueryMatches({
      '(pointer: coarse)': true,
      '(max-width: 900px)': true,
    });

    const { unmount } = renderHook(() => useOverLayoutSync(false));

    expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    unmount();
  });

  it('keeps Medium above a newly selected sub-layout and restores it exactly', async () => {
    settingsStoreMock.state.automaticMobileLayoutEnabled = false;
    installMediaQueryMatches({
      '(pointer: coarse)': false,
      '(max-width: 900px)': false,
    });

    const { unmount } = renderHook(() => useOverLayoutSync());
    act(() => useDockStore.getState().setMediumLayoutOverride(true));
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_MEDIUM_EDIT_LAYOUT_ID);
      expect(useDockStore.getState().overLayoutBaseId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    });

    act(() => {
      useDockStore.getState().loadSavedLayout(FACTORY_COLOR_LAYOUT_ID, {
        transitionDurationMs: 0,
      });
    });
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_MEDIUM_EDIT_LAYOUT_ID);
      expect(useDockStore.getState().overLayoutBaseId).toBe(FACTORY_COLOR_LAYOUT_ID);
    });

    act(() => useDockStore.getState().setMediumLayoutOverride(false));
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_COLOR_LAYOUT_ID);
      expect(useDockStore.getState().overLayoutBaseId).toBeNull();
    });
    unmount();
  });

  it('stacks Medium and Mobile without treating either as the base layout', async () => {
    settingsStoreMock.state.automaticMobileLayoutEnabled = false;
    installMediaQueryMatches({
      '(pointer: coarse)': false,
      '(max-width: 900px)': false,
    });

    const { unmount } = renderHook(() => useOverLayoutSync());
    act(() => useDockStore.getState().setMediumLayoutOverride(true));
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_MEDIUM_EDIT_LAYOUT_ID);
    });

    act(() => useDockStore.getState().setMobileLayoutOverride(true));
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_MOBILE_LAYOUT_ID);
      expect(useDockStore.getState().overLayoutBaseId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
      expect(useDockStore.getState().mediumLayoutOverride).toBe(true);
      expect(useDockStore.getState().mobileLayoutOverride).toBe(true);
    });

    act(() => useDockStore.getState().setMobileLayoutOverride(false));
    await waitFor(() => {
      expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_MEDIUM_EDIT_LAYOUT_ID);
      expect(useDockStore.getState().overLayoutBaseId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    });
    unmount();
  });
});
