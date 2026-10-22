import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserProjectOpenDialog } from '../../src/components/common/toolbar/BrowserProjectOpenDialog';

vi.mock('../../src/services/projectFileService', () => ({ projectFileService: { listStoredProjects: async () => ['Stored'] } }));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));
afterEach(cleanup);

async function startImport(onImportArchive: (file: File, signal: AbortSignal) => Promise<string | null>) {
  const onClose = vi.fn();
  const view = render(<BrowserProjectOpenDialog onClose={onClose} onOpenStored={vi.fn()} onImportArchive={onImportArchive} />);
  await screen.findByRole('button', { name: 'Stored' });
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => { fireEvent.change(input, { target: { files: [new File(['x'], 'Show.msproj')] } }); });
  return { onClose, view };
}

describe('browser project open dialog: archive import cancel', () => {
  it('cancels a running import through its signal and closes once the import has stopped', async () => {
    let finish!: (message: string | null) => void; let received!: AbortSignal;
    const { onClose } = await startImport((_file, signal) => { received = signal; return new Promise(resolve => { finish = resolve; }); });
    const cancel = screen.getByRole('button', { name: 'Cancel import' });
    expect(cancel).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stored' })).toBeDisabled();
    fireEvent.click(cancel);
    expect(received.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancelling import…' })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finish('The project archive import was cancelled.'); });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('cancels with Escape and when the dialog unmounts', async () => {
    const signals: AbortSignal[] = [];
    const pending = (_file: File, signal: AbortSignal) => { signals.push(signal); return new Promise<string | null>(() => {}); };
    await startImport(pending);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(signals[0]!.aborted).toBe(true);
    cleanup();
    const { view } = await startImport(pending);
    view.unmount();
    expect(signals[1]!.aborted).toBe(true);
  });

  it('keeps Cancel disabled while a stored project opens', async () => {
    const onOpenStored = vi.fn(() => new Promise<string | null>(() => {}));
    render(<BrowserProjectOpenDialog onClose={vi.fn()} onOpenStored={onOpenStored} onImportArchive={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stored' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
