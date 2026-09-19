/** Owns submission until the asynchronous runner (including cleanup) settles.
 * Cancellation requests must not release this gate themselves.
 */
export class ExportSubmissionGate {
  private active = false;

  async run(operation: () => unknown | Promise<unknown>): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      await operation();
    } finally {
      this.active = false;
    }
  }
}
