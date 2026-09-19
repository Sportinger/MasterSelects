import type { Locator, Page } from '@playwright/test'
import { actionGateFor } from './existingActionBoundary.ts'

/** Cancellable losing side of the export/download race in a retained document. */
export function observeExistingExportAlert(page: Page, alert: Locator, timeoutMs: number) {
  const gate = actionGateFor(page), deadline = Date.now() + timeoutMs
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, wake: (() => void) | undefined
  const work = (async () => {
    while (!stopped && Date.now() < deadline) {
      const visible = await gate.run('Observe export alert', () => alert.isVisible(), 2000)
      if (stopped) return
      if (visible) {
        const message = await gate.run('Read export alert', () => alert.innerText({ timeout: 1500 }), 2000)
        return { kind: 'product-error' as const, message: message.trim() || 'Unknown export error' }
      }
      await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))) })
      wake = undefined; timer = undefined
    }
  })()
  // Only the deliberate cancellation/deadline has no race result; real failures propagate.
  const promise = work.then(result => result ?? new Promise<never>(() => {}))
  // A click is awaited before the caller starts its download/error race. Mark
  // early rejection handled immediately, without changing the promise it awaits.
  void promise.catch(() => {})
  return { promise, async stop() {
    stopped = true; clearTimeout(timer); wake?.()
    await work // Settle the last bounded browser observation before owner cleanup.
  } }
}
