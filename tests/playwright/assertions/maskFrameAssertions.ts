import type { Page } from '@playwright/test'

export interface NormalizedRoi {
  x: number
  y: number
  width: number
  height: number
}

export interface MaskRegionEvidence {
  validPixels: number
  meanSignal: number
  meanRetention: number
  medianRetention: number
  p10Retention: number
  p90Retention: number
}

export interface MaskRetentionEvidence {
  width: number
  height: number
  signalThreshold: number
  inner: MaskRegionEvidence
  outer: MaskRegionEvidence
}

export async function analyzeMaskRetention(
  page: Page,
  frames: {
    base: string
    unmasked: string
    candidate: string
  },
  regions: {
    inner: NormalizedRoi
    outer: NormalizedRoi
  },
): Promise<MaskRetentionEvidence> {
  return page.evaluate(async ({ frameSources, rois }) => {
    const images = await Promise.all([
      decode(frameSources.base),
      decode(frameSources.unmasked),
      decode(frameSources.candidate),
    ])
    const [base, unmasked, candidate] = images
    if (
      base.width !== unmasked.width
      || base.height !== unmasked.height
      || base.width !== candidate.width
      || base.height !== candidate.height
    ) {
      throw new Error('Mask evidence frames have different dimensions.')
    }

    const signalThreshold = 12
    const measure = (roi: { x: number; y: number; width: number; height: number }) => {
      const xStart = Math.max(0, Math.floor(roi.x * base.width))
      const yStart = Math.max(0, Math.floor(roi.y * base.height))
      const xEnd = Math.min(base.width, Math.ceil((roi.x + roi.width) * base.width))
      const yEnd = Math.min(base.height, Math.ceil((roi.y + roi.height) * base.height))
      const retentions: number[] = []
      let signalSum = 0

      for (let y = yStart; y < yEnd; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          const offset = (y * base.width + x) * 4
          const deltaR = unmasked.data[offset] - base.data[offset]
          const deltaG = unmasked.data[offset + 1] - base.data[offset + 1]
          const deltaB = unmasked.data[offset + 2] - base.data[offset + 2]
          const energy = deltaR * deltaR + deltaG * deltaG + deltaB * deltaB
          const signal = Math.sqrt(energy / 3)
          if (signal < signalThreshold) continue

          const appliedR = candidate.data[offset] - base.data[offset]
          const appliedG = candidate.data[offset + 1] - base.data[offset + 1]
          const appliedB = candidate.data[offset + 2] - base.data[offset + 2]
          const projection = (
            appliedR * deltaR + appliedG * deltaG + appliedB * deltaB
          ) / energy
          retentions.push(Math.max(-0.25, Math.min(1.25, projection)))
          signalSum += signal
        }
      }

      retentions.sort((left, right) => left - right)
      const percentile = (fraction: number) => retentions[
        Math.min(retentions.length - 1, Math.max(0, Math.floor(retentions.length * fraction)))
      ] ?? 0
      return {
        validPixels: retentions.length,
        meanSignal: signalSum / Math.max(1, retentions.length),
        meanRetention: retentions.reduce((sum, value) => sum + value, 0)
          / Math.max(1, retentions.length),
        medianRetention: percentile(0.5),
        p10Retention: percentile(0.1),
        p90Retention: percentile(0.9),
      }
    }

    return {
      width: base.width,
      height: base.height,
      signalThreshold,
      inner: measure(rois.inner),
      outer: measure(rois.outer),
    }

    async function decode(source: string): Promise<ImageData> {
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Could not create a mask evidence canvas context.')
      context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, canvas.width, canvas.height)
    }
  }, { frameSources: frames, rois: regions })
}

export async function analyzeFrameDifference(
  page: Page,
  leftSource: string,
  rightSource: string,
): Promise<{ meanAbsoluteDifference: number; changedPixelRatio: number }> {
  return page.evaluate(async ({ leftUrl, rightUrl }) => {
    const [left, right] = await Promise.all([decode(leftUrl), decode(rightUrl)])
    if (left.width !== right.width || left.height !== right.height) {
      throw new Error('Difference evidence frames have different dimensions.')
    }
    let absoluteDifference = 0
    let changedPixels = 0
    const pixelCount = left.width * left.height
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const offset = pixel * 4
      const difference = (
        Math.abs(left.data[offset] - right.data[offset])
        + Math.abs(left.data[offset + 1] - right.data[offset + 1])
        + Math.abs(left.data[offset + 2] - right.data[offset + 2])
      ) / 3
      absoluteDifference += difference
      if (difference > 6) changedPixels += 1
    }
    return {
      meanAbsoluteDifference: absoluteDifference / Math.max(1, pixelCount),
      changedPixelRatio: changedPixels / Math.max(1, pixelCount),
    }

    async function decode(source: string): Promise<ImageData> {
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Could not create a difference evidence canvas context.')
      context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, canvas.width, canvas.height)
    }
  }, { leftUrl: leftSource, rightUrl: rightSource })
}
