import { open, writeFile } from 'node:fs/promises'
import { existingTest as test, expect } from './existingFixture'
import { createOwnedPlayer, cleanupExistingResources } from './existingPlayer'
import { finishExistingCase } from './existingResourceCleanup.mjs'
import { actionGateFor, unguardedPage } from './existingActionBoundary'

// Intentionally absent from ordinary testMatch. ROOT must explicitly add this
// filename in a reviewed negative-only config AND set the opt-in environment.
test.skip(process.env.MS_BETA_EXISTING_NEGATIVE !== 'AQ104', 'Explicit AQ104 negative qualification only')

test.afterEach(async ({ page }, testInfo) => {
  await finishExistingCase({ failed: testInfo.status !== testInfo.expectedStatus,
    original: testInfo.errors[0], cleanup: () => cleanupExistingResources(page),
    persist: async report => {
      const file = testInfo.outputPath('negative-resource-cleanup.json')
      await writeFile(file, JSON.stringify({ status: testInfo.status, errors: testInfo.errors,
        pageClosed: page.isClosed(), report }, null, 2))
      await testInfo.attach('negative-resource-cleanup', { path: file, contentType: 'application/json' })
    } })
})

async function allocate(page: Parameters<typeof createOwnedPlayer>[0]) {
  const owned = await createOwnedPlayer(page)
  await owned.handle.evaluate(element => {
    const scope = element as HTMLDivElement & { __ownedUrls: string[]; __frameCallback: number }
    scope.__ownedUrls.push(URL.createObjectURL(new Blob(['AQ104 negative owned URL'])))
    scope.__frameCallback = scope.querySelector('video')!.requestVideoFrameCallback(() => {})
  })
  return owned
}

test('AQ104 genuine assertion failure @existing-negative', async ({ page }, testInfo) => {
  await allocate(page)
  await testInfo.attach('negative-before-cleanup.png', { body: await page.screenshot(), contentType: 'image/png' })
  expect('AQ104 deliberate assertion failure').toBe('must fail in runner')
})

test('AQ104 genuine runner timeout @existing-negative', async ({ page }, testInfo) => {
  await allocate(page)
  await testInfo.attach('negative-before-timeout', { body: 'AQ104 allocation complete; awaiting runner timeout', contentType: 'text/plain' })
  testInfo.setTimeout(testInfo.duration + 1000)
  await new Promise<void>(() => {})
})

test('AQ104 partial allocation failure @existing-negative', async ({ page }) => {
  await createOwnedPlayer(page, { testOnlyFailAfterAllocation: true })
})

test('AQ104 original assertion survives handle disposal failure @existing-negative', async ({ page }) => {
  const owned = await allocate(page)
  const dispose = owned.handle.dispose.bind(owned.handle)
  let first = true
  owned.handle.dispose = async () => {
    if (first) { first = false; throw Error('AQ104 injected handle disposal failure') }
    await dispose()
  }
  expect('AQ104 original assertion with cleanup failure').toBe('must fail in runner')
})

test('AQ105 abrupt worker exit after settled allocation @existing-negative', async ({ page }, testInfo) => {
  const owned = await allocate(page)
  const gate = actionGateFor(page)
  expect((await gate.settle()).outstanding).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('before-worker-exit.png') })
  const raw = unguardedPage(page), cdp = await raw.context().newCDPSession(raw)
  const loaderId = (await cdp.send('Page.getFrameTree')).frameTree.frame.loaderId
  await cdp.detach()
  const handle = await open(testInfo.outputPath('settled-worker-exit.json'), 'wx')
  try {
    await handle.writeFile(JSON.stringify({ schema: 'mstest-settled-worker-exit/v1', caseId: testInfo.testId,
      targetId: process.env.MS_BETA_TARGET_ID, reservationSha256: process.env.MS_BETA_RESERVATION_SHA256,
      owner: owned.owner, loaderId, outstanding: gate.outstanding, at: new Date().toISOString() }))
    await handle.sync()
  } finally { await handle.close() }
  process.exit(42) // Deliberately bypass fixture cleanup; external controller must reconcile this exact owner.
})
