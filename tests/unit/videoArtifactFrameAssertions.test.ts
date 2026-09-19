import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeVideoFramesInBrowser } from '../playwright/assertions/videoArtifactFrameAssertions'

class ProbeVideo extends EventTarget {
  currentTime = 0
  duration = 4
  videoWidth = 1920
  videoHeight = 1080
  error: { message: string } | null = null
  style = { cssText: '' }
  pixels = 'initial'
  callbacks = new Map<number, VideoFrameRequestCallback>()
  private callbackId = 0
  private loads = 0
  setAttribute = vi.fn()
  removeAttribute = vi.fn()
  remove = vi.fn()
  cancelVideoFrameCallback = vi.fn((id: number) => this.callbacks.delete(id))

  requestVideoFrameCallback(callback: VideoFrameRequestCallback) {
    this.callbacks.set(++this.callbackId, callback)
    return this.callbackId
  }

  present(mediaTime: number) {
    this.pixels = `frame-${mediaTime}`
    const pending = [...this.callbacks.values()]
    this.callbacks.clear()
    pending.forEach(callback => callback(0, { mediaTime } as VideoFrameCallbackMetadata))
  }

  load() {
    if (++this.loads !== 1) return
    queueMicrotask(() => {
      this.present(0)
      this.dispatchEvent(new Event('canplaythrough'))
    })
  }
}

describe('export artifact frame evidence', () => {
  let video: ProbeVideo
  let drawImage: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>

  beforeEach(() => {
    video = new ProbeVideo()
    let capturedPixels = ''
    drawImage = vi.fn(() => { capturedPixels = video.pixels })
    revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:export-evidence', revokeObjectURL })
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn() },
      createElement: (tag: string) => tag === 'video' ? video : {
        getContext: () => ({ clearRect: vi.fn(), drawImage }),
        toDataURL: () => capturedPixels,
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('waits beyond seeked and ignores an old presented frame before capturing the next sample', async () => {
    const pending = decodeVideoFramesInBrowser({ base64: '', times: [1, 2.5], frameRate: 30 })
    await Promise.resolve()
    await Promise.resolve()
    expect(video.currentTime).toBe(1)
    video.present(1)
    await Promise.resolve()
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(video.currentTime).toBe(2.5)

    video.dispatchEvent(new Event('seeked'))
    video.present(1.01)
    await Promise.resolve()
    expect(drawImage).toHaveBeenCalledTimes(1)
    video.present(2.5)

    const frames = await pending
    expect(frames.map(frame => [frame.decodedTime, frame.dataUrl])).toEqual([
      [1, 'frame-1'], [2.5, 'frame-2.5'],
    ])
    expect(video.callbacks.size).toBe(0)
    expect(video.remove).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export-evidence')
  })

  it('can sample the already presented initial frame and repeated sample times', async () => {
    const frames = await decodeVideoFramesInBrowser({ base64: '', times: [0, 0], frameRate: 30 })
    expect(frames.map(frame => frame.dataUrl)).toEqual(['frame-0', 'frame-0'])
  })

  it('fails and cleans up when seeking never presents the requested frame', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = decodeVideoFramesInBrowser({ base64: '', times: [2.5], frameRate: 30 })
    const rejected = expect(pending).rejects.toThrow('No exported video frame was presented near 2.5s')
    await Promise.resolve()
    await Promise.resolve()
    video.dispatchEvent(new Event('seeked'))
    await vi.advanceTimersByTimeAsync(10_000)
    await rejected
    expect(drawImage).not.toHaveBeenCalled()
    expect(video.callbacks.size).toBe(0)
    expect(video.remove).toHaveBeenCalledOnce()
  })
})
