import { PHONE_PROJECT_TEST_IDS as PROJ } from '../../../src/components/mobileSkin/project/phoneProjectTestIds'
import { PHONE_HELP_TEST_IDS as HELP } from '../../../src/components/mobileSkin/settings/phoneHelpTestIds'
import { PHONE_SETTINGS_TEST_IDS as SET } from '../../../src/components/mobileSkin/settings/phoneSettingsTestIds'
import { PHONE_TOUCH_DISPLAY_TEST_IDS as TOUCH } from '../../../src/components/mobileSkin/preview/phoneTouchDisplayIds'
import { IDS, expect, tapOn, test, type M1Session } from './m1Fixture'
import { closeSheets, sheetSettled, tapCancel, tapDone } from './m3LibraryFixture'
import { expectExplained, m6Settings, restoreM6Settings } from './m6Fixture'

/**
 * M6 settings items of the phone skin (packet N3), one catalog case per test in the shared M1 world:
 * touch and input display, the assistant's action replay, integration credentials (stored like the
 * desktop), MIDI availability and the greyed exceptions (second screen, OptiX, local models, native
 * helper) with their reasons. Settings are a draft: Cancel keeps, Done writes; truth is the shared
 * settings store read by a probe, and the visible UI.
 */
test.describe.configure({ timeout: 120_000 })

const DEFAULTS = { showShortcutDisplay: false, shortcutDisplayScale: 1, replayMode: 'concise', replayBudgetMs: 3000, replayCompression: 'family', youtubeApiKey: '' }

async function openSettings(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.projectName))
  await expect(m1.page.getByTestId(PROJ.tools), 'the project sheet shows its tools').toBeVisible()
  await sheetSettled(m1)
  await tapOn(m1, m1.page.getByTestId(PROJ.openSettings))
  await expect(m1.page.getByTestId(SET.root), 'Settings opened from the project sheet').toBeVisible()
  await sheetSettled(m1)
}

const chip = (m1: M1Session, testId: string, value: string) => m1.page.locator(`[data-testid="${testId}"][data-value="${value}"]`)

test.afterEach(async ({ m1 }) => {
  await closeSheets(m1)
  await restoreM6Settings(m1.page, DEFAULTS)
})

test('INV6/touch-and-input-display: Show touches rings every finger at the chosen size without blocking controls @phone', async ({ m1 }) => {
  await restoreM6Settings(m1.page, DEFAULTS)
  await openSettings(m1)
  const toggle = m1.page.getByTestId(SET.showTouches)
  await toggle.scrollIntoViewIfNeeded()
  await tapOn(m1, toggle)
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  // The size slider: its sample ring shows the size directly.
  const slider = m1.page.getByTestId(SET.touchSize)
  await slider.scrollIntoViewIfNeeded()
  const box = (await slider.boundingBox())!
  await m1.touch.tap({ x: box.x + box.width - 6, y: box.y + box.height / 2 })
  await expect.poll(async () => Number(await m1.page.getByTestId(SET.touchSample).getAttribute('data-size')), { message: 'the sample did not grow with the size' }).toBeGreaterThan(80)
  // Cancel keeps the old setting.
  await tapCancel(m1)
  await expect.poll(async () => (await m6Settings(m1.page)).showShortcutDisplay).toBe(false)

  await openSettings(m1)
  await m1.page.getByTestId(SET.showTouches).scrollIntoViewIfNeeded()
  await tapOn(m1, m1.page.getByTestId(SET.showTouches))
  await tapDone(m1)
  await expect.poll(async () => (await m6Settings(m1.page)).showShortcutDisplay, { message: 'Done did not write Show touches' }).toBe(true)
  // A finger held on the screen gets a ring of 44 px at 100 %, centred under the finger.
  const preview = (await m1.page.getByTestId(IDS.previewRegion).boundingBox())!
  const finger = { x: Math.round(preview.x + preview.width / 2), y: Math.round(preview.y + preview.height / 2) }
  await m1.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...finger, id: 0, radiusX: 1, radiusY: 1, force: 1 }] })
  const dot = m1.page.getByTestId(TOUCH.dot)
  await expect(dot, 'the held finger shows a ring').toHaveAttribute('data-down', 'true')
  await expect(dot).toHaveAttribute('data-size', '44')
  const ring = (await dot.boundingBox())!
  expect(Math.abs(ring.x + ring.width / 2 - finger.x), 'the ring sits under the finger').toBeLessThan(2)
  expect(Math.abs(ring.width - 44)).toBeLessThan(1)
  await m1.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(dot, 'the ring leaves after the finger lifts').toHaveCount(0)
  // The display never takes a touch: a tapped control still works.
  await expect(m1.page.getByTestId(TOUCH.root)).toHaveCSS('pointer-events', 'none')
  await tapOn(m1, m1.page.getByTestId(IDS.projectName))
  await expect(m1.page.getByTestId(PROJ.tools), 'the tap still opened the project sheet').toBeVisible()
})

