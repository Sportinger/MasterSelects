import { PHONE_M1_TEST_IDS, phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import {
  PHONE_ASSISTANT_TEST_IDS as ASSIST, PHONE_ASSISTANT_VARIANTS_TEST_IDS as VARIANTS, PHONE_VARIANTS_PROMPT,
} from '../../../src/components/mobileSkin/assistant/phoneAssistantTestIds'
import { PHONE_EXPORT_TEST_IDS as EXPORT } from '../../../src/components/mobileSkin/export/phoneExportTestIds'
import { PHONE_HOME_TEST_IDS as HOME, PHONE_WELCOME_STORAGE_KEY } from '../../../src/components/mobileSkin/home/phoneHomeTestIds'
import { PHONE_PROJECT_STORAGE_TEST_IDS as STORAGE } from '../../../src/components/mobileSkin/project/phoneProjectTestIds'
import { PHONE_HELP_TEST_IDS as HELP } from '../../../src/components/mobileSkin/settings/phoneHelpTestIds'
import {
  IDS, M1_IDS, TOPBAR_EXPORT, expect, importViaSheet, probeVideo, tapAction, tapForDownload, tapOn, test, waitForIdle,
} from './m1Fixture'
import { closeSheets, sheetSettled } from './m3LibraryFixture'
import { expectExplained } from './m6Fixture'
import {
  g6ActiveComposition, g6ClearVariants, g6Clips, g6SeedVariants, g6Signature, openProjectSheet, openSettings,
} from './m7MediaFixture'

/**
 * G6 app chrome, assistant extras and export journeys of the phone skin, one catalog case per test
 * in the shared M1 world: install the web app, legal pages, the first-run welcome, the developer chat,
 * temporary projects, the folder backup, timeline variants in the assistant and keeping the rendered
 * part of an export. Truth is the visible UI, stores, network requests and the exported file.
 */
test.describe.configure({ timeout: 180_000 })

test.afterEach(async ({ m1 }) => {
  await m1.context.unrouteAll({ behavior: 'ignoreErrors' })
  await closeSheets(m1)
})

test('INV6/install-web-app: the install page is honest without an offer and installs through the browser dialog when offered @phone', async ({ m1 }) => {
  await openSettings(m1)
  await tapOn(m1, m1.page.getByTestId(HELP.install))
  const page = m1.page.getByTestId(HELP.installPage)
  await expect(page, 'no install offer: the manual steps show').toHaveAttribute('data-state', 'steps')
  await expect(m1.page.getByTestId(HELP.installSteps).locator('li')).toHaveCount(3)
  // The browser offers installing (its beforeinstallprompt event, captured by the editor at boot).
  await m1.page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
    event.prompt = async () => { (window as unknown as { __g6Prompted?: boolean }).__g6Prompted = true }
    event.userChoice = Promise.resolve({ outcome: 'accepted' })
    window.dispatchEvent(event)
  })
  await expect(page).toHaveAttribute('data-state', 'prompt')
  await tapOn(m1, m1.page.getByTestId(HELP.installButton))
  await expect(page, 'accepted: the page says it is installed').toHaveAttribute('data-state', 'installed')
  expect(await m1.page.evaluate(() => (window as unknown as { __g6Prompted?: boolean }).__g6Prompted)).toBe(true)
  await expect(m1.page.getByTestId(HELP.status)).toContainText('Installed')
})

