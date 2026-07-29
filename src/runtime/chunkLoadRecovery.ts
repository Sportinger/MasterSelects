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

function reloadOnce(): boolean {
  if (reloadRequested) {
    return false;
  }

  const now = Date.now();

  try {
    const previousReload = Number(window.sessionStorage.getItem(CHUNK_RELOAD_MARKER));
    if (Number.isFinite(previousReload) && now - previousReload < CHUNK_RELOAD_COOLDOWN_MS) {
      return false;
    }

    window.sessionStorage.setItem(CHUNK_RELOAD_MARKER, String(now));
  } catch {
    // A reload is still safer than leaving the editor behind a broken lazy import.
  }

  reloadRequested = true;
  window.location.reload();
  return true;
}

export function installChunkLoadRecovery(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnce()) {
      event.preventDefault();
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (CHUNK_ERROR_PATTERN.test(getErrorMessage(event.reason)) && reloadOnce()) {
      event.preventDefault();
    }
  });

  window.addEventListener(
    'error',
    (event) => {
      if (
        (CHUNK_ERROR_PATTERN.test(getErrorMessage(event.error) || event.message) || isChunkResource(event.target))
        && reloadOnce()
      ) {
        event.preventDefault();
      }
    },
    true,
  );
}
