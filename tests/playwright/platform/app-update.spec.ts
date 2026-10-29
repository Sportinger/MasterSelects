import { test, expect } from '../fixtures/test'

// A deploy while the editor is open (docs/Features/App-Updates.md): the served /build-info.json is
// routed to a newer release, a click on the brand checks at once, the brand must glow and name it, and a
// click must save the project and reload the page. The dev server has no build info and keeps the check off
// unless the `ms.updateCheck.enabled` flag is set, so the case sets it; the check itself is the product's own code.

const REVISION = 'f'.repeat(40)
const NEWER_BUILD = {
  schema: 'masterselects-build/v1',
  version: '99.0.0',
  buildId: '2099-01-01T00:00:00.000Z',
  sourceRevision: REVISION,
  sourceDirty: false,
  releaseId: `masterselects-99.0.0-${REVISION}`,
}
const MARKER_COMPOSITION = 'Saved before the update reload'

test('a newly deployed version makes the brand glow; a click saves and reloads into it @module:platform', async ({ page, bridge, editorPage }, testInfo) => {
  const slot = page.locator('.workspace-bar-brand-slot')
  const brand = slot.locator('button.workspace-bar-brand')
  const note = slot.locator('.workspace-bar-brand-check')
  const updateButton = page.getByRole('button', { name: 'New version 99.0.0 available – click to update' })
  const buildInfoRequests: string[] = []

  await test.step('the running build shows the plain brand as a check button', async () => {
    await expect(slot).toBeVisible()
    await expect(slot).not.toHaveAttribute('data-update-available', 'true')
    await expect(brand).toHaveAttribute('aria-label', /^MasterSelects \S+ – check for updates$/)
  })

  await test.step('a click says when update checks are off, without moving the bar', async () => {
    const before = (await page.locator('.workspace-bar-modes').boundingBox())!
    await brand.click()
    await expect(note).toHaveText('Update checks are off')
    expect((await page.locator('.workspace-bar-modes').boundingBox())!.x).toBe(before.x)
    expect(await brand.evaluate(element => document.activeElement === element), 'a click leaves no focus behind').toBe(false)
    await expect(note).toBeEmpty({ timeout: 5_000 })
  })

  await test.step('the keyboard reaches the brand, shows its focus ring and checks with Enter', async () => {
    await brand.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(brand).toBeFocused()
    expect(await brand.evaluate(element => element.matches(':focus-visible') && getComputedStyle(element).outlineStyle)).toBe('solid')
    await page.keyboard.press('Enter')
    await expect(note).toHaveText('Update checks are off')
    await expect(brand).toBeFocused()
    await brand.blur()
  })

  await test.step('a click asks the server at once; an answer without build info says the check failed', async () => {
    await page.evaluate(() => window.localStorage.setItem('ms.updateCheck.enabled', 'true'))
    await brand.click()
    await expect(note).toHaveText('Check failed')
  })

  await test.step('the server starts serving a newer release and a click finds it', async () => {
    await page.route('**/build-info.json*', async (route) => {
      buildInfoRequests.push(route.request().url())
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NEWER_BUILD) })
    })
    await brand.click()
  })

  await test.step('the brand glows and names the new version', async () => {
    await expect(slot).toHaveAttribute('data-update-available', 'true')
    await expect(updateButton).toBeVisible()
    await expect(updateButton).toHaveAttribute('title', 'New version 99.0.0 available – click to update')
    expect(buildInfoRequests[0]).toMatch(/\/build-info\.json\?check=\d+$/)
    const glow = await updateButton.evaluate(element => getComputedStyle(element, '::before').animationName)
    expect(glow).toBe('workspace-bar-update-glow')
    const colors = await updateButton.evaluate((element) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--update-available)'
      element.appendChild(probe)
      const expected = getComputedStyle(probe).color
      probe.remove()
      const label = element.querySelector('.workspace-bar-brand-label')!
      return { label: getComputedStyle(label).color, expected }
    })
    expect(colors.label, 'the brand text uses --update-available').toBe(colors.expected)
    // The bottom left corner of the editor, as the docs show it.
    const box = (await slot.boundingBox())!
    await page.screenshot({ path: testInfo.outputPath('update-glow.png'), clip: { x: 0, y: box.y - 64, width: 420, height: box.height + 64 } })
    await testInfo.attach('update-glow.png', { path: testInfo.outputPath('update-glow.png'), contentType: 'image/png' })
  })

  await test.step('a narrow window keeps the glowing mark and a one-row bar', async () => {
    const viewport = page.viewportSize()!
    await page.setViewportSize({ width: 700, height: 900 })
    try {
      await expect(updateButton).toBeVisible()
      await expect(slot.locator('.workspace-bar-brand-label')).toBeHidden()
      const bar = (await page.locator('.workspace-bar').boundingBox())!
      expect(bar.height, 'the bar keeps one row').toBeLessThan(48)
      await page.screenshot({ path: testInfo.outputPath('update-glow-narrow.png'), clip: { x: 0, y: bar.y - 8, width: 700, height: bar.height + 8 } })
    } finally {
      await page.setViewportSize(viewport)
    }
  })

  await test.step('the brand is in the keyboard order and shows its focus ring there', async () => {
    await updateButton.focus()
    await page.keyboard.press('Shift+Tab')
    await expect(updateButton).not.toBeFocused()
    await page.keyboard.press('Tab')
    await expect(updateButton).toBeFocused()
    expect(await updateButton.evaluate(element => element.matches(':focus-visible') && getComputedStyle(element).outlineStyle)).toBe('solid')
    await updateButton.blur()
  })

  await test.step('an unsaved change is made right before the update', async () => {
    await bridge.toolData('createComposition', { name: MARKER_COMPOSITION, width: 640, height: 360, frameRate: 30, duration: 2 })
  })

  await test.step('a click saves the project and reloads the page', async () => {
    await page.evaluate(() => { (window as unknown as { __beforeUpdateReload?: boolean }).__beforeUpdateReload = true })
    const reloaded = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() })
    await updateButton.click()
    await reloaded
    await editorPage.shell.waitFor({ state: 'visible', timeout: 90_000 })
    expect(await page.evaluate(() => (window as unknown as { __beforeUpdateReload?: boolean }).__beforeUpdateReload)).toBeUndefined()
  })

  await test.step('the change survived the reload', async () => {
    await bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
    await bridge.authenticate()
    await editorPage.waitForProjectIdle(30_000)
    const media = await bridge.toolData<unknown>('getMediaItems', {})
    expect(JSON.stringify(media)).toContain(MARKER_COMPOSITION)
  })
})

