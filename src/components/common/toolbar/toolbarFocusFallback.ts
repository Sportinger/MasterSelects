/** How long a disabled save-status button may take to become focusable after a reopen. */
const RETRY_MS = 100;
const MAX_ATTEMPTS = 20;

function focusable(scope: Element): HTMLElement | null {
  const preferred = scope.querySelector<HTMLButtonElement>('.toolbar-save-status');
  if (preferred && !preferred.disabled) return preferred;
  return scope.querySelector<HTMLElement>('button:not(:disabled):not([aria-disabled="true"])');
}

const focusLost = () => !document.activeElement || document.activeElement === document.body;

/**
 * Moves keyboard focus to a stable toolbar control (the save status, else the first enabled
 * button of the toolbar section) after the focused control unmounted. The save status can
 * stay disabled for a moment after a reopen, so this retries briefly and gives up as soon as
 * focus went somewhere else.
 */
export function focusStableToolbarControl(scope: Element): void {
  let attempts = 0;
  const attempt = () => {
    if (!scope.isConnected || !focusLost()) return;
    const preferred = scope.querySelector<HTMLButtonElement>('.toolbar-save-status');
    const waitForPreferred = preferred?.disabled === true && ++attempts < MAX_ATTEMPTS;
    const target = waitForPreferred ? null : focusable(scope);
    if (target) { target.focus(); return; }
    if (waitForPreferred) setTimeout(attempt, RETRY_MS);
  };
  attempt();
}
