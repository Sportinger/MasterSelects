import { expect, type Page, type TestInfo } from '@playwright/test'
import { waitForReady } from './readiness'
import { isExistingPage } from './existingPlayer'
import { verifyExistingExportPlayback } from './existingExportPlayback'

export async function verifyExportPlayback(editor: Page, file: string, testInfo: TestInfo) {
  if (isExistingPage(editor)) return verifyExistingExportPlayback(editor, file, testInfo)
  const player = await editor.context().newPage()
  await player.bringToFront()
  await player.setContent(`<input type="file" aria-label="Exported video"><video width="640" height="360" preload="auto"></video><button>Play exported video</button>`)
  await player.evaluate(() => {
    const video = document.querySelector('video')!
    const state = { canPlayThrough: false, started: false, ended: false, waiting: 0,
      mediaTimes: [] as number[], error: '', startedAt: 0, endedAt: 0 }
    Object.assign(window, { betaPlayback: state })
    document.querySelector('input')!.onchange = event => {
      video.src = URL.createObjectURL((event.target as HTMLInputElement).files![0])
    }
    video.addEventListener('canplaythrough', () => { state.canPlayThrough = true })
    video.addEventListener('waiting', () => { if (state.started) state.waiting++ })
    video.addEventListener('error', () => { state.error = video.error?.message || 'Video playback error' })
    video.addEventListener('ended', () => { state.ended = true; state.endedAt = performance.now() })
    const observe = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      state.mediaTimes.push(metadata.mediaTime)
      if (!state.ended) video.requestVideoFrameCallback(observe)
    }
    video.requestVideoFrameCallback(observe)
    document.querySelector('button')!.onclick = () => {
      state.started = true; state.startedAt = performance.now()
      void video.play().catch(error => { state.error = String(error) })
    }
  })
  const observe = () => player.evaluate(() => {
    const video = document.querySelector('video')!
    const state = (window as unknown as { betaPlayback: { canPlayThrough: boolean; ended: boolean;
      waiting: number; mediaTimes: number[]; error: string; startedAt: number; endedAt: number } }).betaPlayback
    const quality = video.getVideoPlaybackQuality()
    return { ...state, readyState: video.readyState, currentTime: video.currentTime,
      droppedFrames: quality.droppedVideoFrames, totalFrames: quality.totalVideoFrames }
  })
  try {
    await player.getByLabel('Exported video').setInputFiles(file)
    await waitForReady(testInfo, 'export-player-loaded', observe, state => state.canPlayThrough && state.readyState === 4)
    await player.getByRole('button', { name: 'Play exported video' }).click()
    const result = await waitForReady(testInfo, 'export-player-ended', observe, state => state.ended || Boolean(state.error), 15_000)
    const gaps = result.mediaTimes.slice(1).map((time, i) => time - result.mediaTimes[i])
    const report = { ...result, maxObservedFrameGapSeconds: Math.max(0, ...gaps),
      wallDurationSeconds: (result.endedAt - result.startedAt) / 1000 }
    await testInfo.attach('export-playback', { body: JSON.stringify(report), contentType: 'application/json' })
    expect(result.error).toBe('')
    expect(result.currentTime).toBeCloseTo(3, 1)
    expect(result.droppedFrames).toBe(0)
    expect(result.waiting).toBe(0)
    expect(result.mediaTimes.length).toBeGreaterThan(60)
    expect(report.maxObservedFrameGapSeconds).toBeLessThan(0.101)
    expect(report.wallDurationSeconds).toBeLessThan(4)
  } finally {
    // The owned profile's teardown closes this player along with the editor.
    await editor.bringToFront()
  }
}
