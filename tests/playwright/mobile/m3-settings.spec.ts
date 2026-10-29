import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PHONE_SETTINGS_TEST_IDS as SET } from '../../../src/components/mobileSkin/settings/phoneSettingsTestIds'
import { PHONE_PROJECT_TEST_IDS as PROJ } from '../../../src/components/mobileSkin/project/phoneProjectTestIds'
import { PHONE_HOME_TEST_IDS } from '../../../src/components/mobileSkin/home/phoneHomeTestIds'
import { DEFAULT_REPO_ROOT } from '../fixtures/bridgeClient'
import { IDS, M1_IDS, ensureEditor, expect, tapOn, test, type M1Session } from './m1Fixture'
import { accountDialog, closeAccountDialog, closeSheets, restoreSettings, settingsState, sheetSettled, tapCancel, tapDone } from './m3LibraryFixture'

/**
 * M3 Settings acceptance of the phone skin (packet Q4): reached from the project sheet; theme and
 * transcription provider as a draft (Cancel keeps, Done writes), keyboard shortcuts greyed with a
 * reason, a support note that is only sent on Send and keeps its draft on a failed send, the cache
 * reset confirmation that names what goes (never executed here), version and update state,
 * diagnostics, the account dialog (opened and closed, login state untouched) and a desktop page.
 * Network answers that are not under test (support note, build info) are routed deterministically.
 */
test.describe.configure({ timeout: 120_000 })

async function openSettings(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.projectName))
  await expect(m1.page.getByTestId(PROJ.tools), 'the project sheet shows its tools').toBeVisible()
  await sheetSettled(m1)
  await tapOn(m1, m1.page.getByTestId(PROJ.openSettings))
  await expect(m1.page.getByTestId(SET.root), 'Settings opened from the project sheet').toBeVisible()
  await sheetSettled(m1)
}

const themeChip = (m1: M1Session, theme: string) => m1.page.locator(`[data-testid="${SET.themeChip}"][data-theme="${theme}"]`)

test('INV6/themes-and-custom-colors: Cancel keeps the theme, Done writes it and the custom colours, and it is restored afterwards @phone', async ({ m1 }) => {
  const original = await settingsState(m1.page)
  const other = original.theme === 'midnight' ? 'light' : 'midnight'
  await openSettings(m1)
  await tapOn(m1, themeChip(m1, other))
  await expect(themeChip(m1, other)).toHaveAttribute('aria-pressed', 'true')
  await tapCancel(m1)
  await expect(m1.sheet).toBeHidden()
  expect((await settingsState(m1.page)).theme, 'Cancel kept the theme').toBe(original.theme)

  await openSettings(m1)
  await tapOn(m1, themeChip(m1, 'custom'))
  // Real touch near the right end of the hue slider.
  const hue = m1.page.getByTestId(SET.customHue)
  await hue.scrollIntoViewIfNeeded()
  const box = (await hue.boundingBox())!
  await m1.touch.tap({ x: box.x + box.width * 0.95, y: box.y + box.height / 2 })
  await expect.poll(async () => Number(await hue.inputValue()), { message: 'the hue slider followed the touch' }).toBeGreaterThan(300)
  const drafted = Number(await hue.inputValue())
  expect((await settingsState(m1.page)).theme, 'nothing is written before Done').toBe(original.theme)
  await tapDone(m1)
  await expect(m1.sheet).toBeHidden()
  expect(await settingsState(m1.page), 'Done wrote theme and hue').toMatchObject({ theme: 'custom', customHue: drafted })

  // Leave the shared world as it was: the theme through the same sheet, the hue as cleanup.
  await openSettings(m1)
  await tapOn(m1, themeChip(m1, original.theme))
  await tapDone(m1)
  await expect(m1.sheet).toBeHidden()
  await restoreSettings(m1.page, { customHue: original.customHue })
  expect(await settingsState(m1.page)).toMatchObject({ theme: original.theme, customHue: original.customHue })
})

