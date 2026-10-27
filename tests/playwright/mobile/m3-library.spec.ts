import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_LIBRARY_TEST_IDS as LIB } from '../../../src/components/mobileSkin/library/phoneLibraryTestIds'
import { IDS, differingShare, expect, previewPixels, tapAction, tapOn, test, waitForIdle, type M1Session } from './m1Fixture'
import { closeSheets, committed, historyState, libraryState, tapCancel, tapDone, undoOnce, sheetSettled, type LibraryFile } from './m3LibraryFixture'

/**
 * M3 Library acceptance of the phone skin (packet Q4): folders, rename and labels, delete with usage,
 * duplicate, metadata, add at the playhead, renewing thumbnails/waveforms and the media source
 * choice, one catalog case per test in the shared M1 world (a fresh empty composition per test).
 * Every action under test is real touch on the Library sheet; files come in through its hidden
 * import input. Truth: the shared media/timeline stores through a read-only probe, the history
 * revision for "one undo step", and preview pixels where the picture must change.
 */
test.describe.configure({ timeout: 180_000 })

const row = (m1: M1Session, id: string) => m1.page.locator(`[data-testid="${LIB.row}"][data-item-id="${id}"]`)

async function openLibrary(m1: M1Session): Promise<void> {
  await tapAction(m1, phoneActionTestId('library'))
  await expect(m1.page.getByTestId(LIB.root), 'the Library sheet opened').toBeVisible()
  await sheetSettled(m1)
}

/**
 * Imports files through the Library's own Import input; returns the library file of each pick.
 * The editor reuses an already imported identical file, so a pick may resolve to an existing item.
 */
async function importThroughLibrary(m1: M1Session, files: string[]): Promise<LibraryFile[]> {
  const status = m1.page.getByTestId(LIB.status)
  await m1.page.getByTestId(LIB.importInput).setInputFiles(files)
  await expect(status).toContainText(`Imported ${files.length} file`, { timeout: 60_000 })
  await waitForIdle(m1)
  const state = await libraryState(m1.page)
  return files.map(file => {
    const found = state.files.findLast(entry => entry.name === path.basename(file))
    if (!found) throw new Error(`${path.basename(file)} is not in the library after the import`)
    return found
  })
}

async function openItem(m1: M1Session, id: string): Promise<void> {
  await tapOn(m1, row(m1, id).getByTestId(LIB.rowOpen))
  await expect(m1.page.getByTestId(LIB.item), 'the item view opened').toHaveAttribute('data-item-id', id)
  await sheetSettled(m1)
}