test('INV6/ai-replay-preferences: Cancel keeps the replay, Done writes mode, time and grouping, Reset returns to the defaults @phone', async ({ m1 }) => {
  await restoreM6Settings(m1.page, DEFAULTS)
  await openSettings(m1)
  await chip(m1, SET.replayMode, 'full').scrollIntoViewIfNeeded()
  await tapOn(m1, chip(m1, SET.replayMode, 'full'))
  await tapCancel(m1)
  await expect.poll(async () => (await m6Settings(m1.page)).replayMode).toBe('concise')

  await openSettings(m1)
  await chip(m1, SET.replayMode, 'full').scrollIntoViewIfNeeded()
  await tapOn(m1, chip(m1, SET.replayMode, 'full'))
  const budget = m1.page.getByTestId(SET.replayBudget)
  await tapOn(m1, budget)
  await budget.fill('2')
  await tapOn(m1, chip(m1, SET.replayUnit, 'min'))
  await tapOn(m1, chip(m1, SET.replayCompression, 'none'))
  await tapDone(m1)
  await expect.poll(() => m6Settings(m1.page), { message: 'Done did not write the replay preferences' })
    .toMatchObject({ replayMode: 'full', replayBudgetMs: 120_000, replayCompression: 'none' })

  await openSettings(m1)
  await m1.page.getByTestId(SET.replayReset).scrollIntoViewIfNeeded()
  await tapOn(m1, m1.page.getByTestId(SET.replayReset))
  await expect(chip(m1, SET.replayMode, 'concise')).toHaveAttribute('aria-checked', 'true')
  await tapDone(m1)
  await expect.poll(() => m6Settings(m1.page)).toMatchObject({ replayMode: 'concise', replayBudgetMs: 3000, replayCompression: 'family' })
})

test('INV6/integration-credentials: the key field is masked, Cancel keeps the old key, Save stores it like the desktop @phone', async ({ m1 }) => {
  await restoreM6Settings(m1.page, DEFAULTS)
  await openSettings(m1)
  await m1.page.getByTestId(SET.integrations).scrollIntoViewIfNeeded()
  await tapOn(m1, m1.page.getByTestId(SET.integrations))
  const field = m1.page.getByTestId(SET.youtubeKey)
  // The key sits in this browser's storage next to the key that unlocks it: the page promises no encryption.
  const page = m1.page.getByTestId(SET.integrationsPage)
  await expect(page).toContainText('kept only in this browser')
  await expect(page).not.toContainText(/encrypt/i)
  await expect(field, 'the key is hidden by default').toHaveAttribute('type', 'password')
  await tapOn(m1, field)
  await field.fill('test-key-123')
  await tapOn(m1, m1.page.getByTestId(SET.youtubeKeyShow))
  await expect(field).toHaveAttribute('type', 'text')
  await tapCancel(m1)
  await expect(m1.page.getByTestId(SET.root)).toBeVisible()
  expect((await m6Settings(m1.page)).youtubeApiKey, 'Cancel kept the old (empty) key').toBe('')

  await tapOn(m1, m1.page.getByTestId(SET.integrations))
  await tapOn(m1, m1.page.getByTestId(SET.youtubeKey))
  await m1.page.getByTestId(SET.youtubeKey).fill('test-key-123')
  await tapDone(m1)
  await expect(m1.page.getByTestId(SET.root), 'Save returns to Settings').toBeVisible()
  await expect(m1.page.getByTestId(SET.status)).toContainText('YouTube key saved')
  await expect.poll(async () => (await m6Settings(m1.page)).youtubeApiKey).toBe('test-key-123')
  // Stored by the desktop credential manager in this browser (IndexedDB), the same path as the desktop.
  const stored = await m1.page.evaluate(async () => {
    const { youtubeCredentialManager } = await import('/src/services/youtubeCredentialManager.ts' as string)
    return youtubeCredentialManager.get() as Promise<string | null>
  })
  expect(stored).toBe('test-key-123')
})

