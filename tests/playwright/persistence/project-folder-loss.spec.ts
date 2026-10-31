import { test, expect } from '../fixtures/test'
import { frameCodeClip } from '../fixtures/frameCodeMedia'

/**
 * The project folder disappears while the project is open (production 3.4.1, 2026-10-29: one
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
interface TimelineSummary { audioTracks: TrackSummary[]; videoTracks: TrackSummary[] }
interface ClipDetails { waveform: { hasSourcePyramid: boolean; hasProcessedPyramid: boolean } }

test.describe.configure({ timeout: 180_000 })

test(
  'a project folder removed while open does not loop failed waveform saves @module:persistence-history',
  async ({ page, bridge, editorPage, failureEvidence }, testInfo) => {
    const clip = await frameCodeClip({ width: 320, height: 180, fps: 30, seconds: 3, audioHz: 440 })

    let audioClipId = ''
    let videoClipId = ''
    await test.step('arrange a clip with sound and its saved source waveform', async () => {
      await bridge.toolData('createComposition', {
        name: 'Folder loss', width: clip.width, height: clip.height, frameRate: clip.fps, duration: 3, open: true,
      })
      await bridge.toolData('importLocalFiles', {
        paths: [clip.path.replaceAll('\\', '/')], addToTimeline: true, startTime: 0,
      }, { timeoutMs: 60_000 })
      await editorPage.waitForProjectIdle(30_000)
      const timeline = await bridge.toolData<TimelineSummary>('getTimelineState')
      audioClipId = timeline.audioTracks.flatMap((track) => track.clips)[0]?.id ?? ''
      videoClipId = timeline.videoTracks.flatMap((track) => track.clips)[0]?.id ?? ''
      expect(videoClipId, 'the imported clip is on the timeline').not.toBe('')
      expect(audioClipId, 'the imported clip has a linked audio clip').not.toBe('')
      await expect.poll(async () => (await bridge.toolData<ClipDetails>('getClipDetails', { clipId: audioClipId }))
        .waveform.hasSourcePyramid, { timeout: 60_000, message: 'the source waveform pyramid was never saved' })
        .toBe(true)
    })

    await test.step('remove the project folders from the browser file storage', async () => {
      const removal = await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        const names: string[] = []
        for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name)
        const failed: string[] = []
        for (const name of names) {
          try {
            await root.removeEntry(name, { recursive: true })
          } catch (error) {
            failed.push(`${name}: ${error instanceof Error ? `${error.name} ${error.message}` : String(error)}`)
          }
        }
        return { names, failed }
      })
      await testInfo.attach('opfs-removal.json', { body: JSON.stringify(removal, null, 2), contentType: 'application/json' })
      expect(removal.names.length, 'the browser project lives in the origin private file system').toBeGreaterThan(0)
      expect(removal.failed, 'every project folder could be removed').toEqual([])
    })

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