test('INV6/media-folders: create nested folders, move several items in one step, undo it, and refuse a folder into its own subfolder @phone', async ({ m1 }) => {
  await openLibrary(m1)
  const [first, second] = await importThroughLibrary(m1, [m1.media.a.path, m1.media.b.path])
  const tag = randomUUID().slice(0, 6)

  await tapOn(m1, m1.page.getByTestId(LIB.newFolder))
  await m1.page.getByTestId(LIB.folderNameInput).fill(`Shots ${tag}`)
  await tapOn(m1, m1.page.getByTestId(LIB.folderCreate))
  await expect.poll(async () => (await libraryState(m1.page)).folders.find(folder => folder.name === `Shots ${tag}`)?.parentId, { message: 'top folder created' }).toBeNull()
  const parent = (await libraryState(m1.page)).folders.find(folder => folder.name === `Shots ${tag}`)!

  // Into the folder, then a subfolder there.
  await tapOn(m1, row(m1, parent.id).getByTestId(LIB.rowOpen))
  await expect(m1.page.getByTestId(LIB.root)).toHaveAttribute('data-folder-id', parent.id)
  await tapOn(m1, m1.page.getByTestId(LIB.newFolder))
  await m1.page.getByTestId(LIB.folderNameInput).fill(`Day ${tag}`)
  await tapOn(m1, m1.page.getByTestId(LIB.folderCreate))
  await expect.poll(async () => (await libraryState(m1.page)).folders.find(folder => folder.name === `Day ${tag}`)?.parentId, { message: 'subfolder created inside' }).toBe(parent.id)
  const child = (await libraryState(m1.page)).folders.find(folder => folder.name === `Day ${tag}`)!

  // Back to the top level, select both imports and move them into the subfolder: one undo step.
  await tapOn(m1, m1.page.getByTestId(LIB.breadcrumb).getByRole('button', { name: 'Library' }))
  await tapOn(m1, m1.page.getByTestId(LIB.selectMode))
  await tapOn(m1, row(m1, first.id).getByTestId(LIB.rowSelect))
  await tapOn(m1, row(m1, second.id).getByTestId(LIB.rowSelect))
  const beforeMove = (await historyState(m1.page)).revisionId
  await tapOn(m1, m1.page.getByTestId(LIB.moveSelected))
  await sheetSettled(m1)
  await tapOn(m1, m1.page.locator(`[data-testid="${LIB.moveTarget}"][data-folder-id="${child.id}"]`))
  await expect(m1.page.getByTestId(LIB.root), 'back in the library after the move').toBeVisible()
  await expect.poll(async () => (await libraryState(m1.page)).files.filter(file => [first.id, second.id].includes(file.id)).map(file => file.parentId),
    { message: 'both items moved into the subfolder' }).toEqual([child.id, child.id])
  await committed(m1, beforeMove)

  // A folder cannot move into its own subfolder: the target is greyed and tapping it explains why.
  await tapOn(m1, m1.page.getByTestId(LIB.selectMode))
  await tapOn(m1, row(m1, parent.id).getByTestId(LIB.rowSelect))
  await tapOn(m1, m1.page.getByTestId(LIB.moveSelected))
  await sheetSettled(m1)
  const ownChild = m1.page.locator(`[data-testid="${LIB.moveTarget}"][data-folder-id="${child.id}"]`)
  await expect(ownChild).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, ownChild)
  await expect(m1.page.getByTestId(LIB.status)).toContainText('cannot move into itself')
  expect((await libraryState(m1.page)).folders.find(folder => folder.id === parent.id)?.parentId, 'the folder stayed where it was').toBeNull()
  await tapCancel(m1)
  await closeSheets(m1)

  await undoOnce(m1)
  expect((await libraryState(m1.page)).files.filter(file => [first.id, second.id].includes(file.id)).map(file => file.parentId),
    'one Undo puts both items back').toEqual([first.parentId, second.parentId])
})

test('INV6/media-rename-and-label: Cancel keeps name and label, Done changes both as one undo step @phone', async ({ m1 }) => {
  await openLibrary(m1)
  const [item] = await importThroughLibrary(m1, [m1.media.short.path])
  const name = `Renamed ${randomUUID().slice(0, 6)}`

  await openItem(m1, item.id)
  await m1.page.getByTestId(LIB.itemName).fill(name)
  await tapOn(m1, m1.page.locator(`[data-testid="${LIB.labelChip}"][data-label="red"]`))
  await tapCancel(m1)
  await expect(m1.page.getByTestId(LIB.root)).toBeVisible()
  const afterCancel = (await libraryState(m1.page)).files.find(file => file.id === item.id)!
  expect([afterCancel.name, afterCancel.labelColor], 'Cancel changed nothing').toEqual([item.name, item.labelColor])

  await openItem(m1, item.id)
  await m1.page.getByTestId(LIB.itemName).fill(name)
  await tapOn(m1, m1.page.locator(`[data-testid="${LIB.labelChip}"][data-label="green"]`))
  const before = (await historyState(m1.page)).revisionId
  await tapDone(m1)
  await expect(m1.page.getByTestId(LIB.root)).toBeVisible()
  await expect.poll(async () => {
    const file = (await libraryState(m1.page)).files.find(entry => entry.id === item.id)!
    return [file.name, file.labelColor]
  }, { message: 'Done renamed and labelled the item' }).toEqual([name, 'green'])
  await committed(m1, before)
  await expect(row(m1, item.id), 'the row shows the new name').toContainText(name)
  await closeSheets(m1)

  await undoOnce(m1)
  const restored = (await libraryState(m1.page)).files.find(file => file.id === item.id)!
  expect([restored.name, restored.labelColor], 'one Undo restores name and label').toEqual([item.name, item.labelColor])
})

