// Dev-only: Vite awaits `vite:beforeFullReload` listeners before it reloads the
// page, so a source edit that cannot hot-update first writes pending project
// changes instead of silently discarding them.

const DEV_RELOAD_SAVE_TIMEOUT_MS = 8000;

export interface DevFullReloadSaveOptions {
  shouldSave: () => boolean;
  save: () => Promise<boolean>;
  onResult?: (result: 'saved' | 'failed' | 'timeout') => void;
  timeoutMs?: number;
}

export function saveProjectBeforeDevFullReload(options: DevFullReloadSaveOptions): () => void {
  const hot = import.meta.hot;
  if (!hot) return () => undefined;
  const listener = async () => {
    if (!options.shouldSave()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), options.timeoutMs ?? DEV_RELOAD_SAVE_TIMEOUT_MS);
    });
    const saved = options.save()
      .then((ok): 'saved' | 'failed' => (ok ? 'saved' : 'failed'))
      .catch((): 'failed' => 'failed');
    const result = await Promise.race([saved, timeout]);
    clearTimeout(timer);
    options.onResult?.(result);
  };
  hot.on('vite:beforeFullReload', listener);
  return () => hot.off?.('vite:beforeFullReload', listener);
}
