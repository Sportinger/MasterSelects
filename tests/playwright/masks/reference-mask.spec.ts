import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import type { TestInfo } from '@playwright/test'
import { test, expect } from '../fixtures/test'
import { ExportDriver } from '../drivers/ExportDriver'
import { MaskDriver } from '../drivers/MaskDriver'
import { PreviewDriver } from '../drivers/PreviewDriver'
import { TimelineDriver, type TimelineSnapshot } from '../drivers/TimelineDriver'
import {
  analyzeFrameDifference,
  analyzeMaskRetention,
  type MaskRetentionEvidence,
} from '../assertions/maskFrameAssertions'
import {
  assertGoldenVideoArtifact,
  inspectMediaArtifact,
} from '../assertions/mediaArtifactAssertions'
import { decodeVideoArtifactFrames } from '../assertions/videoArtifactFrameAssertions'
import { unexpectedConsoleErrors } from '../assertions/consoleAssertions'

interface CapturedFrame {
  capturedAt: number
  width: number
  height: number
  mode: string
  dataUrl: string
}

interface MaskVertexState {
  id: string
  x: number
  y: number
}

interface MaskState {
  id: string
  name: string
  closed: boolean
  feather: number
  inverted: boolean
  enabled: boolean
  mode: string
  position: { x: number; y: number }
  vertices: MaskVertexState[]
}

interface MasksResult {
  clipId: string
  masks: MaskState[]
}

interface PathKeyframeState {
  id: string
  property: string
  time: number
  value?: number
  pathValue?: {
    closed: boolean
    vertices: MaskVertexState[]
  }
}

interface KeyframesResult {
  clipId: string
  keyframes: PathKeyframeState[]
}

const MASK_NAME = 'Rectangle Mask'
const REVIEW_MODE = process.env.MASTERSELECTS_E2E_REVIEW === '1'

test.describe.configure({ timeout: 240_000 })

