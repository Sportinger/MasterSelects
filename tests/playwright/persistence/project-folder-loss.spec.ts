import type { Page, TestInfo } from '@playwright/test'
import { test, expect } from '../fixtures/test'
import type { BridgeClient } from '../fixtures/bridgeClient'
import type { EditorPage } from '../fixtures/editorPage'
import { frameCodeClip } from '../fixtures/frameCodeMedia'

/**
 * Case 1. The project folder disappears while the project is open (production 3.4.1, 2026-10-29: one
 * Windows session logged "Processed waveform generation failed … could not be found" 1004 times
 * in two hours, plus 79 failed chat audit writes). The editor kept working, so no journey that
 * checks pictures or files noticed.
 *
 * Arrangement: a browser project with a clip that has sound, its source waveform saved. Then the
 * project's folders are removed from the browser's file storage (what a deleted or moved folder
 * does to an open project) and the audio clip is muted through the Volume inspector, which needs
 * a processed waveform the editor can no longer read or save. The user keeps editing: the clip is
 * nudged every two seconds.
 *
 * Oracle: the failed processed waveform is reported (error or warning, never silent) and retried
 * with a pause: at most three attempts within 40 s. Before the fix every edit started a new attempt
 * (21 in 40 s). The shared fixture additionally fails any error repeated more than 20 times.
 *
 * Case 2. The same loss, then the person saves the work elsewhere. The save status must name the
 * problem ("Project files missing", not a retry that can never work) and open Save As; Save As must
 * keep the work on screen, including edits made after the loss. Before the fix Save As tried to copy
 * the vanished project, failed, and left the tab with no project ("Recovery unavailable").
 */
const OBSERVE_MS = 40_000
const EDIT_INTERVAL_MS = 2_000
/** First attempt plus one retry after 15 s fit; a loop starts a new attempt every second or so. */
const MAX_ATTEMPTS_IN_WINDOW = 3
const ATTEMPT = 'Starting processed waveform generation'
/** Every attempt that ends without a waveform must say why (error or warning), never silently. */
const OUTCOME = /Processed waveform (generation failed|not derived)/

interface ClipSummary { id: string; name: string }
interface TrackSummary { clips: ClipSummary[] }
interface TimelineSummary {
  activeCompositionName?: string
  audioTracks: TrackSummary[]
  videoTracks: Array<{ clips: Array<ClipSummary & { startTime: number }> }>
}
interface ClipDetails { waveform: { hasSourcePyramid: boolean; hasProcessedPyramid: boolean } }

interface ArrangedClip { audioClipId: string; videoClipId: string }

async function arrangeClipWithSavedWaveform(bridge: BridgeClient, editorPage: EditorPage, composition: string): Promise<ArrangedClip> {
  const clip = await frameCodeClip({ width: 320, height: 180, fps: 30, seconds: 3, audioHz: 440 })
  return test.step('arrange a clip with sound and its saved source waveform', async () => {
    await bridge.toolData('createComposition', {
      name: composition, width: clip.width, height: clip.height, frameRate: clip.fps, duration: 3, open: true,
    })
    await bridge.toolData('importLocalFiles', {
      paths: [clip.path.replaceAll('\\', '/')], addToTimeline: true, startTime: 0,
    }, { timeoutMs: 60_000 })
    await editorPage.waitForProjectIdle(30_000)
    const timeline = await bridge.toolData<TimelineSummary>('getTimelineState')
    const audioClipId = timeline.audioTracks.flatMap((track) => track.clips)[0]?.id ?? ''
    const videoClipId = timeline.videoTracks.flatMap((track) => track.clips)[0]?.id ?? ''
    expect(videoClipId, 'the imported clip is on the timeline').not.toBe('')
    expect(audioClipId, 'the imported clip has a linked audio clip').not.toBe('')
    await expect.poll(async () => (await bridge.toolData<ClipDetails>('getClipDetails', { clipId: audioClipId }))
      .waveform.hasSourcePyramid, { timeout: 60_000, message: 'the source waveform pyramid was never saved' })
      .toBe(true)
    return { audioClipId, videoClipId }
  })
}

/** What a deleted or moved project folder does to an open browser project. */
async function removeProjectFolders(page: Page, testInfo: TestInfo): Promise<void> {
  await test.step('remove the project folders from the browser file storage', async () => {
    const removal = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const names: string[] = []
      for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name)
      // The storage worker may hold a file open for a moment (InvalidModificationError); retry briefly.
      let pending = [...names]
      let failed: string[] = []
      for (let attempt = 0; attempt < 40 && pending.length > 0; attempt += 1) {
        failed = []
        const next: string[] = []
        for (const name of pending) {
          try {
            await root.removeEntry(name, { recursive: true })
          } catch (error) {
            if (error instanceof DOMException && error.name === 'NotFoundError') continue
            next.push(name)
            failed.push(`${name}: ${error instanceof Error ? `${error.name} ${error.message}` : String(error)}`)
          }
        }
        pending = next
        if (pending.length > 0) await new Promise((resolve) => setTimeout(resolve, 250))
      }
      return { names, failed }
    })
    await testInfo.attach('opfs-removal.json', { body: JSON.stringify(removal, null, 2), contentType: 'application/json' })
    expect(removal.names.length, 'the browser project lives in the origin private file system').toBeGreaterThan(0)
    expect(removal.failed, 'every project folder could be removed').toEqual([])
  })
}

