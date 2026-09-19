import { readFile } from 'node:fs/promises'
import { test, expect } from './windowsFixture'
import { MaskDriver } from '../drivers/MaskDriver'
import { TimelineDriver } from '../drivers/TimelineDriver'
import { ExportDriver } from '../drivers/ExportDriver'
import { inspectMediaArtifact, assertGoldenVideoArtifact } from '../assertions/mediaArtifactAssertions'
import { unexpectedConsoleErrors } from '../assertions/consoleAssertions'
import { prepareMedia, settledPreview, decodeRgb, compareRgb, assertPatternFrame, inspectAudioSignal } from './mediaOracle'
import { waitForReady, waitForImports, waitForClips } from './readiness'
import { inspectFrameSequence } from './temporalOracle'
import { verifyExportPlayback } from './exportPlayback'
import { isExistingPage } from './existingPlayer'
import { unexpectedExistingConsoleErrors } from './existingConsoleOrigin'

interface Clip { id: string; name: string; duration: number; startTime: number; linkedClipId?: string }
interface Timeline { playheadPosition: number; duration: number; zoom: number; selectedClipIds: string[]; videoTracks: Array<{ id: string; clips: Clip[] }> }
interface Mask { id: string; name: string; feather: number; position?: { x: number; y: number }; vertices: Array<{ x: number; y: number }> }

