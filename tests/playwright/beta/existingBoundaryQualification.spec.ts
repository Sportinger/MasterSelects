import { existingTest as test, expect } from './existingFixture'
import { actionGateFor, unguardedPage } from './existingActionBoundary'
import { createOwnedPlayer } from './existingPlayer'
import { observeExistingExportAlert } from './existingExportAlert'
import { unexpectedExistingConsoleErrors, nativeHelperOrigin } from './existingConsoleOrigin'

test('Existing boundary: live pinned tools and visible controls @boundary-positive', async ({ page, bridge }, testInfo) => {
  const stats = await bridge.toolData<{ engineReady: boolean }>('getStats')
  expect(stats.engineReady).toBe(true)
  await page.getByRole('tab', { name: 'Properties', exact: true }).click()
  await page.getByRole('tab', { name: 'Export', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Export', exact: true }).getByRole('button', { name: 'Export', exact: true })).toBeVisible()
  await testInfo.attach('boundary-controls.png', { body: await page.screenshot(), contentType: 'image/png' })
  expect(actionGateFor(page).outstanding).toBe(0)
})

// Selected separately by the external controller. It must FAIL in fixture teardown;
// a caught matcher is not used to label this rejected document as a valid case.
test('Existing boundary: actual same-URL reload rejects further input @boundary-negative', async ({ page }) => {
  const raw = unguardedPage(page), cdp = await raw.context().newCDPSession(raw)
  try {
    // The deliberate reload must expose full response bytes; conditional-cache
    // responses otherwise stop the serving guard before this document guard.
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await raw.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 })
    await raw.waitForTimeout(5000)
    await page.getByRole('tab', { name: 'Properties', exact: true }).click()
  } finally { await cdp.detach() }
})

test('Existing boundary: returned handle stops after failure and owner cleanup survives @handle-negative', async ({ page }, testInfo) => {
  const owned = await createOwnedPlayer(page)
  await owned.handle.evaluate(element => {
    const scope = element as HTMLDivElement & { __ownedUrls: string[] }
    scope.__ownedUrls.push(URL.createObjectURL(new Blob(['handle cleanup control'])))
  })
  await expect(owned.handle.evaluate(() => { throw Error('AQ105 handle execution failure') })).rejects.toThrow('AQ105 handle execution failure')
  await expect(owned.handle.evaluate(element => { element.dataset.unexpected = 'mutation' })).rejects.toThrow('Existing target stopped')
  expect(await unguardedPage(page).locator('[id="beta-owned-' + owned.owner + '"]').getAttribute('data-unexpected')).toBeNull()
  const cleanup = await owned.cleanup(owned.owner)
  expect(cleanup).toMatchObject({ handleDisposed: true, connected: false, remainingUrls: 0, errors: [] })
  await testInfo.attach('stopped-handle-cleanup', { body: JSON.stringify(cleanup), contentType: 'application/json' })
  // Fixture must retain the stopped action as a failed case, despite successful cleanup.
})

test('Existing boundary: browser handle deadline retains late settlement @deadline-negative', async ({ page }, testInfo) => {
  const owned = await createOwnedPlayer(page)
  const started = Date.now()
  await expect(owned.handle.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 16_000))
    return 'late completion without mutation'
  })).rejects.toThrow('completion unknown')
  expect(Date.now() - started).toBeLessThan(16_000)
  await expect(owned.handle.evaluate(element => element.remove())).rejects.toThrow('Existing target stopped')
  const settlement = await actionGateFor(page).settle(5000)
  expect(settlement.outstanding).toBe(0)
  const cleanup = await owned.cleanup(owned.owner)
  expect(cleanup).toMatchObject({ connected: false, handleDisposed: true, errors: [] })
  await testInfo.attach('late-handle-settlement', { body: JSON.stringify({ settlement, cleanup }), contentType: 'application/json' })
})

test('Existing export observer cancels absent alert and retains actual product error @alert-positive', async ({ page }, testInfo) => {
  const owned = await createOwnedPlayer(page)
  try {
    await owned.handle.evaluate(root => {
      const alert = document.createElement('div'); alert.setAttribute('role', 'alert'); alert.hidden = true
      alert.textContent = 'Deliberate export error control'; root.append(alert)
    })
    const absent = observeExistingExportAlert(page, owned.locator.getByRole('alert'), 120_000)
    await page.waitForTimeout(250)
    const beforeStop = Date.now(); await absent.stop()
    expect(Date.now() - beforeStop).toBeLessThan(2500)
    expect(actionGateFor(page).outstanding).toBe(0)
    expect(actionGateFor(page).reason).toBeUndefined()
    await owned.handle.evaluate(root => { (root.querySelector('[role="alert"]') as HTMLElement).hidden = false })
    const visible = observeExistingExportAlert(page, owned.locator.getByRole('alert'), 5000)
    try { expect(await visible.promise).toEqual({ kind: 'product-error', message: 'Deliberate export error control' }) }
    finally { await visible.stop() }
    await testInfo.attach('export-alert-cancellation', { body: JSON.stringify({ absentSettled: true, visibleErrorRetained: true }), contentType: 'application/json' })
  } finally { await owned.cleanup(owned.owner) }
})

test('Existing console maps only the loaded optional-helper origin @console-positive', async ({ page, failureEvidence }, testInfo) => {
  const raw = failureEvidence.consoleEntries.filter(entry => entry.type === 'error')
  expect(raw.some(entry => entry.text.includes('9876') && entry.location.url?.endsWith(nativeHelperOrigin.asset))).toBe(true)
  expect(await unexpectedExistingConsoleErrors(page, failureEvidence.consoleEntries, testInfo)).toEqual([])
  expect(raw.every(entry => !entry.location.url?.endsWith(nativeHelperOrigin.source))).toBe(true)
})
