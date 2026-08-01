import { Buffer } from 'node:buffer'
import type { TestInfo } from '@playwright/test'
import { test, expect } from '../fixtures/test'
import { PreviewDriver } from '../drivers/PreviewDriver'
import { ExportDriver } from '../drivers/ExportDriver'
import { TimelineDriver } from '../drivers/TimelineDriver'
import { analyzeFrameDifference } from '../assertions/maskFrameAssertions'
import {
  assertGoldenVideoArtifact,
  inspectMediaArtifact,
} from '../assertions/mediaArtifactAssertions'
import { decodeVideoArtifactFrames } from '../assertions/videoArtifactFrameAssertions'
import { unexpectedConsoleErrors } from '../assertions/consoleAssertions'

interface MediaItemsResult {
  files: Array<{ id: string; name: string }>
  compositions: Array<{
    id: string
    name: string
    width: number
    height: number
    duration: number
    frameRate: number
  }>
}

interface TimelineClipSummary {
  id: string
  name: string
  startTime: number
  endTime: number
  duration: number
  inPoint: number
  outPoint: number
  linkedClipId?: string
}

interface TimelineTrackSummary {
  id: string
  name: string
  clipCount: number
  clips: TimelineClipSummary[]
}

interface TimelineStateResult {
  activeCompositionId: string | null
  activeCompositionName: string | null
  playheadPosition: number
  duration: number
  totalClips: number
  videoTracks: TimelineTrackSummary[]
  audioTracks: TimelineTrackSummary[]
}

interface MasksResult {
  masks: Array<{ id: string; name: string; feather: number }>
}

interface KeyframesResult {
  keyframes: Array<{
    id: string
    property: string
    time: number
    pathValue?: unknown
  }>
}

interface CapturedFrame {
  capturedAt: number
  width: number
  height: number
  mode: string
  dataUrl: string
  stabilization: {
    attempts: number
    stable: boolean
    waitedMs: number
  }
}

const REVIEW_MODE = process.env.MASTERSELECTS_E2E_REVIEW === '1'
const EXPORT_IN = 0.5
const EXPORT_OUT = 3.2
const EXPORT_DURATION = EXPORT_OUT - EXPORT_IN
const EARLY_SOURCE_TIME = 0.75
const LATE_SOURCE_TIME = 2.82
const VISIBLE_LOAD_PAUSE_MS = 900
const VISIBLE_PLAYBACK_MS = 1_600
const VISIBLE_SCRUB_PAUSE_MS = 650

test.describe.configure({ timeout: 240_000 })

