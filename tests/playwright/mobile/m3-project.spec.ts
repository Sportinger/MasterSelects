import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PHONE_PROJECT_TEST_IDS as PROJ } from '../../../src/components/mobileSkin/project/phoneProjectTestIds'
import { PHONE_LIBRARY_TEST_IDS as LIB } from '../../../src/components/mobileSkin/library/phoneLibraryTestIds'
import { COMP_HEIGHT, COMP_WIDTH, FPS, IDS, M1_IDS, expect, tapForDownload, tapOn, test, waitForIdle, type M1Session } from './m1Fixture'
import { closeSheets, libraryState, sheetSettled } from './m3LibraryFixture'

/**
 * M3 project tools of the phone skin (packet Q4) in the project sheet: Library and Settings entries
 * with project info, named versions (save, survive a later change, restore), the .msproj archive
 * (save as a download, share through a stubbed share sheet) and Duplicate (the copy takes later
 * changes, the original stays as it was). The duplicate case runs last and reopens the original
 * project, so the shared world continues where it was.
 */
test.describe.configure({ timeout: 180_000 })

async function openProjectSheet(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.projectName))
  await expect(m1.page.getByTestId(PROJ.tools)).toBeVisible()
  await sheetSettled(m1)
}

async function newComposition(m1: M1Session, name: string): Promise<void> {
  await m1.bridge.toolData('createComposition', { name, width: COMP_WIDTH, height: COMP_HEIGHT, frameRate: FPS, duration: 10 })
  await expect.poll(async () => (await libraryState(m1.page)).compositions.some(comp => comp.name === name), { message: `composition ${name} exists` }).toBe(true)
  await waitForIdle(m1)
}

test('INV6/project-sheet-entries: the project sheet opens the Library and shows project info @phone', async ({ m1 }) => {
  await openProjectSheet(m1)
  await expect(m1.page.getByTestId(PROJ.info)).toContainText(/\d+ compositions? · \d+ media/)
  await tapOn(m1, m1.page.getByTestId(PROJ.openLibrary))
  await expect(m1.page.getByTestId(LIB.root), 'Library opened from the project sheet').toBeVisible()
  await closeSheets(m1)
})

test('INV6/named-project-versions: a saved version survives a later change and restores exactly @phone', async ({ m1 }) => {
  const name = `Version ${randomUUID().slice(0, 6)}`
  const later = `Later ${randomUUID().slice(0, 6)}`
  const before = await libraryState(m1.page)
  await openProjectSheet(m1)
  await tapOn(m1, m1.page.getByTestId(PROJ.versions))
  await m1.page.getByTestId(PROJ.versionName).fill(name)
  await tapOn(m1, m1.page.getByTestId(PROJ.versionSave))
  await expect(m1.page.getByTestId(PROJ.status)).toContainText(`Version "${name}" saved`, { timeout: 30_000 })
  await expect(m1.page.getByTestId(PROJ.versionRow).filter({ hasText: name })).toContainText('showing now')
  await closeSheets(m1)

  await newComposition(m1, later)

  await openProjectSheet(m1)
  await tapOn(m1, m1.page.getByTestId(PROJ.versions))
  const versionRow = m1.page.getByTestId(PROJ.versionRow).filter({ hasText: name })
  await expect(versionRow).toContainText('tap to restore')
  await tapOn(m1, versionRow.getByRole('button'))
  await expect(m1.page.getByTestId(PROJ.status)).toContainText(`Restored "${name}"`, { timeout: 30_000 })
  await closeSheets(m1)
  await expect.poll(async () => (await libraryState(m1.page)).compositions.some(comp => comp.name === later), { message: 'the later composition is gone after restoring' }).toBe(false)
  const restored = await libraryState(m1.page)
  expect(restored.compositions.map(comp => comp.id).toSorted(), 'the compositions are exactly the saved ones').toEqual(before.compositions.map(comp => comp.id).toSorted())
  expect(restored.files.length).toBe(before.files.length)
  await waitForIdle(m1)
})