test('INV6/midi-device-preferences: Settings says whether this browser has Web MIDI and opens the MIDI page @phone', async ({ m1 }) => {
  await openSettings(m1)
  const midi = m1.page.locator(`[data-testid="${SET.desktopCategory}"][data-category="midi"]`)
  await midi.scrollIntoViewIfNeeded()
  const hasMidi = await m1.page.evaluate(() => 'requestMIDIAccess' in navigator)
  await expect(m1.page.getByTestId(SET.midiAvailability)).toContainText(hasMidi ? 'Web MIDI works' : 'No Web MIDI')
  await tapOn(m1, midi)
  await expect(m1.page.getByTestId(SET.desktopPage).locator('.settings-category-content')).toBeVisible({ timeout: 30_000 })
})

test('INV1/independent-external-display: Second screen output stays greyed and explains why @phone', async ({ m1 }) => {
  await openSettings(m1)
  const row = m1.page.getByTestId(SET.externalDisplay)
  await row.scrollIntoViewIfNeeded()
  await expect(row).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, row)
  await expectExplained(m1, /second screen/i)
})

test('INV5/native-optix-preview: the renderer is WebGPU, OptiX stays greyed with its reason @phone', async ({ m1 }) => {
  await openSettings(m1)
  await m1.page.getByTestId(SET.optix).scrollIntoViewIfNeeded()
  await expect(m1.page.getByTestId(SET.renderer)).toContainText('WebGPU')
  await tapOn(m1, m1.page.getByTestId(SET.optix))
  await expectExplained(m1, /OptiX.*NVIDIA/)
})

test('INV6/native-helper-and-native-model-management: native helper and local models stay greyed, no install button @phone', async ({ m1 }) => {
  await openSettings(m1)
  await m1.page.getByTestId(SET.localModels).scrollIntoViewIfNeeded()
  await tapOn(m1, m1.page.getByTestId(SET.localModels))
  await expectExplained(m1, /native helper/i)
  const helper = m1.page.locator(`[data-testid="${SET.desktopCategory}"][data-category="nativeHelper"]`)
  await helper.scrollIntoViewIfNeeded()
  await expect(helper).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, helper)
  await expectExplained(m1, /desktop program/i)
  // The native helper and the local models offer no install action of their own: the only /install/i
  // button in Settings is the Help row for the working PWA install page (Home screen icon).
  for (const area of [helper, m1.page.getByTestId(SET.localModels)]) {
    await expect(area.getByRole('button', { name: /install/i }), 'no install button pretends to work').toHaveCount(0)
  }
  const installIds = await m1.page.getByRole('button', { name: /install/i })
    .evaluateAll(buttons => buttons.map(button => button.getAttribute('data-testid')))
  expect(installIds.filter(id => id !== HELP.install), 'only the PWA install help row says install').toEqual([])
})

test('INV6/touch-and-input-display: goo touch feedback stays greyed on the phone and explains why @phone', async ({ m1 }) => {
  await openSettings(m1)
  await m1.page.getByTestId(SET.touchGoo).scrollIntoViewIfNeeded()
  await tapOn(m1, m1.page.getByTestId(SET.touchGoo))
  await expectExplained(m1, /Show touches/)
})
