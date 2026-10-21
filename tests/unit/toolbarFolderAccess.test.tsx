import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resume: vi.fn(async () => true),
  stopWatch: vi.fn(),
  session: { location: { kind: 'fsa' as const }, opening: { writable: true },
    coordinator: { getStatus: () => ({ confirmedSequence: 1, appliedSequence: 3, queuedBytes: 10, error: new Error('The request is not allowed') }) } },
}));
vi.mock('../../src/services/project/folderAccess/folderAccessResume', () => ({ resumeFolderAccess: mocks.resume }));
vi.mock('../../src/services/project/folderAccess/folderAccessWatch', () => ({ startFolderAccessWatch: () => mocks.stopWatch }));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({
  getActiveRepositorySession: () => mocks.session,
  getRepositoryLifecycleState: () => ({ error: null }),
  isScratchRepository: () => false,
}));

import { ToolbarFolderAccess } from '../../src/components/common/toolbar/ToolbarFolderAccess';
import { ToolbarSaveStatus } from '../../src/components/common/toolbar/ToolbarSaveStatus';
import { clearProjectFolderAccessPause, noteFolderAccessFailure, resetFolderAccessPause } from '../../src/services/project/folderAccess/folderAccessPause';
import { RepositoryError } from '../../src/services/project/repository/contracts';

describe('folder access paused toolbar state', () => {
  beforeEach(() => { mocks.resume.mockClear(); mocks.stopWatch.mockClear(); });
  afterEach(() => { cleanup(); resetFolderAccessPause(); });

  it('shows one clear Re-allow action that resumes from the click and disappears afterwards', () => {
    const { unmount } = render(<div className="toolbar-right"><ToolbarFolderAccess /></div>);
    expect(screen.queryByRole('button', { name: 'Re-allow' })).toBeNull();
    act(() => { noteFolderAccessFailure(new RepositoryError('access', 'The request is not allowed')); });
    expect(screen.getByRole('status').textContent).toBe('Folder access was paused by the browser');
    const button = screen.getByRole('button', { name: 'Re-allow' });
    expect(button.title).toContain('Your changes are kept in this tab');
    fireEvent.click(button);
    expect(mocks.resume).toHaveBeenCalledOnce();
    act(() => { clearProjectFolderAccessPause(); });
    expect(screen.queryByRole('button', { name: 'Re-allow' })).toBeNull();
    unmount();
    expect(mocks.stopWatch).toHaveBeenCalledOnce();
  });

  it('keeps keyboard focus in the toolbar when the focused Re-allow button goes away', () => {
    render(<div className="toolbar-right"><button className="toolbar-save-status" type="button">Saved</button><ToolbarFolderAccess /></div>);
    act(() => { noteFolderAccessFailure(new RepositoryError('access', 'x')); });
    const button = screen.getByRole('button', { name: 'Re-allow' });
    button.focus();
    act(() => { clearProjectFolderAccessPause(); });
    expect(document.activeElement?.className).toBe('toolbar-save-status');
  });

  it('drops pointer focus after a mouse click (no stuck focus ring)', () => {
    render(<ToolbarFolderAccess />);
    act(() => { noteFolderAccessFailure(new RepositoryError('access', 'x')); });
    const button = screen.getByRole('button', { name: 'Re-allow' });
    button.focus();
    fireEvent.pointerUp(button);
    expect(document.activeElement).not.toBe(button);
  });

  it('labels the save status as paused, not failed, and re-allows from it', () => {
    vi.useFakeTimers();
    try {
      act(() => { noteFolderAccessFailure(new RepositoryError('access', 'x')); });
      const onSave = vi.fn();
      render(<ToolbarSaveStatus onSave={onSave} onExportArchive={vi.fn()} />);
      expect(screen.getByRole('status').textContent).toBe('Access paused');
      fireEvent.click(screen.getByRole('button'));
      expect(mocks.resume).toHaveBeenCalledOnce();
      expect(onSave).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