test('INV6/project-archive-export: Export .msproj saves a zip archive and hands a File to the share sheet @phone', async ({ m1 }, testInfo) => {
  await openProjectSheet(m1)
  await tapOn(m1, m1.page.getByTestId(PROJ.archive))
  await tapOn(m1, m1.page.getByTestId(PROJ.archiveMedia))
  await expect(m1.page.getByTestId(PROJ.archiveMedia)).toHaveAttribute('aria-checked', 'false')
  await tapOn(m1, m1.page.getByTestId(PROJ.archivePrepare))
  await expect(m1.page.getByTestId(PROJ.archiveSave), 'the archive was built').toBeVisible({ timeout: 90_000 })
  const { file, suggested } = await tapForDownload(m1, m1.page.getByTestId(PROJ.archiveSave), testInfo, 'project')
  expect(suggested).toMatch(/\.msproj$/)
  const bytes = await readFile(file)
  expect(bytes.length).toBeGreaterThan(100)
  expect(bytes.subarray(0, 2).toString('latin1'), 'the archive is a zip').toBe('PK')

  await m1.page.evaluate(() => {
    const target = navigator as Navigator & { __shared?: { name: string; size: number } }
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => { const shared = data.files?.[0]; target.__shared = shared ? { name: shared.name, size: shared.size } : undefined } })
  })
  try {
    await tapOn(m1, m1.page.getByTestId(PROJ.archiveShare))
    await expect(m1.page.getByTestId(PROJ.status)).toContainText('Shared')
    const shared = await m1.page.evaluate(() => (navigator as Navigator & { __shared?: { name: string; size: number } }).__shared)
    expect(shared?.name).toBe(suggested)
    expect(shared?.size).toBe(bytes.length)
  } finally {
    await m1.page.evaluate(() => {
      Reflect.deleteProperty(navigator, 'canShare')
      Reflect.deleteProperty(navigator, 'share')
    })
  }
  await closeSheets(m1)
})

test('INV6/rename-and-duplicate-project: the copy takes later changes, the original stays as it was @phone', async ({ m1 }) => {
  const original = await libraryState(m1.page)
  const copyName = `${original.projectName} copy ${randomUUID().slice(0, 4)}`
  const onlyInCopy = `Copy only ${randomUUID().slice(0, 6)}`
  await openProjectSheet(m1)
  await tapOn(m1, m1.page.getByTestId(PROJ.duplicate))
  await m1.page.getByTestId(PROJ.duplicateName).fill(copyName)
  await tapOn(m1, m1.page.getByTestId(PROJ.duplicateCreate))
  await expect.poll(async () => (await libraryState(m1.page)).projectName, { timeout: 60_000, message: 'editing the copy now' }).toBe(copyName)
  await closeSheets(m1)
  await waitForIdle(m1)
  const copy = await libraryState(m1.page)
  expect(copy.compositions.length, 'the copy has the same compositions').toBe(original.compositions.length)
  expect(copy.files.length, 'and the same media').toBe(original.files.length)
  await newComposition(m1, onlyInCopy)

  // Back to the original through the phone UI.
  await openProjectSheet(m1)
  await tapOn(m1, m1.page.getByRole('button', { name: 'Back to projects' }))
  await expect(m1.page.getByTestId(M1_IDS.home)).toBeVisible({ timeout: 60_000 })
  await expect(m1.page.getByTestId(M1_IDS.projectRow).filter({ hasText: copyName }), 'the copy is listed').toHaveCount(1)
  await tapOn(m1, m1.page.getByTestId(M1_IDS.projectRow).filter({ hasText: original.projectName }).filter({ hasNotText: 'copy' }).first())
  await expect(m1.page.getByTestId(IDS.timeline)).toBeVisible({ timeout: 60_000 })
  await m1.bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
  await m1.bridge.authenticate()
  await waitForIdle(m1)
  await expect.poll(async () => (await libraryState(m1.page)).projectName, { message: 'the original is open again' }).toBe(original.projectName)
  const reopened = await libraryState(m1.page)
  expect(reopened.compositions.some(comp => comp.name === onlyInCopy), 'the change made in the copy is not in the original').toBe(false)
  expect(reopened.files.length).toBe(original.files.length)
})
