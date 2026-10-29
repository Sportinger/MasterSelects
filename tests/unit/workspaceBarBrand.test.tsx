import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppUpdateCheckOutcome, AppUpdateSnapshot } from '../../src/services/appUpdate/appUpdateCheck';

// A stand-in for the shared checker: the test decides when a check answers and what it finds.
const fake = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    snapshot: { available: false, version: null } as AppUpdateSnapshot,
    answer: null as ((outcome: AppUpdateCheckOutcome) => void) | null,
  };
  const checker = {
    start: () => {},
    stop: () => {},
    check: async () => ({ kind: 'current' }) as AppUpdateCheckOutcome,
    checkNow: vi.fn(() => new Promise<AppUpdateCheckOutcome>((resolve) => { state.answer = resolve; })),
    getSnapshot: () => state.snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const publish = (next: AppUpdateSnapshot) => {
    state.snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  return { checker, state, publish };
});

vi.mock('../../src/services/appUpdate/appUpdateCheck', () => ({
  getAppUpdateChecker: () => fake.checker,
  retainAppUpdateChecker: () => () => {},
}));
vi.mock('../../src/services/appUpdate/reloadForAppUpdate', () => ({ reloadForAppUpdate: vi.fn() }));

import { WorkspaceBarBrand } from '../../src/components/common/WorkspaceBarBrand';
import { MANUAL_CHECK_FEEDBACK_MS } from '../../src/hooks/useAppUpdate';
import { APP_VERSION } from '../../src/version';

const note = () => document.querySelector('.workspace-bar-brand-check')!;
const brand = () => screen.getByRole('button', { name: `MasterSelects ${APP_VERSION} – check for updates` });

async function answer(outcome: AppUpdateCheckOutcome) {
  await act(async () => { fake.state.answer?.(outcome); });
}

describe('workspace bar brand: check for updates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake.state.snapshot = { available: false, version: null };
    fake.state.answer = null;
    fake.checker.checkNow.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('is a button named after the running version that checks at once', async () => {
    render(<WorkspaceBarBrand />);
    expect(brand()).toHaveAttribute('title', `MasterSelects ${APP_VERSION} – check for updates`);
    expect(note()).toHaveAttribute('role', 'status');
    expect(note()).toBeEmptyDOMElement();

    fireEvent.click(brand());
    expect(fake.checker.checkNow).toHaveBeenCalledTimes(1);
    expect(note()).toHaveTextContent('Checking…');
    expect(brand()).toHaveAttribute('aria-busy', 'true');

    await answer({ kind: 'current' });
    expect(note()).toHaveTextContent(`Up to date (${APP_VERSION})`);
    expect(brand()).not.toHaveAttribute('aria-busy');
    act(() => { vi.advanceTimersByTime(MANUAL_CHECK_FEEDBACK_MS - 1); });
    expect(note()).toHaveTextContent('Up to date');
    act(() => { vi.advanceTimersByTime(1); });
    expect(note()).toBeEmptyDOMElement();
  });

  it('says briefly when the check failed or update checks are off', async () => {
    render(<WorkspaceBarBrand />);
    fireEvent.click(brand());
    await answer({ kind: 'failed', cause: 'unreachable', message: 'Failed to fetch' });
    expect(note()).toHaveTextContent('Check failed');
    expect(note()).toHaveAttribute('data-check-state', 'failed');

    fireEvent.click(brand());
    await answer({ kind: 'disabled' });
    expect(note()).toHaveTextContent('Update checks are off');
    act(() => { vi.advanceTimersByTime(MANUAL_CHECK_FEEDBACK_MS); });
    expect(note()).toBeEmptyDOMElement();
  });

  it('shows the answer of the latest click only', async () => {
    render(<WorkspaceBarBrand />);
    fireEvent.click(brand());
    const first = fake.state.answer!;
    fireEvent.click(brand());
    await act(async () => { first({ kind: 'failed', cause: 'unreachable', message: 'late' }); });
    expect(note()).toHaveTextContent('Checking…');
    await answer({ kind: 'current' });
    expect(note()).toHaveTextContent('Up to date');
  });

  it('turns into the glowing update button when a click finds a new version, keeping keyboard focus', async () => {
    render(<WorkspaceBarBrand />);
    const button = brand();
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.click(button);
    await act(async () => {
      fake.publish({ available: true, version: '9.9.9' });
      fake.state.answer?.({ kind: 'available', version: '9.9.9' });
    });
    const update = screen.getByRole('button', { name: 'New version 9.9.9 available – click to update' });
    expect(update).toBe(button);
    expect(update).toHaveClass('workspace-bar-brand--update');
    expect(document.activeElement).toBe(update);
    expect(note()).toBeEmptyDOMElement();
    expect(document.querySelector('.workspace-bar-brand-slot')).toHaveAttribute('data-update-available', 'true');

    // From now on a click starts the update, not another check.
    fireEvent.click(update);
    expect(fake.checker.checkNow).toHaveBeenCalledTimes(1);
  });

  it('lets go of focus after a pointer click', () => {
    render(<WorkspaceBarBrand />);
    const button = brand();
    button.focus();
    fireEvent.pointerUp(button);
    expect(document.activeElement).not.toBe(button);
  });
});
