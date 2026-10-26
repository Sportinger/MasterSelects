import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test as base, expect, type TestInfo } from '@playwright/test'
import { openFrameCodeProject, type FrameCodeProject } from '../fixtures/frameCodeProject'

/**
 * Dropping a file from outside the browser onto the timeline, in stages:
 * stage 1 replays the drop inside the page (a DataTransfer with a real File),
 * stage 2 sends the drag through Chrome's own pipeline with a real file path
 * (DevTools Input.dispatchDragEvent), as an external program would. Stage 3, a
 * real Explorer drag, runs only on the Windows desktop host. Each case drops the
 * frame-code clip at a known time and proves it through the preview's pixels.
 */
interface ClipState { id: string; startTime: number; name?: string }
interface TimelineState { zoom: number; videoTracks: Array<{ id: string; clips: ClipState[] }> }

const test = base.extend<object, { drop: FrameCodeProject }>({
  drop: [async ({ browser }, provide, workerInfo) => {
    const project = await openFrameCodeProject(browser, workerInfo.project.use.baseURL, { composition: 'Drop-Import', placeClip: false })
    await provide(project)
    await project.context.close()
  }, { scope: 'worker', timeout: 180_000 }],
})

test.describe.configure({ timeout: 120_000 })

async function timeline(project: FrameCodeProject): Promise<TimelineState> {
  return project.bridge.toolData<TimelineState>('getTimelineState')
}

// Empty timeline before each case.
async function reset(project: FrameCodeProject): Promise<void> {
  const clips = (await timeline(project)).videoTracks.flatMap(track => track.clips)
  if (clips.length) await project.bridge.toolData('deleteClips', { clipIds: clips.map(clip => clip.id) })
  await expect.poll(async () => (await timeline(project)).videoTracks.flatMap(track => track.clips).length).toBe(0)
}

// The screen point of `seconds` on the first video track: the ruler's left edge is time 0 at the current zoom.
async function dropPoint(project: FrameCodeProject, seconds: number): Promise<{ x: number; y: number; trackId: string }> {
  const state = await timeline(project), track = state.videoTracks[0]
  const ruler = await project.page.locator('[data-ai-id="timeline-ruler"]').boundingBox()
  const row = await project.page.locator(`[data-track-id="${track.id}"]`).first().boundingBox()
  if (!ruler || !row) throw new Error('timeline ruler or track row not visible')
  return { x: ruler.x + seconds * state.zoom, y: row.y + row.height / 2, trackId: track.id }
}

// The dropped clip starts at the drop time (within one frame) and the preview shows its frames there.
async function expectDroppedAt(project: FrameCodeProject, seconds: number, testInfo: TestInfo): Promise<void> {
  const { bridge, probe, clip } = project
  await expect.poll(async () => (await timeline(project)).videoTracks[0]?.clips.length ?? 0, { timeout: 30_000, message: 'no clip arrived on the track' }).toBe(1)
  const placed = (await timeline(project)).videoTracks[0].clips[0]
  testInfo.annotations.push({ type: 'dropped', description: `clip at ${placed.startTime.toFixed(3)} s` })
  expect(Math.abs(placed.startTime - seconds), `clip starts at ${placed.startTime} s, dropped at ${seconds} s`).toBeLessThanOrEqual(1 / clip.fps + 1e-6)
  await project.editor.waitForProjectIdle(30_000)
  await bridge.toolData('setPlayhead', { time: placed.startTime + 10 / clip.fps })
  probe.mark()
  await probe.waitForFrame(10, { allowed: () => true, timeoutMs: 15_000 })
}

test('stage 1: a file dropped onto the timeline (drop event in the page) lands at the drop time @module:timeline-editing @case:timeline.drop-from-os-event', async ({ drop }, testInfo) => {
  await reset(drop)
  const point = await dropPoint(drop, 1)
  const bytes = (await readFile(drop.clip.path)).toString('base64')
  await drop.page.evaluate(({ x, y, bytes, name }) => {
    const data = Uint8Array.from(atob(bytes), char => char.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([data], name, { type: 'video/mp4' }))
    const target = document.elementFromPoint(x, y)
    if (!target) throw new Error(`nothing at ${x},${y}`)
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: transfer }))
    }
  }, { ...point, bytes, name: path.basename(drop.clip.path) })
  await expectDroppedAt(drop, 1, testInfo)
})

test('stage 2: a file dragged in through Chrome\'s drag pipeline with a real path lands at the drop time @module:timeline-editing @case:timeline.drop-from-os-chrome', async ({ drop }, testInfo) => {
  await reset(drop)
  const point = await dropPoint(drop, 2)
  const cdp = await drop.page.context().newCDPSession(drop.page)
  // Copy (1) | Link (2) | Move (16): what a file manager offers.
  const data = { items: [], files: [drop.clip.path], dragOperationsMask: 1 | 2 | 16 }
  await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: point.x - 40, y: point.y, data })
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: point.x - 20, y: point.y, data })
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: point.x, y: point.y, data })
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: point.x, y: point.y, data })
  await cdp.detach()
  await expectDroppedAt(drop, 2, testInfo)
})
