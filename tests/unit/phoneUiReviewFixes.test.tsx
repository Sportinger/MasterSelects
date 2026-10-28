// Phone UI review fixes: Undo/Redo while an edit sheet holds its transaction, keyboard reach of the
// docked transport, toast fit and duration, sheet growth after the lock, the keyboard inset, one
// transcription availability rule for Settings and Captions, and the resume card label.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ session: {} as object | null, live: new Set<object>(), explicit: null as object | null }));
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  getEditorRepositorySession: () => runtime.session,
  getEditorTransactionToken: () => runtime.explicit,
  beginEditorTransaction: (label: string) => { const token = { label }; runtime.live.add(token); return token; },
  ownsEditorTransaction: (token: object) => runtime.live.has(token),
  commitEditorTransaction: (token: object) => { runtime.live.delete(token); },
  cancelEditorTransaction: (token: object) => { runtime.live.delete(token); },
  runEditorTransaction: (token: object, action: () => unknown) => {
    const previous = runtime.explicit; runtime.explicit = token;
    try { return action(); } finally { runtime.explicit = previous; }
  },
  captureEditorTransactionAcrossAwaits: async (_token: object, action: () => Promise<unknown>) => action(),
  runEditorBatch: async (_label: string, action: () => Promise<unknown>) => action(),
}));

import { PHONE_TEST_IDS } from '../../src/components/mobileSkin/contracts';
import { PhoneHomeResumeCard } from '../../src/components/mobileSkin/home/PhoneHomeResumeCard';
import { phoneTranscriptionReadiness } from '../../src/components/mobileSkin/captions/phoneTranscription';
import { phoneTranscriptionAvailability } from '../../src/components/mobileSkin/settings/phoneSettingsModel';
import { createPhoneEditSession } from '../../src/components/mobileSkin/sheets/phoneEditSession';
import {
  phoneHistoryBlockReason, phoneOpenEditTransactions, registerPhoneEditTransaction, resetPhoneHistoryGuard, runPhoneHistoryTap,
} from '../../src/components/mobileSkin/sheets/phoneHistoryGuard';
import { PhoneSheet } from '../../src/components/mobileSkin/sheets/PhoneSheet';
import { PHONE_SHEET_GROWTH, phoneSheetGrowth } from '../../src/components/mobileSkin/sheets/phoneSheetSizing';
import { phoneToastDuration, phoneToastFit } from '../../src/components/mobileSkin/shell/phoneToastLayout';
import { computeKeyboardInset } from '../../src/components/mobileSkin/shell/usePhoneViewport';
import { usePhoneUiStore } from '../../src/components/mobileSkin/state/phoneUiStore';
import { beginEditorGesture, finishEditorGesture } from '../../src/services/project/repository/transaction/editorGestureOwnership';

const settle = async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); };
const history = () => ({ undo: vi.fn(), redo: vi.fn(), canUndo: true, canRedo: true });

beforeEach(() => {
  runtime.session = {}; runtime.live.clear(); runtime.explicit = null;
  resetPhoneHistoryGuard();
  usePhoneUiStore.setState({ toast: null });
});
afterEach(() => { document.body.innerHTML = ''; });

describe('Undo/Redo while an edit sheet holds its own transaction', () => {
  it('a tap explains that Done or Cancel comes first instead of doing nothing', async () => {
    const session = createPhoneEditSession('Adjust', { onError: vi.fn() });
    await session.apply(() => {});
    expect(phoneOpenEditTransactions()).toEqual(['Adjust']);
    const controls = history();
    runPhoneHistoryTap('undo', controls);
    expect(controls.undo).not.toHaveBeenCalled();
    expect(usePhoneUiStore.getState().toast?.message).toMatch(/Undo waits for Adjust.*Done.*Cancel/);

    await session.commit();
    expect(phoneOpenEditTransactions()).toEqual([]);
    runPhoneHistoryTap('undo', controls);
    expect(controls.undo).toHaveBeenCalledTimes(1);
  });

  it('Cancel releases the block once its rollback ran; a session that changed nothing never blocks', async () => {
    const untouched = createPhoneEditSession('Speed', { onError: vi.fn() });
    expect(phoneHistoryBlockReason('redo')).toBeNull();
    untouched.cancel();
    const session = createPhoneEditSession('Volume', { onError: vi.fn() });
    await session.apply(() => {});
    expect(phoneHistoryBlockReason('redo')).toMatch(/Redo waits for Volume/);
    session.cancel();
    await settle();
    expect(phoneHistoryBlockReason('redo')).toBeNull();
  });

  it('any other open editor gesture also explains itself, and a released registration is idempotent', () => {
    const gesture = beginEditorGesture('Drag');
    expect(phoneHistoryBlockReason('undo')).toMatch(/current edit/);
    if (gesture.batchId !== null) finishEditorGesture(gesture.batchId);
    expect(phoneHistoryBlockReason('undo')).toBeNull();
    const release = registerPhoneEditTransaction('Mask');
    release(); release();
    expect(phoneOpenEditTransactions()).toEqual([]);
  });
});