test('INV6/transcription-provider-settings: Cancel keeps, Done saves an allowed provider, a hosted one without account explains why @phone', async ({ m1 }) => {
  const original = (await settingsState(m1.page)).transcriptionProvider
  const option = (id: string) => m1.page.locator(`[data-testid="${SET.transcription}"][data-provider="${id}"]`)
  await openSettings(m1)
  const hostedLocked = await option('deepgram').getAttribute('aria-disabled') === 'true'
  if (hostedLocked) {
    // No hosted session: hosted providers stay visible, greyed, and say why; tapping one picks nothing.
    await tapOn(m1, option('deepgram'))
    await expect(m1.page.getByTestId(SET.status)).toContainText('Sign in')
    await expect(option('deepgram')).toHaveAttribute('aria-checked', 'false')
  }
  const target = original === 'local' ? 'deepgram' : 'local'
  test.skip(hostedLocked && target === 'deepgram', 'no second provider is allowed without an account')
  await tapOn(m1, option(target))
  await expect(option(target)).toHaveAttribute('aria-checked', 'true')
  await tapCancel(m1)
  await expect(m1.sheet).toBeHidden()
  expect((await settingsState(m1.page)).transcriptionProvider, 'Cancel kept the provider').toBe(original)

  await openSettings(m1)
  await tapOn(m1, option(target))
  await tapDone(m1)
  await expect(m1.sheet).toBeHidden()
  expect((await settingsState(m1.page)).transcriptionProvider, 'Done saved the provider').toBe(target)
  await restoreSettings(m1.page, { transcriptionProvider: original })
  expect((await settingsState(m1.page)).transcriptionProvider).toBe(original)
})

test('INV6/transcription-provider-settings: a stored hosted provider without account stays marked, greyed, and says transcription waits @phone', async ({ m1 }) => {
  const original = (await settingsState(m1.page)).transcriptionProvider
  const option = (id: string) => m1.page.locator(`[data-testid="${SET.transcription}"][data-provider="${id}"]`)
  try {
    await restoreSettings(m1.page, { transcriptionProvider: 'hybrid' })
    await openSettings(m1)
    test.skip(await option('hybrid').getAttribute('aria-disabled') !== 'true', 'a hosted session is active: hosted providers can run')
    // Same truth as Captions: nothing falls back to On this device, so that option is not marked.
    await expect(option('hybrid')).toHaveAttribute('aria-checked', 'true')
    await expect(option('local')).toHaveAttribute('aria-checked', 'false')
    await expect(m1.page.getByTestId(SET.transcriptionNote)).toContainText('sign in')
    await tapCancel(m1)
    await expect(m1.sheet).toBeHidden()
  } finally {
    await restoreSettings(m1.page, { transcriptionProvider: original })
  }
})

test('INV6/keyboard-shortcuts: stays visible, greyed, and says it needs a keyboard @phone', async ({ m1 }) => {
  await openSettings(m1)
  const row = m1.page.getByTestId(SET.shortcuts)
  await expect(row).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, row)
  const notice = m1.page.getByTestId(IDS.unavailableNotice)
  await expect(notice).toContainText('need a keyboard')
  await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
  await expect(notice).toBeHidden()
  await closeSheets(m1)
})