test('INV6/media-delete-with-usage: the warning names the clips, Keep changes nothing, Delete removes media and clip, one Undo brings both back @phone', async ({ m1 }) => {
  await openLibrary(m1)
  const [item] = await importThroughLibrary(m1, [m1.media.a.path])

  // Add at the playhead (the library's own command) so the media is used in this composition.
  await openItem(m1, item.id)
  await tapOn(m1, m1.page.getByTestId(LIB.addAtPlayhead))
  await expect(m1.page.getByTestId(LIB.status)).toContainText('added at the playhead', { timeout: 30_000 })
  await expect.poll(async () => (await m1.timeline()).all.length, { message: 'the clip is on the timeline' }).toBeGreaterThan(0)
  await waitForIdle(m1)
  // Pixels are compared with the sheet closed: an open sheet shrinks the preview.
  await closeSheets(m1)
  await m1.probe.waitForFrame(0, { timeoutMs: 30_000 }).catch(() => undefined)
  const withClip = await previewPixels(m1.probe)
  await openLibrary(m1)
  await openItem(m1, item.id)
  const clipCount = (await m1.timeline()).all.length
  const libraryNow = await libraryState(m1.page)
  const composition = libraryNow.compositions.find(comp => comp.id === libraryNow.activeCompositionId)!

  await tapOn(m1, m1.page.getByTestId(LIB.delete))
  await expect(m1.page.getByTestId(LIB.deleteConfirm)).toBeVisible()
  await sheetSettled(m1)
  await expect(m1.page.getByTestId(LIB.deleteUsage).filter({ hasText: composition.name }), 'the warning names the composition and clip count').toContainText(/\d+ clips?/)
  await tapOn(m1, m1.page.getByTestId(LIB.deleteKeepButton))
  await expect(m1.page.getByTestId(LIB.item)).toBeVisible()
  expect((await libraryState(m1.page)).files.some(file => file.id === item.id), 'Keep it deleted nothing').toBe(true)
  expect((await m1.timeline()).all.length).toBe(clipCount)

  const before = (await historyState(m1.page)).revisionId
  await tapOn(m1, m1.page.getByTestId(LIB.delete))
  await sheetSettled(m1)
  await tapOn(m1, m1.page.getByTestId(LIB.deleteConfirmButton))
  await expect(m1.page.getByTestId(LIB.root), 'back in the library after deleting').toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => (await libraryState(m1.page)).files.some(file => file.id === item.id), { message: 'the media left the library' }).toBe(false)
  await expect.poll(async () => (await m1.timeline()).all.length, { message: 'its clips left the timeline' }).toBe(0)
  await committed(m1, before)
  await closeSheets(m1)
  await expect.poll(async () => differingShare(withClip, await previewPixels(m1.probe)), { message: 'the preview no longer shows the clip' }).toBeGreaterThan(0.2)

  await undoOnce(m1)
  await expect.poll(async () => (await libraryState(m1.page)).files.some(file => file.id === item.id), { message: 'Undo brought the media back' }).toBe(true)
  await expect.poll(async () => (await m1.timeline()).all.length, { message: 'Undo brought the clip back' }).toBe(clipCount)
  await expect.poll(async () => differingShare(withClip, await previewPixels(m1.probe)), { timeout: 30_000, message: 'the preview shows the clip again' }).toBeLessThan(0.02)
})

