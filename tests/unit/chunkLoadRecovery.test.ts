import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/diagnostics/diagnosticReporter', () => ({
  reportChunkLoadRecovery: vi.fn(),
}));

const marker = 'masterselects:chunk-reload';
let reload: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  const storage = window.sessionStorage;
  storage.clear();
  reload = vi.fn();
  vi.stubGlobal('window', Object.assign(new EventTarget(), {
    sessionStorage: storage,
    location: { reload },
  }));
  const { installChunkLoadRecovery } = await import('../../src/runtime/chunkLoadRecovery');
  installChunkLoadRecovery();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.getElementById('masterselects-chunk-recovery-notice')?.remove();
});

const notice = () => document.getElementById('masterselects-chunk-recovery-notice');

// Vite's preload helper dispatches this cancelable event, then throws the
// original error only when default was NOT prevented. Cancellation otherwise
// turns a failed import into a fulfilled promise containing undefined.
async function failedViteImport(error: Error): Promise<unknown> {
  const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), {
    payload: error,
  });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) throw error;
  return undefined;
}

describe('chunk load recovery', () => {
  it('retains dirty work without consuming reload recovery or swallowing the import error', async () => {
    const { preserveUnsavedProjectOnChunkFailure } = await import('../../src/runtime/chunkReloadGuard');
    let dirty = true;
    const dispose = preserveUnsavedProjectOnChunkFailure(() => dirty);
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/Export.js');
    await expect(failedViteImport(error)).rejects.toBe(error);
    expect(reload).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(marker)).toBeNull();
    dirty = false;
    await expect(failedViteImport(error)).rejects.toBe(error);
    expect(reload).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('preserves import rejection while reload is pending or navigation is cancelled', async () => {
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/App.js');
    await expect(failedViteImport(error)).rejects.toBe(error);
    expect(reload).toHaveBeenCalledTimes(1);
    await expect(failedViteImport(error)).rejects.toBe(error);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('preserves import rejection during the cross-navigation reload cooldown', async () => {
    window.sessionStorage.setItem(marker, String(Date.now()));
    const error = new SyntaxError("Unexpected token '{'");
    await expect(failedViteImport(error)).rejects.toBe(error);
    expect(reload).not.toHaveBeenCalled();
  });

  it('still requests recovery when session storage is inaccessible', async () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    const error = new TypeError('Importing a module script failed.');
    await expect(failedViteImport(error)).rejects.toBe(error);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Production: React.lazy failures ("Failed to fetch dynamically imported module:
  // …/App-DsNuWLcW.js") unmounted the root without any reload.
  it('recovers lazy imports that React reports as uncaught render errors', async () => {
    const { recoverFromChunkRenderError } = await import('../../src/runtime/chunkLoadRecovery');
    expect(recoverFromChunkRenderError(new TypeError('Cannot read properties of undefined'))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(recoverFromChunkRenderError(new TypeError('Failed to fetch dynamically imported module: /assets/App-DsNuWLcW.js'))).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('treats failed CSS preloads as chunk failures', async () => {
    const { recoverFromChunkRenderError } = await import('../../src/runtime/chunkLoadRecovery');
    expect(recoverFromChunkRenderError(new Error('Unable to preload CSS for /assets/ExportPanel-CxFn7j6S.css'))).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits for the connection instead of reloading offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/renderHostPort.js');
    await expect(failedViteImport(error)).rejects.toBe(error);
    expect(reload).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(marker)).toBeNull();
    expect(notice()?.dataset.kind).toBe('offline');
    vi.stubGlobal('navigator', { onLine: true });
    window.dispatchEvent(new Event('online'));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(notice()).toBeNull();
  });

  it('shows a reload notice when the cooldown suppresses the automatic reload', async () => {
    window.sessionStorage.setItem(marker, String(Date.now()));
    const error = new TypeError('Importing a module script failed.');
    await expect(failedViteImport(error)).rejects.toBe(error);
    expect(reload).not.toHaveBeenCalled();
    expect(notice()?.dataset.kind).toBe('retry');
    notice()!.querySelector('button')!.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
