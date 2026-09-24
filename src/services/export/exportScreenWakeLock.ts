import { getAndroidApp } from '../android/androidApp';

/** A best-effort foreground screen lock; it never keeps a background export alive. */
export function holdExportScreenAwake(): () => void {
  const android = getAndroidApp();
  if (android) {
    const lease = crypto.randomUUID();
    void android.setScreenAwake(lease, true).catch(() => {});
    return () => { void android.setScreenAwake(lease, false).catch(() => {}); };
  }
  if (!navigator.wakeLock?.request) return () => {};

  let disposed = false;
  let pending = false;
  let epoch = 0;
  let lock: WakeLockSentinel | null = null;

  const release = () => {
    epoch += 1;
    const previous = lock;
    lock = null;
    // A browser can deny or revoke a lock (battery saver, OS policy, visibility).
    // None of those conditions should fail the media export.
    if (previous) void previous.release().catch(() => {});
  };

  const acquire = async () => {
    if (disposed || pending || lock || document.visibilityState !== 'visible') return;
    pending = true;
    const requestedEpoch = epoch;
    try {
      const acquired = await navigator.wakeLock.request('screen');
      if (disposed || document.visibilityState !== 'visible' || requestedEpoch !== epoch) {
        await acquired.release().catch(() => {});
      } else {
        lock = acquired;
        acquired.addEventListener('release', () => {
          if (lock === acquired) lock = null;
        }, { once: true });
      }
    } catch {
      // Unsupported/denied locks are optional. Retry only on the next foreground event.
    } finally {
      pending = false;
      // A hide/show may have happened while the request was in flight.
      if (!disposed && requestedEpoch !== epoch) void acquire();
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') void acquire();
    else release();
  };
  const onPageShow = () => { void acquire(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', release);
  window.addEventListener('pageshow', onPageShow);
  void acquire();

  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', release);
    window.removeEventListener('pageshow', onPageShow);
    release();
  };
}
