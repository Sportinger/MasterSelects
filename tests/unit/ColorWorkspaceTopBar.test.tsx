import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ColorWorkspaceTopBar } from '../../src/components/panels/color-workspace/ColorWorkspaceTopBar';
import {
  isColorWorkspacePanelVisible,
  toggleColorWorkspacePanel,
} from '../../src/components/panels/color-workspace/colorWorkspacePanelLayout';
import {
  FACTORY_COLOR_LAYOUT_ID,
  getFactoryDockLayouts,
  useDockStore,
} from '../../src/stores/dockStore';

const originalDockState = useDockStore.getState();

function getColorLayout() {
  const savedLayout = getFactoryDockLayouts().find(layout => layout.id === FACTORY_COLOR_LAYOUT_ID);
  if (!savedLayout) throw new Error('Color factory layout is missing');
  return structuredClone(savedLayout.layout);
}

function getColorRootRatio(layout = useDockStore.getState().layout): number {
  const root = layout.root;
  if (root.kind !== 'split' || root.id !== 'color-root-split') {
    throw new Error('Color root split is missing');
  }
  return root.ratio;
}

describe('ColorWorkspaceTopBar', () => {
  beforeEach(() => {
    act(() => {
      useDockStore.setState({
        ...originalDockState,
        activeSavedLayoutId: FACTORY_COLOR_LAYOUT_ID,
        layout: getColorLayout(),
      });
    });
  });

  afterEach(() => {
    act(() => {
      useDockStore.setState(originalDockState, true);
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the project title and the requested controls only', () => {
    render(<ColorWorkspaceTopBar />);

    expect(screen.getByText('Untitled Project')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'LUTs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /gallery/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /lightbox/i })).not.toBeInTheDocument();
  });

  it.each([
    ['Clips', 'color-clips'],
    ['Mini Timeline', 'color-timeline'],
    ['Node Graph', 'color-nodes'],
  ] as const)('toggles %s off and restores it at the Color workspace', (label, panelType) => {
    render(<ColorWorkspaceTopBar />);
    const button = screen.getByRole('button', { name: label });

    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(isColorWorkspacePanelVisible(useDockStore.getState().layout, panelType)).toBe(false);

    fireEvent.click(button);
    expect(isColorWorkspacePanelVisible(useDockStore.getState().layout, panelType)).toBe(true);
  });

  it.each([
    ['Clips', 'color-clips', 0.136],
    ['Mini Timeline', 'color-timeline', 0.082],
  ] as const)('grows the workspace upward when %s is toggled', (_label, panelType, ratioDelta) => {
    const initialLayout = getColorLayout();
    const initialRatio = getColorRootRatio(initialLayout);
    const hiddenLayout = toggleColorWorkspacePanel(initialLayout, panelType, {
      rootHeight: 1000,
      videoTrackCount: 2,
    });

    expect(getColorRootRatio(hiddenLayout)).toBeCloseTo(initialRatio + ratioDelta, 6);

    const restoredLayout = toggleColorWorkspacePanel(hiddenLayout, panelType, {
      rootHeight: 1000,
      videoTrackCount: 2,
    });
    expect(getColorRootRatio(restoredLayout)).toBeCloseTo(initialRatio, 6);
  });

  it('passes the rendered Color root height into compact-panel toggles', () => {
    render(
      <>
        <div data-split-id="color-root-split" />
        <ColorWorkspaceTopBar />
      </>,
    );
    const rootElement = document.querySelector<HTMLElement>('[data-split-id="color-root-split"]');
    vi.spyOn(rootElement!, 'getBoundingClientRect').mockReturnValue({
      height: 1000,
    } as DOMRect);

    fireEvent.click(screen.getByRole('button', { name: 'Mini Timeline' }));

    expect(getColorRootRatio()).toBeCloseTo(0.582, 6);
  });

  it('keeps Media, Nodes, and Properties beside Preview with at most three top-row panels', () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 1;
    });
    const propertiesTabListener = vi.fn();
    window.addEventListener('openPropertiesTab', propertiesTabListener);
    render(<ColorWorkspaceTopBar />);

    expect(useDockStore.getState().layout.root.id).toBe('color-root-split');
    fireEvent.click(screen.getByRole('button', { name: 'Media' }));
    expect(isColorWorkspacePanelVisible(useDockStore.getState().layout, 'media')).toBe(true);
    expect(isColorWorkspacePanelVisible(useDockStore.getState().layout, 'color-nodes')).toBe(true);
    expect(useDockStore.getState().layout.root.id).toBe('color-root-split');

    fireEvent.click(screen.getByRole('button', { name: 'Properties: Effects' }));
    act(() => vi.runAllTimers());
    expect(isColorWorkspacePanelVisible(useDockStore.getState().layout, 'clip-properties')).toBe(true);
    expect(isColorWorkspacePanelVisible(useDockStore.getState().layout, 'color-nodes')).toBe(true);
    expect(isColorWorkspacePanelVisible(useDockStore.getState().layout, 'media')).toBe(false);
    expect(useDockStore.getState().layout.root.id).toBe('color-root-split');
    expect(propertiesTabListener).toHaveBeenCalledTimes(1);
    expect((propertiesTabListener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ tab: 'effects' });

    window.removeEventListener('openPropertiesTab', propertiesTabListener);
  });
});
