export type CaptureTeardownReason = 'cancel' | 'error' | 'source-lost' | 'stop';
export type CaptureCleanup = () => Promise<void> | void;

export class CaptureLifecycle {
  private readonly cleanups: CaptureCleanup[] = [];
  private teardownPromise: Promise<unknown> | null = null;

  addCleanup(cleanup: CaptureCleanup): void {
    if (this.teardownPromise) {
      void Promise.resolve(cleanup());
      return;
    }
    this.cleanups.push(cleanup);
  }

  teardownSession<T>(
    _reason: CaptureTeardownReason,
    finalize?: () => Promise<T> | T,
  ): Promise<T | undefined> {
    if (!this.teardownPromise) {
      this.teardownPromise = (async () => {
        try {
          return await finalize?.();
        } finally {
          await Promise.allSettled(this.cleanups.splice(0).reverse().map(cleanup => cleanup()));
        }
      })();
    }
    return this.teardownPromise as Promise<T | undefined>;
  }
}