test(
  'saved Super Project fixture preserves both nested split levels and animation state @module:nested-compositions',
  async ({ bridge, editorPage, failureEvidence, page, referenceProject }, testInfo) => {
    if (REVIEW_MODE) test.setTimeout(0)
    const preview = new PreviewDriver(page)
    const exporter = new ExportDriver(page)
    const timeline = new TimelineDriver(page)
    const readTimeline = () => bridge.toolData<TimelineStateResult>('getTimelineState')

    const project = await test.step('open a disposable copy of the captured Super Project', async () => {
      const loaded = await referenceProject.createNestedSuperProject()
      await editorPage.waitForProjectIdle(90_000)
      await preview.expectReady()
      await testInfo.attach('nested-super-project.json', {
        body: Buffer.from(JSON.stringify(loaded, null, 2)),
        contentType: 'application/json',
      })
      return loaded
    })

    await test.step('verify the fixed media and 1920x1080 composition contracts', async () => {
      const media = await bridge.toolData<MediaItemsResult>('getMediaItems')
      expect(media.files.map((file) => file.name).sort()).toEqual([
        'Betaflight  FPV Freestyle.mp4',
        'X-Rays Are Completely Safe.mp4',
        'streifen - Kopie.mp4',
      ].sort())
      expect(media.compositions).toHaveLength(3)

      for (const expected of Object.values(project.compositions)) {
        const actual = media.compositions.find((composition) => composition.id === expected.id)
        expect(actual, `missing composition ${expected.name}`).toBeTruthy()
        expect(actual?.name).toBe(expected.name)
        expect(actual?.width).toBe(1920)
        expect(actual?.height).toBe(1080)
        expect(actual?.frameRate).toBe(expected.frameRate)
        expect(actual?.duration).toBe(expected.duration)
      }
    })

    await test.step('verify the outer nested clip split in ÜberComp', async () => {
      const state = await bridge.toolData<TimelineStateResult>('getTimelineState')
      expect(state.activeCompositionId).toBe(project.compositions.main.id)
      expect(state.activeCompositionName).toBe(project.compositions.main.name)
      expect(state.duration).toBe(project.compositions.main.duration)
      expect(state.totalClips).toBe(4)
      expectSplitPair(
        allClips(state),
        project.compositions.main.nestedVideoClipIds ?? [],
        project.compositions.main.splitTime ?? -1,
      )

      const screenshotPath = testInfo.outputPath('nested-super-project-main.png')
      await page.screenshot({ path: screenshotPath, animations: 'disabled' })
      await testInfo.attach('nested-super-project-main.png', {
        path: screenshotPath,
        contentType: 'image/png',
      })
    })

    await test.step('verify the inner split plus animated ellipse mask and feather', async () => {
      const level2 = project.compositions.level2
      await bridge.toolData('openComposition', { compositionId: level2.id })
      const state = await bridge.toolData<TimelineStateResult>('getTimelineState')
      expect(state.activeCompositionId).toBe(level2.id)
      expect(state.totalClips).toBe(17)
      expectSplitPair(allClips(state), level2.nestedVideoClipIds ?? [], level2.splitTime ?? -1)

      const clipId = level2.animatedNestedClipId ?? ''
      const masks = await bridge.toolData<MasksResult>('getMasks', { clipId })
      const keyframes = await bridge.toolData<KeyframesResult>('getKeyframes', { clipId })
      expect(masks.masks).toHaveLength(level2.expectedMaskCount ?? -1)
      expect(masks.masks[0]?.name).toBe('Ellipse Mask')
      expect(keyframes.keyframes).toHaveLength(level2.expectedKeyframeCount ?? -1)
      expect(keyframes.keyframes.filter((keyframe) => keyframe.pathValue)).toHaveLength(4)
      const featherKeyframes = keyframes.keyframes.filter(
        (keyframe) => keyframe.property.endsWith('.feather'),
      )
      expect(featherKeyframes).toHaveLength(7)
      expect(featherKeyframes.filter((keyframe) => keyframe.property.includes('.edge.'))).toHaveLength(2)
    })

    await test.step('verify the level-one rectangle path and solid opacity animation', async () => {
      const level1 = project.compositions.level1
      await bridge.toolData('openComposition', { compositionId: level1.id })
      const state = await bridge.toolData<TimelineStateResult>('getTimelineState')
      expect(state.activeCompositionId).toBe(level1.id)
      expect(state.totalClips).toBe(2)

      const stripedMasks = await bridge.toolData<MasksResult>('getMasks', {
        clipId: level1.stripedClipId,
      })
      const stripedKeyframes = await bridge.toolData<KeyframesResult>('getKeyframes', {
        clipId: level1.stripedClipId,
      })
      const solidKeyframes = await bridge.toolData<KeyframesResult>('getKeyframes', {
        clipId: level1.solidClipId,
      })
      expect(stripedMasks.masks).toHaveLength(level1.expectedStripedMaskCount ?? -1)
      expect(stripedMasks.masks[0]?.name).toBe('Rectangle Mask')
      expect(stripedKeyframes.keyframes).toHaveLength(level1.expectedStripedKeyframeCount ?? -1)
      expect(stripedKeyframes.keyframes.filter((keyframe) => keyframe.pathValue)).toHaveLength(4)
      expect(solidKeyframes.keyframes).toHaveLength(level1.expectedSolidKeyframeCount ?? -1)
      expect(solidKeyframes.keyframes.every((keyframe) => keyframe.property === 'opacity')).toBe(true)
    })

    let earlyPreviewFrame: CapturedFrame
    let latePreviewFrame: CapturedFrame
    await test.step('wait for effects, then visibly play, pause, stop, and scrub', async () => {
      await bridge.toolData('openComposition', { compositionId: project.compositions.main.id })
      await editorPage.waitForProjectIdle(90_000)
      await preview.expectReady()

      const readyFrame = await bridge.toolData<CapturedFrame>('captureFrame', {
        time: project.review.initialTime,
        mode: 'auto',
        settleMs: VISIBLE_LOAD_PAUSE_MS,
      }, { timeoutMs: 20_000, fetchTimeoutMs: 25_000 })
      expect(readyFrame.width).toBe(project.compositions.main.width)
      expect(readyFrame.height).toBe(project.compositions.main.height)
      expect(
        readyFrame.stabilization.stable,
        `Preview never stabilized after ${readyFrame.stabilization.waitedMs}ms`,
      ).toBe(true)
      await attachFrame(testInfo, 'super-project-ready', readyFrame)

      const beforePlay = await readTimeline()
      await timeline.play()
      await timeline.expectPlayheadAfter(
        readTimeline,
        beforePlay.playheadPosition + 0.12,
        20_000,
      )
      await page.waitForTimeout(VISIBLE_PLAYBACK_MS)
      await timeline.pause()
      await timeline.expectPausedPositionStable(readTimeline, 450)
      await page.waitForTimeout(VISIBLE_SCRUB_PAUSE_MS)
      await timeline.stop()
      await timeline.expectPlayheadNear(readTimeline, 0, 0.05)

      const duration = (await readTimeline()).duration
      await timeline.scrubToFraction(EARLY_SOURCE_TIME / duration, 0)
      await timeline.expectPlayheadNear(readTimeline, EARLY_SOURCE_TIME, 0.12)
      earlyPreviewFrame = await bridge.toolData<CapturedFrame>('captureFrame', {
        time: EARLY_SOURCE_TIME,
        mode: 'auto',
        settleMs: VISIBLE_SCRUB_PAUSE_MS,
      }, { timeoutMs: 20_000, fetchTimeoutMs: 25_000 })
      expect(earlyPreviewFrame.stabilization.stable).toBe(true)
      await attachFrame(testInfo, 'super-project-preview-early', earlyPreviewFrame)

      const afterOuterSplitTime = 0.9
      await timeline.scrubToFraction(afterOuterSplitTime / duration, EARLY_SOURCE_TIME / duration)
      await timeline.expectPlayheadNear(readTimeline, afterOuterSplitTime, 0.12)
      const outerSplitFrame = await bridge.toolData<CapturedFrame>('captureFrame', {
        time: afterOuterSplitTime,
        mode: 'auto',
        settleMs: VISIBLE_SCRUB_PAUSE_MS,
      }, { timeoutMs: 20_000, fetchTimeoutMs: 25_000 })
      expect(outerSplitFrame.stabilization.stable).toBe(true)
      await attachFrame(testInfo, 'super-project-preview-after-outer-split', outerSplitFrame)

      await timeline.scrubToFraction(LATE_SOURCE_TIME / duration, afterOuterSplitTime / duration)
      await timeline.expectPlayheadNear(readTimeline, LATE_SOURCE_TIME, 0.12)
      latePreviewFrame = await bridge.toolData<CapturedFrame>('captureFrame', {
        time: LATE_SOURCE_TIME,
        mode: 'auto',
        settleMs: VISIBLE_SCRUB_PAUSE_MS,
      }, { timeoutMs: 20_000, fetchTimeoutMs: 25_000 })
      expect(latePreviewFrame.stabilization.stable).toBe(true)
      await attachFrame(testInfo, 'super-project-preview-late', latePreviewFrame)
    })

    await test.step('prepare a short export range crossing both nested split boundaries', async () => {
      await bridge.toolData('setInOutPoints', {
        inPoint: EXPORT_IN,
        outPoint: EXPORT_OUT,
      })
      await bridge.toolData('setPlayhead', { time: project.review.initialTime })
      await page.waitForTimeout(VISIBLE_LOAD_PAUSE_MS)
    })

    if (REVIEW_MODE) {
      await test.step('pause before the visible export for manual review', async () => {
        await page.pause()
      })
    }

    await test.step('export the critical nested range through the visible UI', async () => {
      await exporter.open()
      await exporter.selectPreciseHtmlVideo()
      await exporter.useCompositionSettings()
      await exporter.useInOutMarkers()
      await exporter.setFilename('playwright-super-project')

      const artifactPath = testInfo.outputPath('playwright-super-project.mp4')
      const download = await exporter.exportTo(artifactPath, 180_000)
      expect(download.suggestedFilename()).toBe('playwright-super-project.mp4')

      const metadata = await inspectMediaArtifact(artifactPath)
      assertGoldenVideoArtifact(metadata, {
        width: project.compositions.main.width,
        height: project.compositions.main.height,
        durationSeconds: EXPORT_DURATION,
        requireAudio: true,
        minimumSizeBytes: 50_000,
      })

      const earlyArtifactTime = EARLY_SOURCE_TIME - EXPORT_IN
      const lateArtifactTime = LATE_SOURCE_TIME - EXPORT_IN
      const decodedFrames = await decodeVideoArtifactFrames(page, artifactPath, [
        earlyArtifactTime,
        lateArtifactTime,
      ])
      expect(decodedFrames).toHaveLength(2)
      decodedFrames.forEach((frame) => {
        expect(frame.width).toBe(project.compositions.main.width)
        expect(frame.height).toBe(project.compositions.main.height)
      })

      const earlyDifference = await analyzeFrameDifference(
        page,
        earlyPreviewFrame.dataUrl,
        decodedFrames[0].dataUrl,
      )
      const lateDifference = await analyzeFrameDifference(
        page,
        latePreviewFrame.dataUrl,
        decodedFrames[1].dataUrl,
      )
      expect(earlyDifference.meanAbsoluteDifference).toBeLessThan(25)
      expect(earlyDifference.changedPixelRatio).toBeLessThan(0.72)
      expect(lateDifference.meanAbsoluteDifference).toBeLessThan(25)
      expect(lateDifference.changedPixelRatio).toBeLessThan(0.72)

      await attachFrame(testInfo, 'super-project-export-early', decodedFrames[0])
      await attachFrame(testInfo, 'super-project-export-late', decodedFrames[1])
      await testInfo.attach('super-project-export-metadata.json', {
        body: Buffer.from(JSON.stringify(metadata, null, 2)),
        contentType: 'application/json',
      })
      await testInfo.attach('super-project-export-frame-differences.json', {
        body: Buffer.from(JSON.stringify({ earlyDifference, lateDifference }, null, 2)),
        contentType: 'application/json',
      })
      await testInfo.attach('super-project-export.mp4', {
        path: artifactPath,
        contentType: 'video/mp4',
      })
    })

    await test.step('assert the complete workflow left no fatal browser errors', async () => {
      expect(failureEvidence.pageErrors, 'Unexpected uncaught page errors.').toEqual([])
      expect(
        unexpectedConsoleErrors(failureEvidence.consoleEntries),
        'Unexpected browser console errors.',
      ).toEqual([])
    })
  },
)

