import { existingTest as test, expect } from './existingFixture'
import { createOwnedPlayer, cleanupExistingResources } from './existingPlayer'

test('Existing-tab lifecycle: caught-error control removes owned DOM and URLs, retains target and evidence @existing-lifecycle', async ({ page }, testInfo) => {
  const owned = await createOwnedPlayer(page)
  let cleanup: unknown
  let url = ''
  await testInfo.attach('deliberate-failure-evidence', { body: 'Keep this error evidence', contentType: 'text/plain' })
  await expect((async () => {
    try {
      url = await owned.handle.evaluate(element => {
        const url = URL.createObjectURL(new Blob(['owned lifecycle resource']))
        ;(element as HTMLDivElement & { __ownedUrls: string[] }).__ownedUrls.push(url)
        return url
      })
      throw Error('Deliberate existing-tab failure')
    } finally { cleanup = await owned.cleanup(owned.owner) }
  })()).rejects.toThrow('Deliberate existing-tab failure')
  expect(cleanup).toMatchObject({ connected: false, remainingUrls: 0, revoked: [url] })
  expect(await owned.locator.count()).toBe(0)
  expect(await page.evaluate(url => fetch(url).then(() => false, () => true), url)).toBe(true)
  expect(page.isClosed()).toBe(false)
  expect(testInfo.attachments.some(item => item.name === 'deliberate-failure-evidence')).toBe(true)
  await testInfo.attach('existing-lifecycle-cleanup', { body: JSON.stringify(cleanup), contentType: 'application/json' })
  await expect(createOwnedPlayer(page, { testOnlyFailAfterAllocation: true })).rejects.toThrow('AQ104 partial allocation failure')
  expect(await page.locator('[id^="beta-owned-"]').count()).toBe(0)
  const report = await cleanupExistingResources(page)
  expect(report.remainingOwners).toEqual([])
  expect(report.errors).toEqual([])
  expect(report.reports).toEqual(expect.arrayContaining([expect.objectContaining({ handleDisposed: true, connected: false })]))
  await testInfo.attach('partial-allocation-cleanup', { body: JSON.stringify(report), contentType: 'application/json' })
})

test('Existing-tab lifecycle: foreign ownership rejected without removing its resources @existing-lifecycle', async ({ page }) => {
  const owned = await createOwnedPlayer(page)
  try {
    const url = await owned.handle.evaluate(element => {
      const url = URL.createObjectURL(new Blob(['foreign sentinel']))
      ;(element as HTMLDivElement & { __ownedUrls: string[] }).__ownedUrls.push(url)
      return url
    })
    await expect(owned.cleanup('foreign-owner')).rejects.toThrow('Foreign resource ownership rejected')
    expect(await owned.locator.count()).toBe(1)
    expect(await page.evaluate(url => fetch(url).then(r => r.text()), url)).toBe('foreign sentinel')
    expect(page.isClosed()).toBe(false)
  } finally { await owned.cleanup(owned.owner) }
})