test.describe.configure({ timeout: 180_000 })

test(
  'a project folder removed while open does not loop failed waveform saves @module:persistence-history',
  async ({ page, bridge, editorPage, failureEvidence }, testInfo) => {
    const { audioClipId, videoClipId } = await arrangeClipWithSavedWaveform(bridge, editorPage, 'Folder loss')
    await removeProjectFolders(page, testInfo)

    const attempts: string[] = []
    page.on('console', (message) => {
      if (message.text().includes(ATTEMPT)) attempts.push(new Date().toISOString())
    })
    await page.evaluate(() => {
      const logger = (window as unknown as { Logger?: { enable(modules: string): void; setLevel(level: string): void } }).Logger
      logger?.enable('ClipProcessedWaveformAnalysis')
      logger?.setLevel('DEBUG')
    })
    const consoleBefore = failureEvidence.consoleEntries.length

    await test.step('mute the audio clip in the Volume inspector', async () => {
      await bridge.toolData('selectClips', { clipIds: [audioClipId] })
      await page.getByText('Properties', { exact: true }).first().click()
      const mute = page.getByRole('checkbox', { name: 'Mute clip' })
      await expect(mute).toBeVisible({ timeout: 15_000 })
      await mute.check()
      await expect(mute).toBeChecked()
    })

    await test.step('the processed waveform that cannot be saved is retried with a pause, not in a loop', async () => {
      const outcomes = () => failureEvidence.consoleEntries
        .slice(consoleBefore)
        .filter((entry) => OUTCOME.test(entry.text))
      // The first attempt runs about half a second after the mute and must report its outcome.
      await expect.poll(() => outcomes().length, {
        timeout: 15_000, message: 'the failed processed waveform must be reported, not silent',
      }).toBeGreaterThan(0)
      const attemptsBefore = attempts.length
      // The user keeps editing (production: two hours of work). Every edit used to restart the failed
      // job; nudging the clip every two seconds stands in for that work. The fixed window is the
      // oracle (how many attempts within 40 s), not a readiness wait.
      const editsUntil = Date.now() + OBSERVE_MS
      for (let edit = 0; Date.now() < editsUntil; edit += 1) {
        await bridge.toolData('moveClip', { clipId: videoClipId, newStartTime: edit % 2 === 0 ? 0.1 : 0 })
        await page.waitForTimeout(EDIT_INTERVAL_MS)
      }
      const inWindow = attempts.length - attemptsBefore + 1
      await testInfo.attach('processed-waveform-attempts.json', {
        body: JSON.stringify({ attempts, outcomes: outcomes().map((entry) => entry.text.slice(0, 300)) }, null, 2),
        contentType: 'application/json',
      })
      expect(inWindow, `processed waveform attempts within ${OBSERVE_MS / 1000} s`).toBeLessThanOrEqual(MAX_ATTEMPTS_IN_WINDOW)
    })
  },
)

test(
  'Save As keeps the work of a project whose folder was removed while open @module:persistence-history',
  async ({ page, bridge, editorPage }, testInfo) => {
    const { videoClipId } = await arrangeClipWithSavedWaveform(bridge, editorPage, 'Rescue me')
    await removeProjectFolders(page, testInfo)

    const status = page.locator('.toolbar-save-status')
    await test.step('an edit after the loss cannot be saved and the status says why', async () => {
      await bridge.toolData('moveClip', { clipId: videoClipId, newStartTime: 0.5 })
      await expect(status).toHaveText('Project files missing', { timeout: 15_000 })
      await expect(status).toHaveAttribute('title', /moved or deleted on disk/)
    })

    await test.step('the status opens Save As and saves the work as a new project', async () => {
      await status.click()
      const dialog = page.getByRole('dialog').filter({ hasText: 'Save project as' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('textbox').first().fill('Rescued work')
      await dialog.getByRole('button', { name: 'Save As' }).click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })
      await expect(status).toHaveText('Saved - Browser local', { timeout: 30_000 })
      const timeline = await bridge.toolData<TimelineSummary>('getTimelineState')
      expect(timeline.activeCompositionName, 'the composition that was open stays open').toBe('Rescue me')
      expect(timeline.videoTracks.flatMap((track) => track.clips).map((clip) => clip.startTime),
        'the edit made after the loss is kept').toEqual([0.5])
    })

    await test.step('the saved project reopens with the work after a reload', async () => {
      await page.reload()
      const chooser = page.getByRole('dialog', { name: 'Choose project' })
      await expect(page.locator('.app--editor-layout')).toBeVisible({ timeout: 30_000 })
      if (await chooser.isVisible()) await chooser.getByText('Rescued work', { exact: true }).first().click()
      await expect(chooser).toBeHidden({ timeout: 30_000 })
      await editorPage.waitForProjectIdle(30_000)
      await expect.poll(async () => {
        const timeline = await bridge.toolData<TimelineSummary>('getTimelineState')
        return { composition: timeline.activeCompositionName, starts: timeline.videoTracks.flatMap((track) => track.clips).map((clip) => clip.startTime) }
      }, { timeout: 30_000, message: 'the reopened project holds the composition and the edit' })
        .toEqual({ composition: 'Rescue me', starts: [0.5] })
    })
  },
)
