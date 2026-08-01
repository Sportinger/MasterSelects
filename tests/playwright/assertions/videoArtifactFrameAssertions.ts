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
): Promise<DecodedVideoArtifactFrame[]> {
  const encoded = (await readFile(artifactPath)).toString('base64')

  return page.evaluate(async ({ base64, times }) => {
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

    try {
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('loadeddata', () => resolve(), { once: true })
        video.addEventListener('error', () => reject(new Error(
          video.error?.message || 'Browser could not decode the exported video.',
        )), { once: true })
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
        if (Math.abs(video.currentTime - targetTime) > 0.0005) {
          await new Promise<void>((resolve, reject) => {
            video.addEventListener('seeked', () => resolve(), { once: true })
            video.addEventListener('error', () => reject(new Error(
              video.error?.message || `Browser failed to seek export to ${targetTime}s.`,
            )), { once: true })
            video.currentTime = targetTime
          })
        }

        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        frames.push({
          requestedTime,
          decodedTime: video.currentTime,
          duration: video.duration,
          width: canvas.width,
          height: canvas.height,
          dataUrl: canvas.toDataURL('image/png'),
        })
      }
      return frames
    } finally {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
  }, { base64: encoded, times: [...sampleTimes] })
}