function renderSheetInShell(withHome = false) {
  return render(
    <div className="phone-shell">
      {withHome ? <div className="phone-home" /> : null}
      <div data-testid={PHONE_TEST_IDS.transport}>
        <button type="button">Play</button>
        <button type="button">Undo</button>
      </div>
      <PhoneSheet title="Adjust" onCancel={() => {}} onDone={() => {}}>
        <button type="button">Brightness</button>
      </PhoneSheet>
    </div>,
  );
}

describe('the docked transport is reachable by keyboard while a sheet is open', () => {
  it('Tab goes from the sheet to the transport and back; the sheet is not aria-modal then', () => {
    renderSheetInShell();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    // Brightness is the sheet's last control (the body follows the header).
    screen.getByText('Brightness').focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement?.textContent).toBe('Play');
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement?.textContent).toBe('Undo');
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    screen.getByText('Play').focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement?.textContent).toBe('Brightness');
  });

  it('over the home screen no transport is docked: a plain modal that keeps Tab inside', () => {
    renderSheetInShell(true);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    screen.getByText('Brightness').focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('toasts while a sheet is open', () => {
  it('a message that fits nowhere on one line wraps instead of ending in an ellipsis', () => {
    expect(phoneToastFit(80, 120, 360)).toEqual({ placement: 'beside-tab', wrap: false });
    expect(phoneToastFit(200, 120, 360)).toEqual({ placement: 'row', wrap: false });
    expect(phoneToastFit(600, 120, 360)).toEqual({ placement: 'row', wrap: true });
    expect(phoneToastFit(600, null, 360)).toEqual({ placement: 'row', wrap: true });
  });

  it('long messages stay long enough to be read; short ones keep the minimum', () => {
    expect(phoneToastDuration({ message: 'Saved.', tone: 'info' })).toBe(2500);
    expect(phoneToastDuration({ message: 'x'.repeat(95), tone: 'info' })).toBeGreaterThan(5000);
    expect(phoneToastDuration({ message: 'x'.repeat(2000), tone: 'error' })).toBeLessThanOrEqual(9000);
  });
});

describe('a locked content-fit sheet grows for content a tap adds', () => {
  it('grows towards the cap right after a tap, never shrinks, ignores small changes', () => {
    expect(phoneSheetGrowth({ lock: 180, natural: 340, cap: 300, sinceInputMs: 100 })).toBe(300);
    expect(phoneSheetGrowth({ lock: 180, natural: 200, cap: 300, sinceInputMs: 100 })).toBeNull();
    expect(phoneSheetGrowth({ lock: 300, natural: 120, cap: 400, sinceInputMs: 100 })).toBeNull();
    expect(phoneSheetGrowth({ lock: 180, natural: 260, cap: 400, sinceInputMs: PHONE_SHEET_GROWTH.inputWindowMs + 1 })).toBeNull();
    expect(phoneSheetGrowth({ lock: 180, natural: 340, cap: 400, sinceInputMs: Infinity })).toBe(340);
  });
});

describe('keyboard inset', () => {
  it('is only the part of the shell the keyboard covers, not the keyboard height again', () => {
    // Shell already sized to the visual viewport (500 px) while a 340 px keyboard is open.
    expect(computeKeyboardInset(500, 0 + 500)).toBe(0);
    // A shell that still reaches under the keyboard (fallback height) is lifted by the covered part.
    expect(computeKeyboardInset(840, 500)).toBe(340);
  });
});

describe('one transcription availability rule', () => {
  it('Settings and Captions agree: a hosted provider without an account cannot run and does not fall back', () => {
    for (const provider of ['local', 'openai', 'deepgram', 'hybrid'] as const) {
      for (const signedIn of [false, true]) {
        expect(phoneTranscriptionAvailability(provider, signedIn).ok).toBe(phoneTranscriptionReadiness(provider, signedIn).kind === 'ready');
      }
    }
  });
});

describe('resume card', () => {
  it('says Reopening only while its own reopen runs', () => {
    const { rerender } = render(<PhoneHomeResumeCard name="Show" busy reopening={false} onReopen={() => {}} />);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('Reopen Show · allow folder access');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    act(() => rerender(<PhoneHomeResumeCard name="Show" busy reopening onReopen={() => {}} />));
    expect(screen.getByRole('button').textContent).toBe('Reopening…');
  });
});
