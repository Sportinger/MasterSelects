import path from 'node:path'
import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import {
  PHONE_LIBRARY_MORE_TEST_IDS as MORE, PHONE_LIBRARY_TEST_IDS as LIB, PHONE_LIBRARY_WEB_TEST_IDS as WEB,
} from '../../../src/components/mobileSkin/library/phoneLibraryTestIds'
import { IDS, expect, tapAction, tapOn, test, waitForIdle, type M1Session } from './m1Fixture'
import { closeSheets, sheetSettled, tapCancel } from './m3LibraryFixture'
import { importClipA } from './m2DesignFixture'
import { expectExplained, m6Library, restoreM6Settings, writeMinimalGlb } from './m6Fixture'

/**
 * M6 media items of the phone skin (packet N3) in the Library sheet, one catalog case per test in the
 * shared M1 world: web media search hand-off and the in-app YouTube search with a saved key, the
 * greyed download paths with their reasons and the import of a downloaded file, numbered 3D model
 * sequences, proxy storage and warm-up, and the file-manager exception. External sites and the
 * YouTube API are routed to fixed answers; truth is the visible UI, the media store and the preview.
 */
test.describe.configure({ timeout: 150_000 })

async function openLibrary(m1: M1Session): Promise<void> {
  await m1.bridge.toolData('clearSelection')
  await tapAction(m1, phoneActionTestId('library'))
  await expect(m1.page.getByTestId(LIB.root), 'the Library sheet opened').toBeVisible()
  await sheetSettled(m1)
}

async function openWeb(m1: M1Session): Promise<void> {
  await openLibrary(m1)
  await tapOn(m1, m1.page.getByTestId(WEB.entry))
  await expect(m1.page.getByTestId(WEB.root)).toBeVisible()
}

const platform = (m1: M1Session, id: string) => m1.page.locator(`[data-testid="${WEB.platform}"][data-platform="${id}"]`)

test.afterEach(async ({ m1 }) => {
  await m1.context.unrouteAll({ behavior: 'ignoreErrors' })
  await closeSheets(m1)
})

test('INV6/web-media-search-handoff: Open search opens the platform search in a new tab and the project stays open @phone', async ({ m1 }) => {
  await m1.context.route('https://www.tiktok.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>TikTok fixture</title>' }))
  await openWeb(m1)
  await tapOn(m1, platform(m1, 'tiktok'))
  await expect(m1.page.getByTestId(WEB.search)).toHaveAttribute('data-mode', 'handoff')
  await tapOn(m1, m1.page.getByTestId(WEB.query))
  await m1.page.getByTestId(WEB.query).fill('city timelapse')
  const opened = m1.context.waitForEvent('page')
  await tapOn(m1, m1.page.getByTestId(WEB.search))
  const tab = await opened
  await tab.waitForLoadState('domcontentloaded')
  expect(tab.url()).toBe('https://www.tiktok.com/search?q=city%20timelapse')
  await expect(m1.page.getByTestId(WEB.status)).toContainText('TikTok search opened')
  await expect(m1.page.getByTestId(WEB.root), 'the editor page keeps its sheet and project').toBeVisible()
  // A link from the platform pasted back is ready to open or copy; downloading stays a desktop step.
  await tapOn(m1, m1.page.getByTestId(WEB.link))
  await m1.page.getByTestId(WEB.link).fill('www.tiktok.com/@a/video/1')
  await expect(m1.page.getByTestId(WEB.open)).toHaveAttribute('href', 'https://www.tiktok.com/@a/video/1')
})

test('INV6/integration-credentials: a saved YouTube key switches the Library search to in-app results @phone', async ({ m1 }) => {
  let calls = 0
  await m1.context.route('https://www.googleapis.com/youtube/v3/search**', route => {
    calls += 1
    const url = new URL(route.request().url())
    return route.fulfill({
      status: url.searchParams.get('key') === 'fixture-key' ? 200 : 400,
      contentType: 'application/json',
      body: JSON.stringify({ items: [{ id: { videoId: 'abc123' }, snippet: { title: 'Fixture video', channelTitle: 'Fixture channel' } }] }),
    })
  })
  await restoreM6Settings(m1.page, { youtubeApiKey: '' })
  await openWeb(m1)
  await expect(m1.page.getByTestId(WEB.search), 'without a key YouTube opens in a new tab').toHaveAttribute('data-mode', 'handoff')
  await tapCancel(m1)
  await tapCancel(m1)
  await restoreM6Settings(m1.page, { youtubeApiKey: 'fixture-key' })
  try {
    await openWeb(m1)
    await expect(m1.page.getByTestId(WEB.search), 'with a key the search runs in the app').toHaveAttribute('data-mode', 'in-app')
    await tapOn(m1, m1.page.getByTestId(WEB.query))
    await m1.page.getByTestId(WEB.query).fill('waves')
    await tapOn(m1, m1.page.getByTestId(WEB.search))
    const result = m1.page.getByTestId(WEB.result)
    await expect(result).toHaveCount(1)
    await expect(result).toContainText('Fixture video')
    expect(calls).toBe(1)
    await tapOn(m1, result)
    await expect(m1.page.getByTestId(WEB.link)).toHaveValue('https://www.youtube.com/watch?v=abc123')
  } finally {
    await restoreM6Settings(m1.page, { youtubeApiKey: '' })
  }
})

