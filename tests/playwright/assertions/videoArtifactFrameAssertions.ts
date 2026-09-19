import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

export interface DecodedVideoArtifactFrame {
  requestedTime: number
  decodedTime: number
  duration: number
  width: number
  height: number
  dataUrl: string
}

export async function decodeVideoArtifactFrames(
  page: Page,
  artifactPath: string,
  sampleTimes: readonly number[],
  frameRate = 30,
): Promise<DecodedVideoArtifactFrame[]> {
  const encoded = (await readFile(artifactPath)).toString('base64')

  return page.evaluate(decodeVideoFramesInBrowser, {
    base64: encoded, times: [...sampleTimes], frameRate,
  })
}

// Self-contained because Playwright serializes this function into the browser.
export async function decodeVideoFramesInBrowser({ base64, times, frameRate }: {
  base64: string
  times: number[]
  frameRate: number
}): Promise<DecodedVideoArtifactFrame[]> {
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new Error('Export frame sampling requires a positive frame rate.')
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = url
  let frameCallback: number | undefined
  let presentedTime: number | null = null
  let onPresentedFrame: ((mediaTime: number) => void) | null = null

  try {
    if (typeof video.requestVideoFrameCallback !== 'function') {
      throw new Error('Export frame sampling requires requestVideoFrameCallback.')
    }
    // A detached/hidden video need not present frames. Keep this test-only surface
    // tiny and outside normal layout, but visible to the browser compositor.
    video.playsInline = true
    video.setAttribute('aria-hidden', 'true')
    video.style.cssText = 'position:fixed;right:0;bottom:0;width:16px;height:9px;pointer-events:none;z-index:2147483647'
    document.body.appendChild(video)
    const observeFrame: VideoFrameRequestCallback = (_now, metadata) => {
      presentedTime = metadata.mediaTime
      onPresentedFrame?.(metadata.mediaTime)
      frameCallback = video.requestVideoFrameCallback(observeFrame)
    }
    // Register before loading/seeking so an already delivered frame cannot be missed.
    frameCallback = video.requestVideoFrameCallback(observeFrame)
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout)
        video.removeEventListener('canplaythrough', ready)
        video.removeEventListener('error', failed)
        if (error) reject(error)
        else resolve()
      }
      const ready = () => finish()
      const failed = () => finish(new Error(
        video.error?.message || 'Browser could not decode the exported video.',
      ))
      const timeout = setTimeout(() => finish(new Error('Export video loading timed out.')), 10_000)
      video.addEventListener('canplaythrough', ready, { once: true })
      video.addEventListener('error', failed, { once: true })
      video.load()
    })

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error(`Decoded export has an invalid duration: ${video.duration}.`)
    }
    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error('Decoded export has no visible video dimensions.')
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Could not create a canvas for exported video frames.')

    const frames = []
    for (const requestedTime of times) {
      const targetTime = Math.min(
        Math.max(0, requestedTime),
        Math.max(0, video.duration - 0.001),
      )
      const atTarget = (mediaTime: number) => Math.abs(mediaTime - targetTime) <= 1 / frameRate + 0.0005
      if (Math.abs(video.currentTime - targetTime) > 0.0005
        || presentedTime === null || !atTarget(presentedTime)) {
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            clearTimeout(timeout)
            video.removeEventListener('error', failed)
            onPresentedFrame = null
            if (error) reject(error)
            else resolve()
          }
          const failed = () => finish(new Error(
            video.error?.message || `Browser failed to seek export to ${targetTime}s.`,
          ))
          const timeout = setTimeout(() => finish(new Error(
            `No exported video frame was presented near ${targetTime}s (last PTS: ${presentedTime}).`,
          )), 10_000)
          video.addEventListener('error', failed, { once: true })
          onPresentedFrame = (mediaTime) => { if (atTarget(mediaTime)) finish() }
          // seeked/currentTime can advance before drawImage sees the new pixels.
          video.currentTime = targetTime
        })
      }

      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push({
        requestedTime,
        decodedTime: presentedTime!,
        duration: video.duration,
        width: canvas.width,
        height: canvas.height,
        dataUrl: canvas.toDataURL('image/png'),
      })
    }
    return frames
  } finally {
    if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback)
    video.removeAttribute('src')
    video.load()
    video.remove()
    URL.revokeObjectURL(url)
  }
}
