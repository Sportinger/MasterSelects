import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  ColorClipContextMenu,
  type ColorClipContextMenuProps,
} from '../../src/components/panels/color-workspace/ColorClipContextMenu';
import type { ColorGradeVersion } from '../../src/types/colorCorrection';

const versions: ColorGradeVersion[] = [
  { id: 'version-a', name: 'A', nodes: [], edges: [], outputNodeId: 'output-a' },
  { id: 'version-b', name: 'B', nodes: [], edges: [], outputNodeId: 'output-b' },
];

function renderMenu(overrides: Partial<ColorClipContextMenuProps> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onSelectVersion: vi.fn(),
    onCreateVersion: vi.fn(),
    onKeepOnlyActiveVersion: vi.fn(),
    onSetGradeMode: vi.fn(),
    onCopyRemoteToLocal: vi.fn(),
    onCopyLocalToRemote: vi.fn(),
    onAddMarker: vi.fn(),
    onSetLabelColor: vi.fn(),
    onOpenNodeGraph: vi.fn(),
    onViewClipDetails: vi.fn(),
    onFindInMedia: vi.fn(),
    onManageProxy: vi.fn(),
    onUpdateAllThumbnails: vi.fn(),
  };
  render(
    <ColorClipContextMenu
      activeVersionId="version-a"
      canFindMedia
      canManageProxy
      canSetLabelColor
      canUseRemoteGrade
      canUpdateThumbnails
      clipName="Interview A"
      currentLabelColor="red"
      gradeMode="local"
      hasRemoteGrade
      markerOptions={[
        { label: 'Default' },
        { label: 'Blue', color: '#4a90e2' },
      ]}
      position={{ x: 120, y: 90, clipId: 'clip-1' }}
      proxyProgress={42}
      proxyStatus="generating"
      thumbnailsUpdating={false}
      versionScopeLabel="Local Versions"
      versions={versions}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('ColorClipContextMenu', () => {
  it('renders the existing Color clip actions and dispatches a version change', () => {
    const handlers = renderMenu();

    expect(screen.getByRole('menu', { name: 'Color clip actions for Interview A' })).toBeInTheDocument();
    expect(screen.getByText('Local Versions')).toBeInTheDocument();
    expect(screen.getByText('Display Node Graph')).toBeInTheDocument();
    expect(screen.getByText('View Clip Details')).toBeInTheDocument();
    expect(screen.getByText('Find in Media')).toBeInTheDocument();
    expect(screen.getByText('Stop Proxy Generation (42%)')).toBeInTheDocument();
    expect(screen.getByText('Update All Thumbnails')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'B' }));

    expect(handlers.onSelectVersion).toHaveBeenCalledWith('version-b');
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it('dispatches marker and label colors with their exact values', () => {
    const handlers = renderMenu();

    fireEvent.click(within(screen.getByRole('menu', { name: 'Markers' })).getByRole('menuitem', { name: 'Blue' }));
    expect(handlers.onAddMarker).toHaveBeenCalledWith('#4a90e2');

    fireEvent.click(screen.getByRole('menuitem', { name: 'Red, selected' }));
    expect(handlers.onSetLabelColor).toHaveBeenCalledWith('red');
  });

  it('shows the active grade owner and dispatches mode changes', () => {
    const handlers = renderMenu({
      gradeMode: 'remote',
      versionScopeLabel: 'Remote Versions',
    });

    expect(screen.getByText('Remote Versions')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Use Remote Grades' })).toHaveTextContent('\u2713');

    fireEvent.click(screen.getByRole('menuitem', { name: 'Use Local Grades' }));
    expect(handlers.onSetGradeMode).toHaveBeenCalledWith('local');
  });

  it('disables actions whose backing capability is unavailable', () => {
    renderMenu({
      canFindMedia: false,
      canManageProxy: false,
      canSetLabelColor: false,
      canUseRemoteGrade: false,
      canUpdateThumbnails: false,
      hasRemoteGrade: false,
      versions: [versions[0]!],
    });

    expect(screen.getByRole('menuitem', { name: 'Delete Unused Versions' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Find in Media' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Stop Proxy Generation (42%)' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Update All Thumbnails' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Red, selected' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Copy Remote Grades to Local' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Use Remote Grades' })).toBeDisabled();
  });
});