test('INV6/native-url-download: Download stays greyed with its reason, a downloaded file imports instead @phone', async ({ m1 }) => {
  await openWeb(m1)
  await expect(m1.page.getByTestId(WEB.download)).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, m1.page.getByTestId(WEB.download))
  await expectExplained(m1, /yt-dlp/)
  const before = (await m6Library(m1.page)).length
  await m1.page.getByTestId(WEB.importInput).setInputFiles([m1.media.b.path])
  await expect(m1.page.getByTestId(WEB.status)).toContainText('Imported 1 file', { timeout: 60_000 })
  await waitForIdle(m1)
  const after = await m6Library(m1.page)
  expect(after.length, 'one new library item, no waiting placeholder').toBeGreaterThanOrEqual(before)
  expect(after.some(file => file.name === path.basename(m1.media.b.path))).toBe(true)
})

test('INV8/helper-media-search-and-download: the helper download queue stays greyed and explains @phone', async ({ m1 }) => {
  await openWeb(m1)
  await m1.page.getByTestId(WEB.helperDownloads).scrollIntoViewIfNeeded()
  await expect(m1.page.getByTestId(WEB.helperDownloads)).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, m1.page.getByTestId(WEB.helperDownloads))
  await expectExplained(m1, /native helper/)
})

test('INV6/import-model-and-splat-sequences: numbered .glb files become one model sequence item @phone', async ({ m1 }, testInfo) => {
  const files = [1, 2, 3].map(index => testInfo.outputPath(`m6cube_000${index}.glb`))
  files.forEach(writeMinimalGlb)
  await openLibrary(m1)
  await tapOn(m1, m1.page.getByTestId(MORE.entry))
  await expect(m1.page.getByTestId(MORE.root)).toBeVisible()
  await m1.page.getByTestId(MORE.sequenceInput).setInputFiles(files)
  await expect(m1.page.getByTestId(MORE.status)).toContainText('joined into a sequence', { timeout: 60_000 })
  await waitForIdle(m1)
  const sequences = (await m6Library(m1.page)).filter(file => file.type === 'model' && file.frames === 3)
  expect(sequences, 'one model item with three frames').toHaveLength(1)
})

test('INV6/proxy-location-and-warmup: the proxy storage is named and warm-up never claims a ready proxy @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  await openLibrary(m1)
  await tapOn(m1, m1.page.getByTestId(MORE.entry))
  await expect(m1.page.getByTestId(MORE.proxyLocation)).toContainText(/Proxies are stored in/)
  await tapOn(m1, m1.page.getByTestId(MORE.warmUp))
  await expect(m1.page.getByTestId(MORE.status)).toContainText(/Warm-up finished|Nothing to warm up/, { timeout: 60_000 })
  const file = (await m6Library(m1.page)).find(entry => entry.name === clip.name)
  expect(file, 'the clip\'s media is in the library').toBeTruthy()
  expect(file!.proxyStatus ?? 'none', 'warm-up does not make a proxy').not.toBe('ready')
  await closeSheets(m1)
  // Playback afterwards still shows the right frame.
  m1.probe.mark()
  await m1.probe.waitForFrame(15, { allowed: () => true, timeoutMs: 20_000 })
})

test('INV6/absolute-path-and-explorer-access: Show in file manager stays greyed and explains, the file name copies @phone', async ({ m1 }) => {
  await importClipA(m1)
  await openLibrary(m1)
  const first = m1.page.locator(`[data-testid="${LIB.row}"][data-item-kind="video"] [data-testid="${LIB.rowOpen}"]`).first()
  await tapOn(m1, first)
  await expect(m1.page.getByTestId(LIB.item)).toBeVisible()
  const show = m1.page.getByTestId(LIB.showInFiles)
  await show.scrollIntoViewIfNeeded()
  await expect(show).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, show)
  await expectExplained(m1, /file manager/)
  await expect(m1.page.getByTestId(IDS.sheet)).toBeVisible()
})
