import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoordinatorStatus } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import type { HistoryPage } from '../../src/services/project/repository/history/RepositoryHistoryReader';
import { HistoryPanel } from '../../src/components/panels/HistoryPanel';

const state = vi.hoisted(() => {
  const status: CoordinatorStatus = { revisionId: 'revision-0', generation: 1, appliedSequence: 1, confirmedSequence: 1,
    queuedBytes: 0, oldestPendingAt: null, navigation: 'idle', error: null };
  const holder = { status, listener: null as ((value: CoordinatorStatus) => void) | null, query: vi.fn(),
    session: {} as object };
  holder.session = { opening: { writable: true }, coordinator: { getStatus: () => holder.status,
    subscribe(listener: (value: CoordinatorStatus) => void) { holder.listener = listener; return () => { holder.listener = null; }; } },
    client: { request: async () => ({ phase: 'ready', scannedRecords: 0, writable: true }) } };
  return holder;
});
vi.mock('../../src/services/project/repository/transaction/editorRepositorySession', () => ({
  getEditorRepositorySession: () => state.session, subscribeEditorRepositorySession: () => () => {},
}));
vi.mock('../../src/services/project/repository/history/RepositoryHistoryReader', () => ({
  HISTORY_PAGE_SIZE: 64,
  RepositoryHistoryReader: class { clear() {} query(...args: unknown[]) { return state.query(...args); } },
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('retains displayed revisions, selection and scroll while a save refresh is pending', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const page: HistoryPage = { offset: 0, totalCount: 20, nextCursor: null,
    items: Array.from({ length: 20 }, (_, index) => ({ id: `revision-${index}`, revisionId: `revision-${index}`,
      parentRevisionId: null, label: `Edit ${index}`, source: 'user', createdAt: 0 })) };
  state.query.mockResolvedValue(page);
  render(<HistoryPanel />);
  await screen.findByText('Edit 1');
  const list = screen.getByRole('listbox', { name: 'Project history' });
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  list.scrollTop = 84; fireEvent.scroll(list);
  const beforeSelection = list.getAttribute('aria-activedescendant');
  let finishRefresh!: (value: HistoryPage) => void;
  state.query.mockImplementation(() => new Promise<HistoryPage>(resolve => { finishRefresh = resolve; }));
  act(() => {
    state.status = { ...state.status, confirmedSequence: 2 }; state.listener?.(state.status);
  });
  await waitFor(() => expect(list.getAttribute('aria-busy')).toBe('true'));
  expect(screen.getByText('Edit 1')).toBeInTheDocument();
  expect(list.getAttribute('aria-activedescendant')).toBe(beforeSelection);
  expect(list.scrollTop).toBe(84);
  await act(async () => { finishRefresh(page); });
  expect(list.getAttribute('aria-busy')).toBe('false');
  expect(list.getAttribute('aria-activedescendant')).toBe(beforeSelection);
  expect(list.scrollTop).toBe(84);
});
