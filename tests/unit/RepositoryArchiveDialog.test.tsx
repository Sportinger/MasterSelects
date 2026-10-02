import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryArchiveDialog } from '../../src/components/common/toolbar/RepositoryArchiveDialog';
const state = vi.hoisted(() => ({ session: { opening: { writable: true }, coordinator: { getProjection: () => ({ revisionId: 'current' }) },
  storage: { getRevision: async () => ({ reference: { hash: 'sha256:fixture', segmentId: 'fixture', offset: 0, length: 1 } }) } },
  current: null as unknown, pick: vi.fn(), export: vi.fn(), flush: vi.fn() }));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({
  getActiveRepositorySession: () => state.current, flushEditorRepository: () => state.flush(),
}));
vi.mock('../../src/services/project/repository/lifecycle/exportProjectArchive', () => ({
  pickArchiveOutput: (...args: unknown[]) => state.pick(...args), exportCurrentProjectArchive: (...args: unknown[]) => state.export(...args),
}));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => ({ info: vi.fn(), error: vi.fn() }) } }));
beforeEach(() => { state.current = state.session; state.pick.mockReset(); state.export.mockReset(); state.flush.mockResolvedValue(undefined); });
afterEach(cleanup);
describe('archive export lifetime', () => {
  it('continues an authorized destination write if the toolbar unmounts while its picker is pending', async () => {
    let finishPicker!: (output: object) => void;
    state.pick.mockImplementation(() => new Promise(resolve => { finishPicker = resolve; }));
    const output = { write: vi.fn(), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
    state.export.mockImplementation(async (_selection, suppliedOutput, signal, session) => {
      expect(signal.aborted).toBe(false); expect(session).toBe(state.session); await suppliedOutput.close();
    });
    const close = vi.fn(); const view = render(<RepositoryArchiveDialog onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export .msproj' }));
    view.unmount();
    await act(async () => { finishPicker(output); });
    expect(state.export).toHaveBeenCalledOnce(); expect(output.close).toHaveBeenCalledOnce();
    expect(output.abort).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  });
  it('refuses to combine a selection with another project activated while the picker is pending', async () => {
    let finishPicker!: (output: object) => void;
    state.pick.mockImplementation(() => new Promise(resolve => { finishPicker = resolve; }));
    const output = { abort: vi.fn(async () => {}) };
    render(<RepositoryArchiveDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export .msproj' }));
    state.current = { ...state.session };
    await act(async () => { finishPicker(output); });
    expect(state.export).not.toHaveBeenCalled(); expect(output.abort).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent('Project changed');
  });
});
