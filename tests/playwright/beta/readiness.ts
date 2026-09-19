import type { TestInfo } from '@playwright/test'
import type { BridgeClient } from '../fixtures/bridgeClient'

export async function waitForReady<T>(testInfo: TestInfo, name: string,
  sample: () => Promise<T>, ready: (state: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const started = Date.now()
  let latest: T | undefined, error: string | undefined, samples = 0, passed = false
  try {
    while (Date.now() - started < timeoutMs) {
      samples++
      let deadline: ReturnType<typeof setTimeout> | undefined
      try {
        latest = await Promise.race([sample(), new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Readiness observation timed out')),
            Math.max(1, timeoutMs - (Date.now() - started)))
        })])
        error = undefined
      }
      catch (failure) { error = String(failure); latest = undefined }
      finally { clearTimeout(deadline) }
      if (latest !== undefined && ready(latest)) { passed = true; return latest }
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    throw new Error(`Readiness timeout: ${name}; last state: ${JSON.stringify(latest ?? error)}`)
  } finally {
    await testInfo.attach(`readiness-${name}`, { body: JSON.stringify({ passed, elapsedMs: Date.now() - started,
      samples, latest, error }), contentType: 'application/json' })
  }
}

interface ImportedFile {
  id: string; name: string; isImporting: boolean; fileSize: number | null
  duration?: number; width?: number; height?: number; hasAudio: boolean | null
}
export async function waitForImports(bridge: BridgeClient, testInfo: TestInfo, names: string[]) {
  return waitForReady(testInfo, 'imports-complete', async () => {
    const { files } = await bridge.toolData<{ files: ImportedFile[] }>('getMediaItems')
    return files.filter(file => names.includes(file.name))
  }, files => files.length === names.length && names.every(name => {
    const matches = files.filter(file => file.name === name)
    return matches.length === 1 && matches[0].isImporting === false && (matches[0].fileSize ?? 0) > 0
      && matches[0].width === 640 && matches[0].height === 360 && (matches[0].duration ?? 0) >= 2.99
      && matches[0].hasAudio === true
  }))
}

interface ClipReady {
  isLoading: boolean; hasFile: boolean
  waveform: { generating: boolean; sampleCount: number; hasSourcePyramid: boolean }
}
export async function waitForClips(bridge: BridgeClient, testInfo: TestInfo, clipIds: string[], audioIds: string[]) {
  return waitForReady(testInfo, 'clip-sources-and-waveforms', async () => {
    const result: Record<string, ClipReady> = {}
    for (const id of [...clipIds, ...audioIds]) {
      const details = await bridge.toolData<ClipReady>('getClipDetails', { clipId: id })
      result[id] = { isLoading: details.isLoading, hasFile: details.hasFile, waveform: details.waveform }
    }
    return result
  }, state => Object.values(state).every(clip => clip.isLoading === false && clip.hasFile === true)
    && audioIds.every(id => !state[id].waveform.generating
      && (state[id].waveform.sampleCount > 0 || state[id].waveform.hasSourcePyramid)))
}