test(
  'rectangle mask reveals the correct real-video region @module:masks',
  async ({
    bridge,
    editorPage,
    failureEvidence,
    page,
    referenceProject,
  }, testInfo) => {
    if (REVIEW_MODE) test.setTimeout(0)
    const exporter = new ExportDriver(page)
    const masks = new MaskDriver(page)
    const preview = new PreviewDriver(page)
    const timeline = new TimelineDriver(page)
    const capture = async (time = project.sampleTime) => {
      const frame = await bridge.toolData<CapturedFrame>('captureFrame', {
        time,
        mode: 'auto',
        settleMs: 350,
      }, { timeoutMs: 20_000, fetchTimeoutMs: 25_000 })
      expect(frame.width).toBe(project.composition.width)
      expect(frame.height).toBe(project.composition.height)
      return frame
    }
    const readMasks = () => bridge.toolData<MasksResult>('getMasks', {
      clipId: project.clips.foregroundClipId,
    })
    const readTimeline = () => bridge.toolData<TimelineSnapshot>('getTimelineState')

    const project = await test.step('load a fresh copy of the stored mask reference project', async () => {
      const created = await referenceProject.createMaskReferenceProject()
      await editorPage.waitForProjectIdle(30_000)
      await preview.expectReady()
      await testInfo.attach('mask-reference-project.json', {
        body: Buffer.from(JSON.stringify(created, null, 2)),
        contentType: 'application/json',
      })
      return created
    })

    await test.step('verify and display the mask stored in the project template', async () => {
      await masks.open()
      const state = await readMasks()
      expect(state.masks).toHaveLength(1)
      const mask = state.masks[0]
      expect(mask.id).toBe(project.mask.id)
      expect(mask.name).toBe(project.mask.name)
      expect(mask.closed).toBe(true)
      expect(mask.enabled).toBe(true)
      expect(mask.inverted).toBe(false)
      expect(mask.mode).toBe('add')
      expect(mask.vertices).toHaveLength(project.mask.vertices.length)
      mask.vertices.forEach((vertex, index) => {
        expect(vertex.x).toBeCloseTo(project.mask.vertices[index].x, 5)
        expect(vertex.y).toBeCloseTo(project.mask.vertices[index].y, 5)
      })
      await masks.expectRectangleOverlay()

      const uiScreenshotPath = testInfo.outputPath('mask-ui-overlay.png')
      await page.screenshot({ path: uiScreenshotPath, animations: 'disabled' })
      await testInfo.attach('mask-ui-overlay.png', {
        path: uiScreenshotPath,
        contentType: 'image/png',
      })

    })

    let baseFrame: CapturedFrame
    let unmaskedFrame: CapturedFrame
    await test.step('capture base and full-foreground controls at one exact time', async () => {
      await bridge.toolData('setTrackVisibility', {
        trackId: project.tracks.foregroundTrackId,
        visible: false,
      })
      baseFrame = await capture()
      await saveFrame(testInfo, 'mask-base', baseFrame)

      await bridge.toolData('setTrackVisibility', {
        trackId: project.tracks.foregroundTrackId,
        visible: true,
      })
      await bridge.toolData('updateMask', {
        clipId: project.clips.foregroundClipId,
        maskId: project.mask.id,
        enabled: false,
      })
      unmaskedFrame = await capture()
      await saveFrame(testInfo, 'mask-unmasked', unmaskedFrame)

      await bridge.toolData('updateMask', {
        clipId: project.clips.foregroundClipId,
        maskId: project.mask.id,
        enabled: true,
      })

      const sourceDifference = await analyzeFrameDifference(
        page,
        baseFrame.dataUrl,
        unmaskedFrame.dataUrl,
      )
      expect(sourceDifference.changedPixelRatio).toBeGreaterThan(0.3)
      expect(sourceDifference.meanAbsoluteDifference).toBeGreaterThan(8)
    })

    let maskedFrame: CapturedFrame
    let maskedEvidence: MaskRetentionEvidence | null = null
    await test.step('prove the stored rectangle reveals the expected region', async () => {
      maskedFrame = await capture()
      await saveFrame(testInfo, 'mask-rectangle', maskedFrame)
      maskedEvidence = await analyzeMaskRetention(page, {
        base: baseFrame.dataUrl,
        unmasked: unmaskedFrame.dataUrl,
        candidate: maskedFrame.dataUrl,
      }, referenceRegions())
      expect(maskedEvidence.inner.validPixels).toBeGreaterThan(2_000)
      expect(maskedEvidence.outer.validPixels).toBeGreaterThan(500)
      expect(maskedEvidence.inner.medianRetention).toBeGreaterThan(0.78)
      expect(maskedEvidence.outer.medianRetention).toBeLessThan(0.22)
    })

    await test.step('prove the render toggle removes and restores the mask effect', async () => {
      await masks.disableActiveMaskRender(MASK_NAME)
      await expect.poll(async () => (await readMasks()).masks[0]?.enabled).toBe(false)
      const disabledFrame = await capture()
      await saveFrame(testInfo, 'mask-render-disabled', disabledFrame)
      const disabledDifference = await analyzeFrameDifference(
        page,
        unmaskedFrame.dataUrl,
        disabledFrame.dataUrl,
      )
      expect(disabledDifference.meanAbsoluteDifference).toBeLessThan(4)

      await masks.enableActiveMaskRender(MASK_NAME)
      await expect.poll(async () => (await readMasks()).masks[0]?.enabled).toBe(true)
      const restoredFrame = await capture()
      const restoredDifference = await analyzeFrameDifference(
        page,
        maskedFrame.dataUrl,
        restoredFrame.dataUrl,
      )
      expect(restoredDifference.meanAbsoluteDifference).toBeLessThan(4)
    })

    let featherEvidence: {
      meanAbsoluteDifference: number
      changedPixelRatio: number
    } | null = null
    await test.step('keyframe feather through the visible numeric UI', async () => {
      const featherStartTime = project.sampleTime
      const featherEndTime = 2.5
      const featherProperty = `mask.${project.mask.id}.feather`
      const readFeatherKeyframes = () => bridge.toolData<KeyframesResult>('getKeyframes', {
        clipId: project.clips.foregroundClipId,
        property: featherProperty,
      })

      await bridge.toolData('setPlayhead', { time: featherStartTime })
      await masks.addFeatherKeyframe()
      await expect.poll(async () => (await readFeatherKeyframes()).keyframes.length).toBe(1)

      await bridge.toolData('setPlayhead', { time: featherEndTime })
      const unfeatheredFrame = await capture(featherEndTime)
      await masks.setFeather(MASK_NAME, 48)
      await expect.poll(async () => (await readFeatherKeyframes()).keyframes.length).toBe(2)
      await expect.poll(async () => (
        await readFeatherKeyframes()
      ).keyframes.find((keyframe) => keyframe.time === featherEndTime)?.value).toBe(48)
      await masks.expectFeatherValue(MASK_NAME, 48)
      const featherFrame = await capture(featherEndTime)
      await saveFrame(testInfo, 'mask-feather-48', featherFrame)
      featherEvidence = await analyzeFrameDifference(
        page,
        unfeatheredFrame.dataUrl,
        featherFrame.dataUrl,
      )
      expect(featherEvidence.changedPixelRatio).toBeGreaterThan(0.005)
      expect((await readFeatherKeyframes()).keyframes.map((keyframe) => keyframe.time)).toEqual([
        featherStartTime,
        featherEndTime,
      ])
    })

    let invertedEvidence: MaskRetentionEvidence | null = null
    await test.step('invert through the UI and prove the retained regions swap', async () => {
      await bridge.toolData('setPlayhead', { time: project.sampleTime })
      await masks.toggleInvert(MASK_NAME)
      await expect.poll(async () => (await readMasks()).masks[0]?.inverted).toBe(true)
      const invertedFrame = await capture()
      await saveFrame(testInfo, 'mask-inverted', invertedFrame)
      invertedEvidence = await analyzeMaskRetention(page, {
        base: baseFrame.dataUrl,
        unmasked: unmaskedFrame.dataUrl,
        candidate: invertedFrame.dataUrl,
      }, referenceRegions())
      expect(invertedEvidence.inner.validPixels).toBeGreaterThan(2_000)
      expect(invertedEvidence.outer.validPixels).toBeGreaterThan(500)
      expect(invertedEvidence.inner.medianRetention).toBeLessThan(0.28)
      expect(invertedEvidence.outer.medianRetention).toBeGreaterThan(0.72)

      await masks.toggleInvert(MASK_NAME)
      await expect.poll(async () => (await readMasks()).masks[0]?.inverted).toBe(false)
    })

    let pathStartPreviewFrame: CapturedFrame
    let pathEndPreviewFrame: CapturedFrame
    await test.step('record a whole-mask move as Mask Path vertices and prove it by scrubbing', async () => {
      const pathStartTime = project.sampleTime
      const pathEndTime = 2.5
      const pathProperty = `mask.${project.mask.id}.path`
      const featherProperty = `mask.${project.mask.id}.feather`
      const readPathKeyframes = () => bridge.toolData<KeyframesResult>('getKeyframes', {
        clipId: project.clips.foregroundClipId,
        property: pathProperty,
      })

      await bridge.toolData('setPlayhead', { time: pathStartTime })
      const beforeMove = (await readMasks()).masks[0]
      expect(beforeMove.position).toEqual({ x: 0, y: 0 })
      await masks.addPathKeyframe()
      await expect.poll(async () => (await readPathKeyframes()).keyframes.length).toBe(1)

      await bridge.toolData('setPlayhead', { time: pathEndTime })
      await masks.dragActiveMaskBy(120, 0)
      await expect.poll(async () => (await readPathKeyframes()).keyframes.length, {
        message: 'Whole-mask drag should add a second Mask Path keyframe.',
      }).toBe(2)

      const afterMove = (await readMasks()).masks[0]
      expect(afterMove.position, 'Animated whole-mask drag must not escape into mask.position.').toEqual(
        beforeMove.position,
      )
      const vertexDeltas = afterMove.vertices.map((vertex, index) => ({
        x: vertex.x - beforeMove.vertices[index].x,
        y: vertex.y - beforeMove.vertices[index].y,
      }))
      expect(Math.abs(vertexDeltas[0].x)).toBeGreaterThan(0.04)
      vertexDeltas.forEach((delta) => {
        expect(delta.x).toBeCloseTo(vertexDeltas[0].x, 5)
        expect(delta.y).toBeCloseTo(vertexDeltas[0].y, 5)
      })

      const keyframes = (await readPathKeyframes()).keyframes
      expect(keyframes.map((keyframe) => keyframe.time)).toEqual([pathStartTime, pathEndTime])
      expect(keyframes.every((keyframe) => keyframe.property === pathProperty)).toBe(true)
      expect(keyframes.every((keyframe) => keyframe.pathValue?.vertices.length === 4)).toBe(true)
      await timeline.expandTrackPropertyWithKeyframes(
        project.tracks.foregroundTrackId,
        pathProperty,
        2,
      )
      await timeline.expandTrackPropertyWithKeyframes(
        project.tracks.foregroundTrackId,
        featherProperty,
        2,
      )

      const duration = (await readTimeline()).duration
      await timeline.scrubToFraction(pathStartTime / duration, pathEndTime / duration)
      await timeline.expectPlayheadNear(readTimeline, pathStartTime, 0.12)
      const startBox = await masks.activeMaskBodyBox()
      await savePageScreenshot(testInfo, page, 'mask-path-scrub-start')
      pathStartPreviewFrame = await capture(pathStartTime)
      await saveFrame(testInfo, 'mask-path-frame-start', pathStartPreviewFrame)

      await timeline.scrubToFraction(pathEndTime / duration, pathStartTime / duration)
      await timeline.expectPlayheadNear(readTimeline, pathEndTime, 0.12)
      const endBox = await masks.activeMaskBodyBox()
      await savePageScreenshot(testInfo, page, 'mask-path-scrub-end')
      pathEndPreviewFrame = await capture(pathEndTime)
      await saveFrame(testInfo, 'mask-path-frame-end', pathEndPreviewFrame)

      expect(endBox.x - startBox.x).toBeGreaterThan(40)
      expect(Math.abs(endBox.y - startBox.y)).toBeLessThan(15)
      await testInfo.attach('mask-path-keyframes.json', {
        body: Buffer.from(JSON.stringify(keyframes, null, 2)),
        contentType: 'application/json',
      })

    })

    if (!maskedEvidence || !featherEvidence || !invertedEvidence) {
      throw new Error('Mask journey completed without all expected visual evidence.')
    }

    await test.step('export the animated mask through the UI and verify decoded frames', async () => {
      await exporter.open()
      await exporter.selectFastWebCodecs()
      await exporter.useCompositionSettings()
      await exporter.setFilename('playwright-mask-reference')

      const artifactPath = testInfo.outputPath('playwright-mask-reference.mp4')
      const download = await exporter.exportTo(artifactPath, 180_000)
      expect(download.suggestedFilename()).toBe('playwright-mask-reference.mp4')

      const metadata = await inspectMediaArtifact(artifactPath)
      assertGoldenVideoArtifact(metadata, {
        width: project.composition.width,
        height: project.composition.height,
        durationSeconds: project.composition.duration,
        requireAudio: false,
        minimumSizeBytes: 50_000,
      })

      const decodedFrames = await decodeVideoArtifactFrames(page, artifactPath, [
        project.sampleTime,
        2.5,
      ])
      expect(decodedFrames).toHaveLength(2)
      decodedFrames.forEach((frame) => {
        expect(frame.width).toBe(project.composition.width)
        expect(frame.height).toBe(project.composition.height)
      })

      const startDifference = await analyzeFrameDifference(
        page,
        pathStartPreviewFrame.dataUrl,
        decodedFrames[0].dataUrl,
      )
      const endDifference = await analyzeFrameDifference(
        page,
        pathEndPreviewFrame.dataUrl,
        decodedFrames[1].dataUrl,
      )
      expect(startDifference.meanAbsoluteDifference).toBeLessThan(20)
      expect(startDifference.changedPixelRatio).toBeLessThan(0.65)
      expect(endDifference.meanAbsoluteDifference).toBeLessThan(20)
      expect(endDifference.changedPixelRatio).toBeLessThan(0.65)

      await saveFrame(testInfo, 'mask-export-frame-start', decodedFrames[0])
      await saveFrame(testInfo, 'mask-export-frame-end', decodedFrames[1])
      await testInfo.attach('mask-export-metadata.json', {
        body: Buffer.from(JSON.stringify(metadata, null, 2)),
        contentType: 'application/json',
      })
      await testInfo.attach('mask-export-frame-differences.json', {
        body: Buffer.from(JSON.stringify({ startDifference, endDifference }, null, 2)),
        contentType: 'application/json',
      })
      await testInfo.attach('mask-export.mp4', {
        path: artifactPath,
        contentType: 'video/mp4',
      })

      if (REVIEW_MODE) await page.pause()
    })

    await testInfo.attach('mask-state.json', {
      body: Buffer.from(JSON.stringify(await readMasks(), null, 2)),
      contentType: 'application/json',
    })
    await testInfo.attach('mask-region-evidence.json', {
      body: Buffer.from(JSON.stringify({
        normal: maskedEvidence,
        featherDifference: featherEvidence,
        inverted: invertedEvidence,
      }, null, 2)),
      contentType: 'application/json',
    })

    await test.step('assert no fatal browser errors escaped the mask journey', async () => {
      expect(failureEvidence.pageErrors, 'Unexpected uncaught page errors.').toEqual([])
      expect(
        unexpectedConsoleErrors(failureEvidence.consoleEntries),
        'Unexpected browser console errors.',
      ).toEqual([])
    })
  },
)

function referenceRegions() {
  return {
    inner: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
    outer: { x: 0.01, y: 0.15, width: 0.06, height: 0.7 },
  }
}

async function saveFrame(
  testInfo: TestInfo,
  name: string,
  frame: { dataUrl: string },
): Promise<void> {
  const match = /^data:image\/png;base64,(.+)$/s.exec(frame.dataUrl)
  if (!match) throw new Error(`${name} is not a PNG data URL.`)
  const path = testInfo.outputPath(`${name}.png`)
  await writeFile(path, Buffer.from(match[1], 'base64'))
  await testInfo.attach(`${name}.png`, { path, contentType: 'image/png' })
}

async function savePageScreenshot(
  testInfo: TestInfo,
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: 'disabled' })
  await testInfo.attach(`${name}.png`, { path, contentType: 'image/png' })
}
