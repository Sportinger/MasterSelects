import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { protectExistingPage } from './existingActionBoundary.ts'
import { observeExistingExportAlert } from './existingExportAlert.ts'
import { origin } from './existingGuards.mjs'

test('observer rejection before download-race subscription remains handled and observable', async () => {
  const session = { async send(method) {
    return method === 'Target.getTargets'
      ? { targetInfos: [{ type: 'page', targetId: 'unit-only', url: origin + '/editor' }] }
      : { frameTree: { frame: { loaderId: 'unit-document' } } }
  }, async detach() {} }
  const raw = { url: () => origin + '/editor', context: () => ({
    browser: () => ({ newBrowserCDPSession: async () => session }), newCDPSession: async () => session,
  }) }
  const guarded = await protectExistingPage(raw, 'unit-only')
  const original = Error('observation failed before click completed')
  const observer = observeExistingExportAlert(guarded.page, { isVisible: async () => { throw original } }, 5000)
  // Emulate a still-running export click: no race consumer until the next turn.
  await setImmediate()
  await assert.rejects(observer.promise, error => error === original)
  await assert.rejects(observer.stop(), error => error === original)
  assert.equal(guarded.gate.outstanding, 0)
  await guarded.dispose()
})