test('INV6/media-copy-paste-duplicate: Duplicate adds an independent copy with the same source, one Undo removes it @phone', async ({ m1 }) => {
  await openLibrary(m1)
  const [item] = await importThroughLibrary(m1, [m1.media.short.path])
  const count = (await libraryState(m1.page)).files.length
  await openItem(m1, item.id)
  const before = (await historyState(m1.page)).revisionId
  await tapOn(m1, m1.page.getByTestId(LIB.duplicate))
  await expect(m1.page.getByTestId(LIB.status)).toContainText('Duplicated 1 item')
  await expect.poll(async () => (await libraryState(m1.page)).files.length).toBe(count + 1)
  await committed(m1, before)
  const copy = (await libraryState(m1.page)).files.at(-1)!
  expect(copy.id).not.toBe(item.id)
  await tapCancel(m1)
  await closeSheets(m1)
  await undoOnce(m1)
  expect((await libraryState(m1.page)).files.length, 'one Undo removes the copy').toBe(count)
})

test('INV6/media-metadata-and-classic-view: the item view lists type, size, frame rate and duration of the source @phone', async ({ m1 }) => {
  await openLibrary(m1)
  const [item] = await importThroughLibrary(m1, [m1.media.b.path])
  await openItem(m1, item.id)
  const info = m1.page.getByTestId(LIB.itemInfo)
  await expect(info).toContainText('Video')
  await expect(info).toContainText('360×640', { timeout: 30_000 })
  await expect(info).toContainText('30 fps')
  await expect(info).toContainText('0:03')
  await closeSheets(m1)
})

test('INV6/regenerate-media-artifacts: thumbnail and waveform are renewed on their own @phone', async ({ m1 }) => {
  await openLibrary(m1)
  const [video, audio] = await importThroughLibrary(m1, [m1.media.short.path, m1.media.audio])
  await openItem(m1, video.id)
  await tapOn(m1, m1.page.getByTestId(LIB.regenerateThumbnail))
  await expect(m1.page.getByTestId(LIB.status)).toContainText('Thumbnail renewed', { timeout: 60_000 })
  expect((await libraryState(m1.page)).files.find(file => file.id === video.id)?.thumbnailUrl, 'a thumbnail exists').toBeTruthy()
  await tapCancel(m1)

  await openItem(m1, audio.id)
  await expect(m1.page.getByTestId(LIB.regenerateThumbnail)).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, m1.page.getByTestId(LIB.regenerateWaveform))
  await expect(m1.page.getByTestId(LIB.status)).toContainText('Waveform renewed', { timeout: 60_000 })
  expect((await libraryState(m1.page)).files.find(file => file.id === audio.id)?.waveformStatus).toBe('ready')
  await closeSheets(m1)
})

test('INV6/choose-original-or-linked-proxy: link a proxy file, switch to it and back to the original @phone', async ({ m1 }) => {
  await openLibrary(m1)
  const [item] = await importThroughLibrary(m1, [m1.media.a.path])
  await openItem(m1, item.id)
  await m1.page.getByTestId(LIB.proxyInput).setInputFiles(m1.media.a.path)
  await expect.poll(async () => (await libraryState(m1.page)).files.find(file => file.id === item.id)?.linkedSources.length ?? 0,
    { timeout: 30_000, message: 'the proxy file is linked' }).toBe(1)
  const linkedId = (await libraryState(m1.page)).files.find(file => file.id === item.id)!.linkedSources[0]
  await tapOn(m1, m1.page.locator(`[data-testid="${LIB.sourceOption}"][data-source="${linkedId}"]`))
  await expect.poll(async () => (await libraryState(m1.page)).files.find(file => file.id === item.id)?.sourceMode, { message: 'the linked proxy is used' }).toBe('linked')
  await tapOn(m1, m1.page.locator(`[data-testid="${LIB.sourceOption}"][data-source="original"]`))
  await expect.poll(async () => (await libraryState(m1.page)).files.find(file => file.id === item.id)?.sourceMode, { message: 'back to the original' }).toBe('original')
  await expect(m1.page.locator(`[data-testid="${LIB.sourceOption}"][data-source="original"]`)).toHaveAttribute('aria-pressed', 'true')
  await closeSheets(m1)
  await expect(m1.page.getByTestId(IDS.root)).toBeVisible()
})
