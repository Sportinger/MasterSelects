// Decides how the editor's WebGPU context reacts to a device loss.
//
// Losses the editor causes itself (destroy/reinitialize) never reach this
// policy. What remains splits into two kinds:
// - background/teardown losses: the browser drops the device of a page that is
//   being unloaded, frozen, or hidden (Android Chrome reports these as
//   "Device was destroyed."). They are expected platform behavior, are logged
//   as warnings, and recovery waits until the page is visible again.
// - real losses while the page is in use (driver resets such as Vulkan
//   VK_ERROR_DEVICE_LOST). The first one per session is reported as an error;
//   repeats are warnings so one bad driver does not flood error reporting.
//   Several real losses in a short window stop recovery instead of looping
//   lose -> recover -> lose forever.

export const REPEATED_LOSS_LIMIT = 3;
export const REPEATED_LOSS_WINDOW_MS = 60_000;

export type DeviceLossDecision =
  | { kind: 'background'; report: 'warn'; recover: 'when-visible' }
  | { kind: 'unexpected'; report: 'error' | 'warn'; recover: 'now'; occurrence: number }
  | { kind: 'repeated'; report: 'warn'; recover: 'stop'; occurrence: number };

let pageHidden = false;
let lifecycleInstalled = false;

function installPageLifecycle(): void {
  if (lifecycleInstalled || typeof window === 'undefined') return;
  lifecycleInstalled = true;
  window.addEventListener('pagehide', () => { pageHidden = true; });
  window.addEventListener('pageshow', () => { pageHidden = false; });
  document.addEventListener('freeze', () => { pageHidden = true; });
  document.addEventListener('resume', () => { pageHidden = false; });
}

/** True while the page is unloading, frozen, or not visible to the user. */
export function isPageInBackground(): boolean {
  installPageLifecycle();
  if (pageHidden) return true;
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** Runs `callback` once the page is visible and active again. */
export function whenPageVisible(callback: () => void): void {
  if (typeof window === 'undefined') return;
  if (!isPageInBackground()) { callback(); return; }
  const check = () => {
    if (isPageInBackground()) return;
    window.removeEventListener('pageshow', check);
    document.removeEventListener('resume', check);
    document.removeEventListener('visibilitychange', check);
    callback();
  };
  window.addEventListener('pageshow', check);
  document.addEventListener('resume', check);
  document.addEventListener('visibilitychange', check);
}

export class DeviceLossPolicy {
  private recentLosses: number[] = [];
  private reportedUnexpectedLoss = false;

  constructor(private readonly now: () => number = () => Date.now()) {}

  classify(): DeviceLossDecision {
    installPageLifecycle();
    if (isPageInBackground()) return { kind: 'background', report: 'warn', recover: 'when-visible' };

    const now = this.now();
    this.recentLosses = this.recentLosses.filter(at => now - at < REPEATED_LOSS_WINDOW_MS);
    this.recentLosses.push(now);
    const occurrence = this.recentLosses.length;
    if (occurrence >= REPEATED_LOSS_LIMIT) return { kind: 'repeated', report: 'warn', recover: 'stop', occurrence };

    const report = this.reportedUnexpectedLoss ? 'warn' : 'error';
    this.reportedUnexpectedLoss = true;
    return { kind: 'unexpected', report, recover: 'now', occurrence };
  }
}
