import { describe, expect, it, vi } from 'vitest';
import { runUpdateReload, type SaveWorkResult, type UpdateReloadDeps } from '../../src/services/appUpdate/updateReloadFlow';

function observable(initial: boolean) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: boolean) { value = next; for (const listener of [...listeners]) listener(); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    listenerCount: () => listeners.size,
  };
}

function setup({ exporting = false, copies = false, save = async (): Promise<SaveWorkResult> => ({ ok: true }) } = {}) {
  const exportFlag = observable(exporting);
  const copyFlag = observable(copies);
  const order: string[] = [];
  const deps: UpdateReloadDeps = {
    isExporting: exportFlag.get,
    subscribeExporting: exportFlag.subscribe,
    hasPendingMediaCopies: copyFlag.get,
    subscribeMediaCopies: copyFlag.subscribe,
    saveWork: vi.fn(async () => { order.push('save'); return save(); }),
    bypassPageCache: vi.fn(async () => { order.push('bypass'); }),
    reload: vi.fn(() => { order.push('reload'); }),
  };
  return { deps, exportFlag, copyFlag, order };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('update reload flow', () => {
  it('saves, refreshes the page cache and only then reloads', async () => {
    const { deps, order } = setup();
    const progress: string[] = [];
    await expect(runUpdateReload(deps, { onProgress: message => progress.push(message) })).resolves.toEqual({ status: 'reloading' });
    expect(order).toEqual(['save', 'bypass', 'reload']);
    expect(progress).toEqual(['Saving the project…', 'Loading the new version…']);
  });

  it('asks instead of interrupting a running export', async () => {
    const { deps } = setup({ exporting: true });
    await expect(runUpdateReload(deps)).resolves.toEqual({ status: 'export-running' });
    expect(deps.saveWork).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it('waits for the export when the person chose to update after it', async () => {
    const { deps, exportFlag, order } = setup({ exporting: true });
    const result = runUpdateReload(deps, { waitForExport: true });
    await settle();
    expect(order).toEqual([]);
    exportFlag.set(false);
    await expect(result).resolves.toEqual({ status: 'reloading' });
    expect(order).toEqual(['save', 'bypass', 'reload']);
    expect(exportFlag.listenerCount()).toBe(0);
  });

  it('waits for media copies into the project before saving', async () => {
    const { deps, copyFlag, order } = setup({ copies: true });
    const result = runUpdateReload(deps);
    await settle();
    expect(order).toEqual([]);
    copyFlag.set(false);
    await expect(result).resolves.toEqual({ status: 'reloading' });
    expect(order).toEqual(['save', 'bypass', 'reload']);
  });

  it('keeps the page when the save fails', async () => {
    const { deps } = setup({ save: async () => ({ ok: false, message: 'disk full' }) });
    await expect(runUpdateReload(deps)).resolves.toEqual({ status: 'save-failed', message: 'disk full' });
    expect(deps.bypassPageCache).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it('stops waiting when cancelled and never saves or reloads afterwards', async () => {
    const { deps, copyFlag } = setup({ copies: true });
    const controller = new AbortController();
    const result = runUpdateReload(deps, { signal: controller.signal });
    await settle();
    controller.abort();
    await expect(result).resolves.toEqual({ status: 'cancelled' });
    expect(copyFlag.listenerCount()).toBe(0);
    copyFlag.set(false);
    await settle();
    expect(deps.saveWork).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it('does not reload when cancelled during the save', async () => {
    const controller = new AbortController();
    const { deps } = setup({ save: async () => { controller.abort(); return { ok: true }; } });
    await expect(runUpdateReload(deps, { signal: controller.signal })).resolves.toEqual({ status: 'cancelled' });
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it('saves again when a copy started during the save', async () => {
    let saves = 0;
    const holder: { copyFlag?: ReturnType<typeof observable> } = {};
    const { deps, copyFlag, order } = setup({
      save: async () => {
        saves += 1;
        if (saves === 1) holder.copyFlag?.set(true);
        return { ok: true };
      },
    });
    holder.copyFlag = copyFlag;
    const result = runUpdateReload(deps);
    await settle();
    expect(order).toEqual(['save']);
    copyFlag.set(false);
    await expect(result).resolves.toEqual({ status: 'reloading' });
    expect(order).toEqual(['save', 'save', 'bypass', 'reload']);
  });

  it('asks again when an export starts during the save', async () => {
    const holder: { exportFlag?: ReturnType<typeof observable> } = {};
    const { deps, exportFlag } = setup({ save: async () => { holder.exportFlag?.set(true); return { ok: true }; } });
    holder.exportFlag = exportFlag;
    await expect(runUpdateReload(deps)).resolves.toEqual({ status: 'export-running' });
    expect(deps.reload).not.toHaveBeenCalled();
  });
});
