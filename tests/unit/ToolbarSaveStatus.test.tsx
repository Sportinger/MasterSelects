import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ open: true, dirty: false, handle: {} }));
vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    isProjectOpen: () => state.open,
    hasUnsavedChanges: () => state.dirty,
    getProjectHandle: () => state.handle,
    getProjectPath: () => null,
  },
}));
import { ToolbarSaveStatus } from '../../src/components/common/toolbar/ToolbarSaveStatus';
import { projectSaveStatus, trackProjectSave } from '../../src/services/project/projectSaveStatus';

describe('toolbar persistent save status', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.open = true;
    state.dirty = false;
    projectSaveStatus.reset(state.handle);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const refresh = () => act(() => { vi.advanceTimersByTime(500); });

  it('keeps failures visible, offers retry, and clears only on success', async () => {
    const onSave = vi.fn();
    render(<ToolbarSaveStatus onSave={onSave} />);
    expect(screen.getByRole('status').textContent).toBe('No unsaved changes');
    state.dirty = true;
    refresh();
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes');
    await trackProjectSave(state.handle, async () => false);
    refresh();
    expect(screen.getByRole('status').textContent).toBe('Save failed');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole('status').textContent).toBe('Save failed');
    fireEvent.click(screen.getByRole('button'));
    expect(onSave).toHaveBeenCalledOnce();
    await trackProjectSave(state.handle, async () => true);
    state.dirty = false;
    refresh();
    expect(screen.getByRole('status').textContent).toMatch(/^Saved /);
  });

  it('disables retry during a write and preserves new edits made during it', async () => {
    render(<ToolbarSaveStatus onSave={vi.fn()} />);
    let finish!: (result: boolean) => void;
    const pending = trackProjectSave(state.handle, () => new Promise(resolve => { finish = resolve; }));
    refresh();
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    state.dirty = true;
    finish(true);
    await pending;
    refresh();
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes');
  });

  it('does not present an uncreated project as saved', () => {
    state.open = false;
    render(<ToolbarSaveStatus onSave={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('Not saved to a project');
  });
});