test('INV6/legal-and-contact: every legal page opens readable from Settings, including cancelling a contract @phone', async ({ m1 }) => {
  await openSettings(m1)
  await tapOn(m1, m1.page.getByTestId(HELP.legal))
  await expect(m1.page.locator(`[data-testid="${HELP.legalRow}"]`)).toHaveCount(6)
  await tapOn(m1, m1.page.locator(`[data-testid="${HELP.legalRow}"][data-page="cancellation"]`))
  const dialog = m1.page.getByRole('dialog').filter({ has: m1.page.locator('.legal-tabs') })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('h2')).toHaveText(/Cancel contracts here|Verträge hier kündigen/)
  const box = await dialog.boundingBox()
  const viewport = m1.page.viewportSize()!
  expect(box!.width, 'the dialog fits the phone width').toBeLessThanOrEqual(viewport.width)
  await tapOn(m1, dialog.getByRole('button', { name: 'Close legal information' }))
  await expect(dialog).toBeHidden()
  await tapOn(m1, m1.page.locator(`[data-testid="${HELP.legalRow}"][data-page="contact"]`))
  await expect(dialog.locator('h2')).toHaveText(/Contact|Kontakt/)
  await tapOn(m1, dialog.getByRole('button', { name: 'Close legal information' }))
  await expect(dialog).toBeHidden()
  await expect(m1.page.getByTestId(HELP.legalPage), 'back on the phone page').toBeVisible()
})

test('INV6/first-run-onboarding: the welcome shows on the home, Skip and Start both lead on and the choice is remembered @phone', async ({ m1 }) => {
  await openSettings(m1)
  await tapOn(m1, m1.page.getByTestId(HELP.welcomeAgain))
  const welcome = m1.page.getByTestId(HOME.welcome)
  await expect(m1.page.getByTestId(M1_IDS.home)).toBeVisible()
  await expect(welcome).toBeVisible()
  await tapOn(m1, m1.page.getByTestId(HOME.welcomeSkip))
  await expect(welcome).toHaveCount(0)
  expect(await m1.page.evaluate((key) => window.localStorage.getItem(key), PHONE_WELCOME_STORAGE_KEY), 'remembered on this device').toBe('1')
  await expect(m1.page.getByTestId(M1_IDS.newProject), 'the home stays usable').toBeVisible()
  // Shown again, Start opens the new-project form.
  await tapOn(m1, m1.page.getByRole('button', { name: 'Back to editing' }))
  await expect(m1.page.getByTestId(IDS.timeline)).toBeVisible()
  await openSettings(m1)
  await tapOn(m1, m1.page.getByTestId(HELP.welcomeAgain))
  await tapOn(m1, m1.page.getByTestId(HOME.welcomeStart))
  await expect(m1.page.getByTestId(M1_IDS.createProject), 'Start opens the project setup').toBeVisible()
  await expect(welcome).toHaveCount(0)
  await tapOn(m1, m1.page.getByRole('button', { name: 'Back to editing' }))
  await expect(m1.page.getByTestId(IDS.timeline)).toBeVisible()
})

test('INV6/developer-chat: the developer chat opens from Settings, and opening or closing it sends nothing @phone', async ({ m1 }) => {
  const posts: string[] = []
  await m1.context.route('**/api/support/chat**', route => {
    if (route.request().method() !== 'GET') posts.push(route.request().method())
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [], cursor: 0 }) })
  })
  await openSettings(m1)
  await expect(m1.page.getByTestId(HELP.devChatUnread)).toHaveAttribute('data-unread', '0')
  await tapOn(m1, m1.page.getByTestId(HELP.devChat))
  const dialog = m1.page.locator('.dev-chat-dialog')
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box!.width, 'the chat fits the phone').toBeLessThanOrEqual(m1.page.viewportSize()!.width)
  await dialog.locator('textarea').fill('draft only')
  await tapOn(m1, dialog.locator('.dev-chat-close'))
  await expect(dialog).toBeHidden()
  expect(posts, 'nothing was sent').toEqual([])
})

test('INV6/migrate-temporary-projects: the project sheet lists temporary projects and explains why nothing moves when there are none @phone', async ({ m1 }) => {
  await openProjectSheet(m1)
  const list = m1.page.getByTestId(STORAGE.temporaryList)
  await expect(list).toHaveAttribute('data-count', '0')
  await expect(list).toContainText('No other temporary projects')
  const move = m1.page.getByTestId(STORAGE.temporaryMove)
  await expect(move).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, move)
  await expectExplained(m1, /No other project is in temporary storage/)
})

