import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The toolbar reads the active repository session: the writer coordinator decides
// whether journal records are confirmed, pending, or failed.
const state = vi.hoisted(() => ({
  session: null as null | {
    location: { kind: 'fsa' | 'opfs' };
    opening: { writable: boolean };
    coordinator: { getStatus: () => { confirmedSequence: number; appliedSequence: number; queuedBytes: number; error: Error | null } };
  },
  status: { confirmedSequence: 0, appliedSequence: 0, queuedBytes: 0, error: null as Error | null },
  lifecycleError: null as string | null,
  scratch: false,
}));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({
  getActiveRepositorySession: () => state.session,
  getRepositoryLifecycleState: () => ({ error: state.lifecycleError }),
  isScratchRepository: () => state.scratch,
}));
import { ToolbarSaveStatus } from '../../src/components/common/toolbar/ToolbarSaveStatus';

function openSession(kind: 'fsa' | 'opfs' = 'fsa', writable = true): void {
  state.session = {
    location: { kind },
    opening: { writable },
    coordinator: { getStatus: () => state.status },
  };
}

describe('toolbar persistent save status', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.session = null;
    state.status = { confirmedSequence: 0, appliedSequence: 0, queuedBytes: 0, error: null };
    state.lifecycleError = null;
    state.scratch = false;
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const refresh = () => act(() => { vi.advanceTimersByTime(500); });
  const label = () => screen.getByRole('status').textContent;
  const button = () => screen.getByRole('button') as HTMLButtonElement;

  it('keeps failures visible, offers retry, and clears only on success', () => {
    openSession();
    const onSave = vi.fn();
    render(<ToolbarSaveStatus onSave={onSave} />);
    expect(label()).toBe('Saved');
    state.status = { ...state.status, appliedSequence: 1 };
    refresh();
    expect(label()).toBe('Saving…');
    state.status = { ...state.status, error: new Error('Folder access was revoked') };
    refresh();
    expect(label()).toBe('Save failed');
    expect(button().title).toBe('Folder access was revoked');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(label()).toBe('Save failed');
    expect(button().disabled).toBe(false);
    fireEvent.click(button());
    expect(onSave).toHaveBeenCalledOnce();
    state.status = { confirmedSequence: 1, appliedSequence: 1, queuedBytes: 0, error: null };
    refresh();
    expect(label()).toBe('Saved');
  });

  it('reports lifecycle failures even when the writer has no error', () => {
    openSession('opfs');
    state.lifecycleError = 'Workspace could not be written';
    render(<ToolbarSaveStatus onSave={vi.fn()} />);
    expect(label()).toBe('Save failed - Browser local');
    expect(button().title).toBe('Workspace could not be written');
  });

  it('disables retry during a write and preserves new edits made during it', () => {
    openSession();
    state.status = { confirmedSequence: 1, appliedSequence: 2, queuedBytes: 0, error: null };
    render(<ToolbarSaveStatus onSave={vi.fn()} />);
    expect(button().disabled).toBe(true);
    // A new edit lands while the first write is still pending.
    state.status = { ...state.status, appliedSequence: 3, queuedBytes: 128 };
    refresh();
    state.status = { ...state.status, confirmedSequence: 2 };
    refresh();
    expect(label()).toBe('Saving…');
    expect(button().disabled).toBe(true);
    state.status = { confirmedSequence: 3, appliedSequence: 3, queuedBytes: 0, error: null };
    refresh();
    expect(label()).toBe('Saved');
    expect(button().disabled).toBe(false);
  });

  it('does not present an uncreated project as saved', () => {
    render(<ToolbarSaveStatus onSave={vi.fn()} />);
    expect(label()).toBe('Browser recovery');
    expect(button().dataset.phase).toBe('unsaved');
    expect(button().title).toContain('Choose Save');
  });

  it('labels the browser scratch repository as recovery instead of a saved project', () => {
    openSession('opfs');
    state.scratch = true;
    render(<ToolbarSaveStatus onSave={vi.fn()} />);
    expect(label()).toBe('Browser recovery');
    expect(button().title).toContain('Choose Save to select a project folder');
  });

  it('disables saving for a read-only tab', () => {
    openSession('fsa', false);
    render(<ToolbarSaveStatus onSave={vi.fn()} />);
    expect(label()).toBe('Read-only');
    expect(button().disabled).toBe(true);
  });
});