for (const pattern of [false, true]) {
  test(`${pattern ? 'Pattern oracle' : 'Real footage'}: import, drag, trim, mask, undo, export @beta`,
    async ({ page, bridge, failureEvidence }, testInfo) => {
      const readTimeline = () => bridge.toolData<Timeline>('getTimelineState')
      const masks = new MaskDriver(page), timeline = new TimelineDriver(page), exporter = new ExportDriver(page)
      const files = await prepareMedia(testInfo, pattern)
      let foreground!: Clip, preview!: string, sampleTime = 0
      const readMask = async () => (await bridge.toolData<{ masks: Mask[] }>('getMasks', { clipId: foreground.id })).masks[0]
      await test.step('Preflight and declared setup: empty 640x360 composition', async () => {
        await waitForReady(testInfo, 'editor-ready', async () => {
          const stats = await bridge.toolData<{ engineReady: boolean; projectLoadProgress: { active: boolean } }>('getStats')
          return { engineReady: stats.engineReady, projectLoadProgress: stats.projectLoadProgress }
        }, state => state.engineReady === true && state.projectLoadProgress.active === false)
        const cdp = await page.context().browser()!.newBrowserCDPSession()
        const hardware = await cdp.send('SystemInfo.getInfo'); await cdp.detach()
        await testInfo.attach('hardware', { body: JSON.stringify(hardware, null, 2), contentType: 'application/json' })
        const runtime = await bridge.toolData<{ gpu?: { vendor?: string; architecture?: string } }>('getStats')
        await testInfo.attach('active-gpu', { body: JSON.stringify(runtime.gpu), contentType: 'application/json' })
        expect(runtime.gpu?.vendor).toMatch(/nvidia|amd|intel/i)
        expect(hardware.gpu.auxAttributes?.glRenderer).not.toMatch(/SwiftShader|llvmpipe|Microsoft Basic Render/i)
        expect(hardware.gpu.featureStatus?.webgpu).toMatch(/^enabled/)
        await bridge.toolData('createComposition', { name: `Windows beta ${pattern ? 'pattern' : 'real footage'}`,
          width: 640, height: 360, frameRate: 30, duration: 3 })
        let state = await readTimeline()
        while (state.videoTracks.length < 2) {
          await bridge.toolData('createTrack', { type: 'video' }); state = await readTimeline()
        }
        await testInfo.attach('setup-boundary', { body: JSON.stringify({
          mutations: ['createComposition', 'createTrack if needed'],
          projectDirectory: isExistingPage(page) ? 'Root-provided loaded MSTEST; native folder setup not covered'
            : 'Native Windows folder creation/selection and Chrome permission through desktop input',
          fileInput: 'Browser file input API; the media Open File dialog is not covered',
          actionPhase: 'Only mouse/keyboard/visible controls; bridge observation is read-only',
        }), contentType: 'application/json' })
      })
      await test.step('Import two fixed media files through the browser input', async () => {
        await page.locator('#media-panel-import-input').setInputFiles(files)
        await expect(page.getByText('beta-background.mp4', { exact: true }).first()).toBeVisible()
        await expect(page.getByText('beta-foreground.mp4', { exact: true }).first()).toBeVisible()
        await waitForImports(bridge, testInfo, ['beta-background.mp4', 'beta-foreground.mp4'])
      })
      await test.step('Drag both media items onto separate video tracks', async () => {
        const tracks = (await readTimeline()).videoTracks
        for (const [index, name] of ['beta-foreground.mp4', 'beta-background.mp4'].entries()) {
          const media = page.locator('.media-item, .media-grid-item').filter({ hasText: name })
          const lane = page.locator(`.track-lane[data-track-id="${tracks[index].id}"] .track-clip-row`)
          await expect(media).toBeVisible(); await expect(lane).toBeVisible()
          await media.dragTo(lane, { targetPosition: { x: 2, y: 20 } })
          await expect.poll(async () => (await readTimeline()).videoTracks[index].clips.length).toBe(1)
        }
        foreground = (await readTimeline()).videoTracks[0].clips[0]
        expect(foreground.startTime).toBeCloseTo(0, 1)
        const clips = (await readTimeline()).videoTracks.flatMap(track => track.clips)
        await waitForClips(bridge, testInfo, clips.map(clip => clip.id),
          clips.flatMap(clip => clip.linkedClipId ? [clip.linkedClipId] : []))
      })
      await test.step('Trim the foreground clip with a real pointer drag', async () => {
        // Canvas clips mount interaction controls after pointer selection.
        const track = (await readTimeline()).videoTracks[0]
        const row = page.locator(`.track-lane[data-track-id="${track.id}"] .track-clip-row`)
        await row.click({ position: { x: (await readTimeline()).zoom * 0.5, y: 30 } })
        await expect.poll(async () => (await readTimeline()).selectedClipIds).toContain(foreground.id)
        const clip = page.locator(`.clip-interaction-shell[data-clip-id="${foreground.id}"]`)
        const handle = clip.locator('[data-shell-trim-edge="right"]')
        await expect(handle).toBeVisible()
        const box = (await handle.boundingBox())!, clipBox = (await clip.boundingBox())!
        const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 1200),
          { x: box.x + box.width / 2, y: box.y + box.height / 2 })
        await testInfo.attach('trim-hit', { body: JSON.stringify({ box, clipBox, hit }), contentType: 'application/json' })
        expect(hit).toContain('trim-handle')
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down(); await page.mouse.move(box.x - clipBox.width / 6, box.y + box.height / 2, { steps: 12 }); await page.mouse.up()
        await expect.poll(async () => (await readTimeline()).videoTracks[0].clips[0].duration).toBeLessThan(2.8)
        expect((await readTimeline()).videoTracks[0].clips[0].duration).toBeGreaterThan(2)
      })
      await test.step('Seek and wait for the independently decoded foreground frame', async () => {
        const rulerBox = (await timeline.ruler.boundingBox())!
        await timeline.scrubToFraction(0.5 * (await readTimeline()).zoom / rulerBox.width, 0)
        await timeline.expectPlayheadNear(readTimeline, 0.5, 0.08)
        const sourceTime = (await readTimeline()).playheadPosition - foreground.startTime
        await settledPreview(page, testInfo, 'decoded-foreground-ready', await decodeRgb(files[1], sourceTime))
      })
      await test.step('Create rectangle mask, drag it, and verify keyboard undo/redo', async () => {
        await page.getByRole('tab', { name: 'Properties', exact: true }).click()
        await masks.open(); await masks.addRectangle(); await masks.expectRectangleOverlay()
        const before = (await readMask()).position ?? { x: 0, y: 0 }
        await masks.dragActiveMaskBy(18, 0)
        await expect.poll(async () => (await readMask()).position?.x ?? 0).toBeGreaterThan(before.x + 0.005)
        const after = (await readMask()).position
        await page.keyboard.press('Control+z')
        await expect.poll(async () => (await readMask()).position ?? { x: 0, y: 0 }).toEqual(before)
        await page.keyboard.press('Control+Shift+z')
        await expect.poll(async () => (await readMask()).position).toEqual(after)
        await masks.setFeather('Rectangle Mask', 12)
        await expect.poll(async () => (await readMask()).feather).toBe(12)
        await testInfo.attach('mask-state', { body: JSON.stringify(await readMask(), null, 2), contentType: 'application/json' })
      })
      await test.step('Scrub and verify settled preview pixels', async () => {
        const rulerBox = (await timeline.ruler.boundingBox())!
        await timeline.scrubToFraction(0.5 * (await readTimeline()).zoom / rulerBox.width, 0)
        await timeline.expectPlayheadNear(readTimeline, 0.5, 0.08)
        sampleTime = (await readTimeline()).playheadPosition
        preview = await settledPreview(page, testInfo, 'preview-reference')
        if (pattern) assertPatternFrame(await decodeRgb(preview))
        await testInfo.attach('timeline-after', { body: JSON.stringify(await readTimeline(), null, 2), contentType: 'application/json' })
        await testInfo.attach('ui-after', { body: await page.screenshot(), contentType: 'image/png' })
      })
      await test.step('Export using WebCodecs Fast and independently decode its output', async () => {
        await exporter.open()
        // No retry or alternate export route in this qualification journey.
        await exporter.panel.getByRole('combobox', { name: 'Export method', exact: true }).click()
        await page.getByRole('option', { name: 'WebCodecs Fast', exact: true }).click()
        await expect(exporter.panel.getByRole('combobox', { name: 'Export method', exact: true })).toContainText('WebCodecs Fast')
        await exporter.useCompositionSettings()
        await exporter.panel.getByRole('textbox', { name: 'Output name', exact: true }).fill('windows-beta')
        const output = testInfo.outputPath('windows-beta.mp4')
        const download = await exporter.exportTo(output)
        expect(download.suggestedFilename()).toBe('windows-beta.mp4')
        await testInfo.attach('download-name', { body: JSON.stringify({ suggestedFilename: download.suggestedFilename() }), contentType: 'application/json' })
        const execution = await bridge.toolData<{ export: { last: { status: string; settings: { exportMode: string } } } }>('getStats')
        await testInfo.attach('export-path', { body: JSON.stringify(execution.export), contentType: 'application/json' })
        expect(execution.export.last.status).toBe('success')
        expect(execution.export.last.settings.exportMode).toBe('fast')
        const metadata = await inspectMediaArtifact(output)
        assertGoldenVideoArtifact(metadata, { width: 640, height: 360, durationSeconds: 3, requireAudio: true })
        expect(metadata.mimeType).toMatch(/^video\/mp4(?:;|$)/)
        expect(metadata.videoTracks[0].codec).toBe('avc')
        expect(metadata.audioTracks[0].codec).toBe('aac')
        expect(metadata.videoTracks[0].packetCount).toBe(90)
        const frame = await decodeRgb(output, sampleTime)
        const difference = compareRgb(await decodeRgb(preview), frame)
        await testInfo.attach('export-verification', { body: JSON.stringify({ metadata, sampleTime, meanAbsoluteRgbDifference: difference }), contentType: 'application/json' })
        expect(difference).toBeLessThan(15)
        const audio = await inspectAudioSignal(output)
        await testInfo.attach('audio-verification', { body: JSON.stringify(audio), contentType: 'application/json' })
        expect(audio.rms).toBeGreaterThan(0.0001)
        if (pattern) {
          for (const tone of audio.tones) expect(tone.amplitude).toBeGreaterThan(0.01)
          assertPatternFrame(frame)
          // Negative control: deliberately wrong all-black output must be rejected.
          expect(() => assertPatternFrame(Buffer.alloc(frame.length))).toThrow('Pattern mismatch')
        }
        await testInfo.attach('export', { path: output, contentType: 'video/mp4' })
        expect((await readFile(output)).length).toBeGreaterThan(1024)
        const state = await readTimeline()
        await inspectFrameSequence(output, testInfo, pattern ? {
          foreground: state.videoTracks[0].clips[0], background: state.videoTracks[1].clips[0],
        } : undefined)
        await verifyExportPlayback(page, output, testInfo)
      })
      await test.step('Verify diagnostics and record actual execution paths', async () => {
        const stats = await bridge.toolData('getStats')
        await testInfo.attach('final-runtime', { body: JSON.stringify(stats, null, 2), contentType: 'application/json' })
        expect(failureEvidence.pageErrors).toEqual([])
        await testInfo.attach('object-url-audit', { body: JSON.stringify(await page.evaluate(() =>
          (window as unknown as { __betaObjectUrlAudit: unknown }).__betaObjectUrlAudit)), contentType: 'application/json' })
        const errors = isExistingPage(page)
          ? await unexpectedExistingConsoleErrors(page, failureEvidence.consoleEntries, testInfo)
          : unexpectedConsoleErrors(failureEvidence.consoleEntries)
        expect(errors.length, JSON.stringify(errors.slice(0, 3))).toBe(0)
      })
    })
}