function allClips(state: TimelineStateResult): TimelineClipSummary[] {
  return [...state.videoTracks, ...state.audioTracks].flatMap((track) => track.clips)
}

function expectSplitPair(
  clips: TimelineClipSummary[],
  clipIds: string[],
  splitTime: number,
): void {
  expect(clipIds).toHaveLength(2)
  const pair = clipIds.map((clipId) => clips.find((clip) => clip.id === clipId))
  expect(pair[0], `missing split clip ${clipIds[0]}`).toBeTruthy()
  expect(pair[1], `missing split clip ${clipIds[1]}`).toBeTruthy()
  expect(pair[0]?.endTime).toBeCloseTo(splitTime, 9)
  expect(pair[1]?.startTime).toBeCloseTo(splitTime, 9)
  expect(pair[1]?.inPoint).toBeCloseTo(splitTime, 9)
}

async function attachFrame(
  testInfo: TestInfo,
  name: string,
  frame: { dataUrl: string },
): Promise<void> {
  const encoded = frame.dataUrl.split(',')[1]
  if (!encoded) throw new Error(`Captured frame has no base64 payload: ${name}`)
  await testInfo.attach(`${name}.png`, {
    body: Buffer.from(encoded, 'base64'),
    contentType: 'image/png',
  })
}