test('INV6/incremental-repository-backup: without a folder picker the folder backup stays visible, greyed, and says why @phone', async ({ m1 }) => {
  await openProjectSheet(m1)
  const backup = m1.page.getByTestId(STORAGE.backup)
  await expect(backup).toHaveAttribute('data-available', 'false')
  await expect(backup).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, backup)
  await expectExplained(m1, /no folder picker/)
})

test('INV8/assistant-timeline-variants: the assistant shows A/B/C, watching one opens its version and leaves the edit alone @phone', async ({ m1 }) => {
  await m1.bridge.toolData('clearSelection')
  await tapAction(m1, phoneActionTestId('assistant'))
  await expect(m1.page.getByTestId(ASSIST.root)).toBeVisible()
  // Without a comparison: one tap types the request, nothing is sent.
  await tapOn(m1, m1.page.getByTestId(VARIANTS.ask))
  await expect(m1.page.getByTestId(ASSIST.prompt)).toHaveValue(PHONE_VARIANTS_PROMPT)
  await expect(m1.page.getByTestId(ASSIST.message)).toHaveCount(0)
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden()
  const seeded = await g6SeedVariants(m1)
  try {
    const before = g6Signature(await g6Clips(m1.page))
    await tapAction(m1, phoneActionTestId('assistant'))
    const section = m1.page.getByTestId(VARIANTS.root)
    await expect(section).toHaveAttribute('data-variant-set', seeded.setId)
    await expect(section).toContainText('Balanced')
    await expect(section).toContainText('Dynamic')
    await expect(section).toContainText('Calm')
    await tapOn(m1, section.getByRole('tab', { name: /Option A/ }))
    await expect.poll(() => g6ActiveComposition(m1.page), { message: 'watching A opens its variant composition' }).toBe(seeded.variantCompId)
    await m1.bridge.toolData('openComposition', { compositionId: seeded.base })
    await expect.poll(() => g6ActiveComposition(m1.page)).toBe(seeded.base)
    expect(g6Signature(await g6Clips(m1.page)), 'the original edit is unchanged').toBe(before)
  } finally {
    // The editor refuses store writes while a composition switch is still landing; retry until it settles.
    await expect.poll(() => g6ClearVariants(m1.page, seeded.setId).then(() => true, () => false), { message: 'the seeded comparison is removed' }).toBe(true)
  }
})

test('INV7/finish-file-early: Keep rendered part ends the export with a shorter, playable file @phone', async ({ m1 }, testInfo) => {
  test.setTimeout(360_000)
  await importViaSheet(m1, { visual: [m1.media.a.path, m1.media.b.path, m1.media.a.path] }, { main: 3, total: 3 })
  await waitForIdle(m1)
  await tapOn(m1, m1.page.getByTestId(TOPBAR_EXPORT))
  await expect(m1.page.getByTestId(PHONE_M1_TEST_IDS.exportSummary)).toContainText(/\d/)
  const keep = m1.page.getByTestId(EXPORT.finishEarly)
  await tapOn(m1, m1.page.getByTestId(PHONE_M1_TEST_IDS.exportStart))
  await expect(keep, 'Keep rendered part becomes usable once frames are rendered').toHaveAttribute('aria-disabled', 'false', { timeout: 120_000 })
  await tapOn(m1, keep)
  await expect(m1.page.getByTestId(PHONE_M1_TEST_IDS.exportSave), 'the shortened file is finished').toHaveAttribute('aria-disabled', 'false', { timeout: 120_000 })
  await expect(m1.page.getByText(/^Shortened · /)).toBeVisible()
  const { file } = await tapForDownload(m1, m1.page.getByTestId(PHONE_M1_TEST_IDS.exportSave), testInfo, 'kept-part')
  const video = await probeVideo(file)
  expect(video.frames, 'the kept part has frames').toBeGreaterThan(0)
  expect(video.frames, 'and is shorter than the 11 s timeline').toBeLessThan(330)
  await sheetSettled(m1)
})
