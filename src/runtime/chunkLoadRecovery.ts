import { reportChunkLoadRecovery } from '../services/diagnostics/diagnosticReporter';
import { canReloadAfterChunkFailure } from './chunkReloadGuard';
import { hideChunkRecoveryNotice, showChunkRecoveryNotice } from './chunkRecoveryNotice';
import { WORKER_LOAD_FAILURE_EVENT } from './workerLoadFailure';

const CHUNK_RELOAD_MARKER = 'masterselects:chunk-reload';
const CHUNK_RELOAD_COOLDOWN_MS = 60_000;

const CHUNK_ERROR_PATTERN =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk [\w-]+ failed|chunkloaderror|unable to preload css/i;

let reloadRequested = false;
let waitingForConnection = false;

function isOffline(): boolean {
  return globalThis.navigator?.onLine === false;
}

// Reloading while offline fails again and burns the reload cooldown; mobile tabs
// resumed from the background often fail lazy imports exactly then.
function reloadWhenOnline(reason: string): void {
  showChunkRecoveryNotice('offline');
  if (waitingForConnection) return;
  waitingForConnection = true;
  reportChunkLoadRecovery('reload_waiting_online', reason);
  window.addEventListener('online', () => {
    waitingForConnection = false;
    hideChunkRecoveryNotice();
    reloadOnce(reason);
  }, { once: true });
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  return typeof value === 'string' ? value : '';
}

function isChunkResource(target: EventTarget | null): boolean {
  if (target instanceof HTMLScriptElement) {
    return /\/assets\/.+\.js(?:$|\?)/i.test(target.src);
  }

  if (target instanceof HTMLLinkElement) {
    return /\/assets\/.+\.(?:js|css)(?:$|\?)/i.test(target.href);
  }

  return false;
}

function describeResource(target: EventTarget | null): string {
  if (target instanceof HTMLScriptElement) return target.src;
  if (target instanceof HTMLLinkElement) return target.href;
  return '';
}

function reloadOnce(reason: string): boolean {
  if (reloadRequested) {
    return false;
  }

  if (isOffline()) {
    reloadWhenOnline(reason);
    return false;
  }

  if (!canReloadAfterChunkFailure()) {
    reportChunkLoadRecovery('reload_deferred', reason);
    showChunkRecoveryNotice('unsaved');
    return false;
  }

  const now = Date.now();

  try {
    const previousReload = Number(window.sessionStorage.getItem(CHUNK_RELOAD_MARKER));
    if (Number.isFinite(previousReload) && now - previousReload < CHUNK_RELOAD_COOLDOWN_MS) {
      reportChunkLoadRecovery('reload_suppressed', reason);
      showChunkRecoveryNotice('retry');
      return false;
    }

    window.sessionStorage.setItem(CHUNK_RELOAD_MARKER, String(now));
  } catch {
    // A reload is still safer than leaving the editor behind a broken lazy import.
  }

  reloadRequested = true;
  // The reporter flushes on pagehide, so the report survives the reload.
  reportChunkLoadRecovery('reload', reason);
  window.location.reload();
  return true;
}

/**
 * React consumes a rejected React.lazy import itself and reports it as an
 * uncaught render error, which unmounts the root; no window hook sees it.
 */
export function recoverFromChunkRenderError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return CHUNK_ERROR_PATTERN.test(message) && reloadOnce(message);
}

/** The deployed build's identity: app version and module entry, from a page's HTML. */
function buildIdentity(html: string): string | null {
  const version = /<meta\s+name="app-version"\s+content="([^"]*)"/i.exec(html)?.[1];
  const entry = /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/i.exec(html)?.[1];
  if (!version || version === '__APP_VERSION__') return null;
  return `${version} ${entry ?? ''}`;
}

/**
 * A worker that failed before answering is only a stale deploy when the server now serves another
 * build; otherwise the failure is a real worker error and must surface as one, without a reload.
 */
export async function recoverFromWorkerLoadFailure(reason: string): Promise<boolean> {
  if (isOffline()) { reloadWhenOnline(reason); return false; }
  const current = buildIdentity(document.documentElement.outerHTML);
  if (!current) return false;
  let deployed: string | null = null;
  try {
    const response = await fetch(window.location.pathname || '/', { cache: 'no-store', credentials: 'same-origin' });
    if (response.ok) deployed = buildIdentity(await response.text());
  } catch {
    return false;
  }
  if (!deployed || deployed === current) return false;
  return reloadOnce(`stale worker after deploy: ${reason}`);
}

export function installChunkLoadRecovery(): void {
  window.addEventListener('vite:preloadError', (event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    reloadOnce(getErrorMessage(payload) || 'vite:preloadError');
    // Keep Vite's original rejection. preventDefault makes its preload helper
    // resolve undefined, which breaks React.lazy before navigation completes
    // (or when the unsaved-project warning cancels the reload).
  });

  window.addEventListener(WORKER_LOAD_FAILURE_EVENT, (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    void recoverFromWorkerLoadFailure(typeof detail === 'string' ? detail : 'worker failed to load');
  });

  window.addEventListener('unhandledrejection', (event) => {
    const message = getErrorMessage(event.reason);
    if (CHUNK_ERROR_PATTERN.test(message) && reloadOnce(message)) {
      event.preventDefault();
    }
  });

  window.addEventListener(
    'error',
    (event) => {
      const message = getErrorMessage(event.error) || event.message;
      const resource = isChunkResource(event.target) ? describeResource(event.target) : '';
      if ((CHUNK_ERROR_PATTERN.test(message) || resource) && reloadOnce(resource || message)) {
        event.preventDefault();
      }
    },
    true,
  );
}
