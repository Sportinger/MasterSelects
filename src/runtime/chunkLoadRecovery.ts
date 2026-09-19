import { reportChunkLoadRecovery } from '../services/diagnostics/diagnosticReporter';
import { canReloadAfterChunkFailure } from './chunkReloadGuard';

const CHUNK_RELOAD_MARKER = 'masterselects:chunk-reload';
const CHUNK_RELOAD_COOLDOWN_MS = 60_000;

const CHUNK_ERROR_PATTERN =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk [\w-]+ failed|chunkloaderror/i;

let reloadRequested = false;

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

  if (!canReloadAfterChunkFailure()) {
    reportChunkLoadRecovery('reload_deferred', reason);
    return false;
  }

  const now = Date.now();

  try {
    const previousReload = Number(window.sessionStorage.getItem(CHUNK_RELOAD_MARKER));
    if (Number.isFinite(previousReload) && now - previousReload < CHUNK_RELOAD_COOLDOWN_MS) {
      reportChunkLoadRecovery('reload_suppressed', reason);
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

export function installChunkLoadRecovery(): void {
  window.addEventListener('vite:preloadError', (event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    reloadOnce(getErrorMessage(payload) || 'vite:preloadError');
    // Keep Vite's original rejection. preventDefault makes its preload helper
    // resolve undefined, which breaks React.lazy before navigation completes
    // (or when the unsaved-project warning cancels the reload).
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
