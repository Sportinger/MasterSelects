import { expect, type Page, type TestInfo } from '@playwright/test'
import { waitForReady } from './readiness'
import { createOwnedPlayer } from './existingPlayer'
import { finishExistingCase } from './existingResourceCleanup.mjs'
import { withinDeadline } from './existingActionBoundary'

export async function verifyExistingExportPlayback(editor: Page, file: string, testInfo: TestInfo) {
  const owned = await createOwnedPlayer(editor)
  const player = owned.locator
  let primary: unknown
  try {
  await owned.handle.evaluate(element => {
    const scope = element as HTMLDivElement & { betaPlayback: unknown; __ownedUrls: string[]; __frameCallback: number }
    const video = scope.querySelector('video')!
    const state = { canPlayThrough: false, started: false, ended: false, waiting: 0,
      mediaTimes: [] as number[], error: '', startedAt: 0, endedAt: 0 }
    Object.assign(scope, { betaPlayback: state })
    scope.querySelector('input')!.onchange = event => {
      const url = URL.createObjectURL((event.target as HTMLInputElement).files![0])
      scope.__ownedUrls.push(url)
      video.src = url
    }
    video.addEventListener('canplaythrough', () => { state.canPlayThrough = true })
    video.addEventListener('waiting', () => { if (state.started) state.waiting++ })
    video.addEventListener('error', () => { state.error = video.error?.message || 'Video playback error' })
    video.addEventListener('ended', () => { state.ended = true; state.endedAt = performance.now() })
    const observe = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      state.mediaTimes.push(metadata.mediaTime)
      if (!state.ended) scope.__frameCallback = video.requestVideoFrameCallback(observe)
    }
    scope.__frameCallback = video.requestVideoFrameCallback(observe)
    scope.querySelector('button')!.onclick = () => {
      state.started = true; state.startedAt = performance.now()
      void video.play().catch(error => { state.error = String(error) })
    }
  })
  const observe = () => owned.handle.evaluate(element => {
    const scope = element as HTMLDivElement & { betaPlayback: unknown }
    const video = scope.querySelector('video')!
    const state = (scope as unknown as { betaPlayback: { canPlayThrough: boolean; ended: boolean;
      waiting: number; mediaTimes: number[]; error: string; startedAt: number; endedAt: number } }).betaPlayback
    const quality = video.getVideoPlaybackQuality()
    return { ...state, readyState: video.readyState, currentTime: video.currentTime,
      droppedFrames: quality.droppedVideoFrames, totalFrames: quality.totalVideoFrames }
  })
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
  } catch (error) { primary = error; throw error }
  finally {
    const result = await finishExistingCase({ original: primary,
      cleanup: () => withinDeadline('Export player cleanup', () => owned.cleanup(owned.owner, { deferUrlProof: true }), 10_000),
      persist: (report: unknown) => withinDeadline('Export cleanup evidence', () => testInfo.attach('owned-export-player-cleanup',
        { body: JSON.stringify(report), contentType: 'application/json' }), 5_000) })
    // Preserve the thrown primary; fixture cleanup independently retains owner reports.
    if (primary && result.report.errors?.length) console.error('Export cleanup secondary errors:', result.report.errors)
  }
}