test('INV6/leave-note-and-report-issue: Cancel sends nothing, a failed send keeps the draft, a retry succeeds @phone', async ({ m1 }) => {
  let requests = 0
  let fail = true
  await m1.page.route('**/api/support/note', async (route) => {
    requests++
    await route.fulfill(fail
      ? { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Service unavailable' }) }
      : { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  try {
    await openSettings(m1)
    await expect(m1.page.getByTestId(SET.writeIssue)).toHaveAttribute('href', /github\.com/)
    await tapOn(m1, m1.page.getByTestId(SET.leaveNote))
    await m1.page.getByTestId(SET.noteInput).fill('Draft that is never sent')
    await tapCancel(m1)
    await expect(m1.page.getByTestId(SET.root)).toBeVisible()
    expect(requests, 'Cancel sent nothing').toBe(0)

    await tapOn(m1, m1.page.getByTestId(SET.leaveNote))
    await m1.page.getByTestId(SET.noteInput).fill('Phone note from the M3 journey')
    await tapOn(m1, m1.page.getByTestId(SET.noteSend))
    await expect(m1.page.getByTestId(SET.status)).toContainText('Not sent')
    expect(requests).toBe(1)
    await expect(m1.page.getByTestId(SET.noteInput), 'the draft stays after a failed send').toHaveValue('Phone note from the M3 journey')

    fail = false
    await tapOn(m1, m1.page.getByTestId(SET.noteSend))
    await expect(m1.page.getByTestId(SET.status)).toContainText('was sent')
    expect(requests).toBe(2)
    await closeSheets(m1)
  } finally {
    await m1.page.unroute('**/api/support/note')
  }
})

test('INV6/cache-reset: the confirmation names what goes and what stays, Keep changes nothing @phone', async ({ m1 }) => {
  const keys = await m1.page.evaluate(() => Object.keys(window.localStorage).length)
  await openSettings(m1)
  await tapOn(m1, m1.page.getByTestId(SET.cacheReset))
  await expect(m1.sheet).toContainText('your settings and preferences')
  await expect(m1.sheet).toContainText('Kept: projects stored in this browser')
  await tapOn(m1, m1.page.getByTestId(SET.cacheResetKeep))
  await expect(m1.page.getByTestId(SET.root)).toBeVisible()
  expect(await m1.page.evaluate(() => Object.keys(window.localStorage).length), 'nothing was cleared').toBe(keys)
  await closeSheets(m1)
})

// The check is the shared one of the desktop brand: the dev server keeps it off unless `ms.updateCheck.enabled`
// is set, and a version it finds also shows the top bar's Update button. Save and reload brings the editor
// back without the announced version, so the next case starts from the running build again.
test('INV6/app-version-and-update-state: shows the loaded version and reports a newer build @phone', async ({ m1 }) => {
  const version = (JSON.parse(readFileSync(path.join(DEFAULT_REPO_ROOT, 'package.json'), 'utf8')) as { version: string }).version
  await m1.page.route('**/build-info.json*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '99.0.0', buildId: 'newer-build' }) }))
  try {
    await openSettings(m1)
    await expect(m1.page.getByTestId(SET.version)).toContainText(version)
    await tapOn(m1, m1.page.getByTestId(SET.checkUpdate))
    await expect(m1.sheet).toContainText('Update checks are off in this browser.')
    await m1.page.evaluate(() => window.localStorage.setItem('ms.updateCheck.enabled', 'true'))
    await tapOn(m1, m1.page.getByTestId(SET.checkUpdate))
    await expect(m1.sheet).toContainText('Version 99.0.0 is ready')
    await expect(m1.page.getByTestId('phone-topbar-update'), 'the top bar learns the same answer').toBeVisible()
    await m1.page.evaluate(() => window.localStorage.removeItem('ms.updateCheck.enabled'))
    await m1.page.unroute('**/build-info.json*')
    const reloaded = m1.page.waitForEvent('framenavigated', { predicate: frame => frame === m1.page.mainFrame() })
    await tapOn(m1, m1.page.getByTestId(SET.reloadUpdate))
    await reloaded
    await ensureEditor(m1)
  } finally {
    await m1.page.unroute('**/build-info.json*')
    await m1.page.evaluate(() => window.localStorage.removeItem('ms.updateCheck.enabled')).catch(() => undefined)
  }
  await expect(m1.page.getByTestId('phone-topbar-update')).toHaveCount(0)
  await m1.bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
  await m1.bridge.authenticate()
})

// A deploy while the phone editor is open (docs/Features/App-Updates.md). The dev server has no build info
// and keeps the background check off unless `ms.updateCheck.enabled` is set; the case sets it, routes a newer
// release and triggers the check the way a returning connection does. The tap reloads the page, so the case
// brings the editor back itself.
test('INV6/update-button-in-top-bar: a newly deployed version shows the glowing Update button; a tap saves and reloads @phone', async ({ m1 }, testInfo) => {
  const update = m1.page.getByTestId('phone-topbar-update')
  const revision = 'e'.repeat(40)
  await expect(update, 'no Update button while the running build is served').toHaveCount(0)
  await m1.page.route('**/build-info.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ schema: 'masterselects-build/v1', version: '99.0.0', buildId: '2099-01-01T00:00:00.000Z', sourceRevision: revision, sourceDirty: false, releaseId: `masterselects-99.0.0-${revision}` }),
  }))
  try {
    await m1.page.evaluate(() => {
      window.localStorage.setItem('ms.updateCheck.enabled', 'true')
      window.dispatchEvent(new Event('online'))
    })
    await expect(update).toBeVisible()
    await expect(update).toHaveAttribute('aria-label', 'New version 99.0.0 available – tap to update')
    expect(await update.evaluate(element => getComputedStyle(element, '::before').animationName)).toBe('phone-update-glow')
    // The icon really is drawn in the update colour (a later stylesheet once painted it white).
    const colors = await update.evaluate((element) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--phone-update)'
      element.parentElement!.appendChild(probe)
      const expected = getComputedStyle(probe).color
      probe.remove()
      return { actual: getComputedStyle(element).color, expected }
    })
    expect(colors.actual, 'the Update icon uses --phone-update').toBe(colors.expected)
    const shot = testInfo.outputPath('phone-update-button.png')
    await m1.page.getByTestId(IDS.topBar).screenshot({ path: shot })
    await testInfo.attach('phone-update-button.png', { path: shot, contentType: 'image/png' })

    await m1.page.evaluate(() => { (window as unknown as { __beforeUpdateReload?: boolean }).__beforeUpdateReload = true })
    const reloaded = m1.page.waitForEvent('framenavigated', { predicate: frame => frame === m1.page.mainFrame() })
    await tapOn(m1, update)
    await reloaded
    await ensureEditor(m1)
    expect(await m1.page.evaluate(() => (window as unknown as { __beforeUpdateReload?: boolean }).__beforeUpdateReload), 'the page reloaded').toBeUndefined()
  } finally {
    await m1.page.unroute('**/build-info.json*')
  }
  await m1.page.evaluate(() => window.localStorage.removeItem('ms.updateCheck.enabled'))
  await m1.bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
  await m1.bridge.authenticate()
})

test('INV6/runtime-health-and-diagnostics: the diagnostics page reports the preview engine and storage @phone', async ({ m1 }) => {
  await openSettings(m1)
  await tapOn(m1, m1.page.getByTestId(SET.diagnostics))
  const rows = m1.page.getByTestId(SET.diagnosticsRows)
  await expect(rows).toContainText('Preview engine')
  await expect(rows).toContainText('Ready')
  await expect(rows).toContainText('Storage')
  await closeSheets(m1)
})

test('INV8/hosted-access-and-credits: Account opens the account dialog and closes again without touching the login @phone', async ({ m1 }) => {
  await openSettings(m1)
  await tapOn(m1, m1.page.getByTestId(SET.account))
  await expect.poll(() => accountDialog(m1.page), { message: 'an account dialog opened' }).not.toBeNull()
  await expect(m1.page.locator('.account-dialog-host').first()).toBeVisible()
  await closeAccountDialog(m1.page)
  await expect(m1.page.locator('.account-dialog-host')).toHaveCount(0)
  await closeSheets(m1)
})

test('INV6/more-settings: a desktop settings page opens inside the phone @phone', async ({ m1 }) => {
  await openSettings(m1)
  await tapOn(m1, m1.page.locator(`[data-testid="${SET.desktopCategory}"][data-category="general"]`))
  await expect(m1.page.getByTestId(SET.desktopPage).locator('.settings-category-content')).toBeVisible({ timeout: 30_000 })
  await tapCancel(m1)
  await expect(m1.page.getByTestId(SET.root)).toBeVisible()
  const helper = m1.page.locator(`[data-testid="${SET.desktopCategory}"][data-category="nativeHelper"]`)
  await expect(helper).toHaveAttribute('aria-disabled', 'true')
  await closeSheets(m1)
})

test('INV6/settings-from-home: the home screen reaches Settings with and without an open project @phone', async ({ m1 }) => {
  const home = m1.page.getByTestId(M1_IDS.home)
  const backToEditing = m1.page.getByRole('button', { name: 'Back to editing' })
  const settingsFromHome = async () => {
    await tapOn(m1, m1.page.getByTestId(PHONE_HOME_TEST_IDS.settings))
    await expect(m1.page.getByTestId(SET.root), 'Settings opened over the home screen').toBeVisible()
    await sheetSettled(m1)
    await tapCancel(m1)
    await expect(m1.page.getByTestId(SET.root)).toHaveCount(0)
    await expect(home, 'closing Settings returns to the home screen').toBeVisible()
  }

  // Project open: the top bar's Projects keeps it open, so the home offers Back to editing.
  await tapOn(m1, m1.page.getByTestId('phone-topbar-projects'))
  await expect(home).toBeVisible({ timeout: 60_000 })
  await settingsFromHome()
  await tapOn(m1, backToEditing)
  await expect(home, 'Back to editing returns to the open project').toHaveCount(0)

  // Back to projects closes the project: the home must know at once (no polling wait), so it never
  // shows a Back to editing button that does nothing.
  await tapOn(m1, m1.page.getByTestId(IDS.projectName))
  await expect(m1.page.getByTestId(PROJ.tools), 'the project sheet shows its tools').toBeVisible()
  await sheetSettled(m1)
  await tapOn(m1, m1.page.getByRole('button', { name: 'Back to projects' }))
  await expect(home).toBeVisible({ timeout: 60_000 })
  expect(await backToEditing.count(), 'no Back to editing right after the project closed').toBe(0)
  await settingsFromHome()
  await expect(backToEditing, 'still no Back to editing without an open project').toHaveCount(0)
})