// Two editor tabs of one browser (real Web Locks and BroadcastChannel): one tab polls for both, and the
// answer it gets makes both glow. The second tab asks for the check the way a returning connection does.
test('several editor tabs share one check: one request, every tab glows @module:platform', async ({ page }) => {
  const buildInfoRequests: string[] = []
  await page.context().route('**/build-info.json*', async (route) => {
    buildInfoRequests.push(route.request().url())
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NEWER_BUILD) })
  })
  await page.evaluate(() => window.localStorage.setItem('ms.updateCheck.enabled', 'true'))
  const second = await page.context().newPage()
  await second.goto(new URL('/editor', page.url()).toString(), { waitUntil: 'domcontentloaded' })
  await expect(second.locator('.workspace-bar-brand-slot')).toBeVisible({ timeout: 90_000 })

  await test.step('one tab holds the polling lock, the other waits for it', async () => {
    await expect.poll(() => page.evaluate(async (name) => {
      const state = await navigator.locks.query()
      return { held: state.held?.filter(lock => lock.name === name).length, waiting: state.pending?.filter(lock => lock.name === name).length }
    }, 'masterselects-app-update-leader'), { timeout: 30_000 }).toEqual({ held: 1, waiting: 1 })
  })

  await test.step('a check asked for by the waiting tab reaches both tabs with one request', async () => {
    await second.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.getByRole('button', { name: 'New version 99.0.0 available – click to update' })).toBeVisible()
    await expect(second.getByRole('button', { name: 'New version 99.0.0 available – click to update' })).toBeVisible()
    expect(buildInfoRequests).toHaveLength(1)
  })
})
