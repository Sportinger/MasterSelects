import { execFile } from 'node:child_process'
import { access, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'
import { DEFAULT_REPO_ROOT } from '../fixtures/bridgeClient'

/**
 * Probes and media of the M3 captions and audio-effects journeys (m3-captions.spec.ts,
 * m3-audiofx.spec.ts). The probe is an inline module script that imports the editor's modules from
 * the Vite dev server, so it reads (and, for arrangement only, writes) the same store instances
 * the phone UI uses. The only arrangement it writes is a deterministic transcript (a fixed
 * provider answer, through the editor's own updateClipTranscript) and the transcription provider
 * setting, which the captions case restores.
 */
const run = promisify(execFile)
const MEDIA_DIR = path.join(DEFAULT_REPO_ROOT, 'test-results', 'playwright', 'frame-code-media')

/** 1 s tone, 1 s digital silence, 1 s tone (440 Hz, 1/8 amplitude, stereo 48 kHz). */
export async function toneSilenceTone(): Promise<string> {
  const file = path.join(MEDIA_DIR, 'm3-tone-silence-tone-v1.wav')
  if (await access(file).then(() => true, () => false)) return file
  await mkdir(MEDIA_DIR, { recursive: true })
  const temporary = `${file}.${process.pid}.tmp.wav`
  await run('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000',
    '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]', '-map', '[out]', '-ac', '2', temporary])
  await rename(temporary, file)
  return file
}

export interface ProbeWord { id: string; text: string; start: number; end: number }

export interface CaptionReading {
  id: string
  startTime: number
  duration: number
  sourceClipId: string | null
  wordsPerCaption: number
  background: boolean
  highlightMode: string
  highlightStyle: string
  textTransform: string
  fontSize: number | null
}

const PROBE_SOURCE = `
import { useTimelineStore } from '/src/stores/timeline/index.ts';
import { useMediaStore } from '/src/stores/mediaStore/index.ts';
import { useSettingsStore } from '/src/stores/settingsStore.ts';
import { updateClipTranscript } from '/src/services/transcription/artifactPersistence.ts';

// Key order of restored objects may differ after an undo; the snapshot compares values, not key order.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

window.__phoneM3Probe = {
  snapshot() {
    const state = useTimelineStore.getState();
    const clips = state.clips.map(clip => ({
      id: clip.id, trackId: clip.trackId, startTime: clip.startTime, duration: clip.duration, inPoint: clip.inPoint, outPoint: clip.outPoint,
      linkedClipId: clip.linkedClipId ?? null,
      effects: (clip.effects ?? []).map(effect => ({ id: effect.id, type: effect.type, enabled: effect.enabled, params: effect.params })),
      audioFx: (clip.audioState?.effectStack ?? []).map(effect => ({ id: effect.id, d: effect.descriptorId, enabled: effect.enabled, params: effect.params })),
      edits: (clip.audioState?.editStack ?? []).map(op => ({ id: op.id, type: op.type, enabled: op.enabled })),
      muted: clip.audioState?.muted === true,
      caption: clip.captionProperties ?? null,
      text: clip.textProperties ? { color: clip.textProperties.color, fontSize: clip.textProperties.fontSize, fontWeight: clip.textProperties.fontWeight, strokeEnabled: clip.textProperties.strokeEnabled } : null,
    })).sort((a, b) => a.id.localeCompare(b.id));
    const keyframes = [...state.clipKeyframes.entries()]
      .map(([clipId, list]) => [clipId, list.map(k => [k.id, k.property, k.time, k.value, k.easing])])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return JSON.stringify(canonical({ tracks: state.tracks.map(track => [track.id, track.type]), clips, keyframes }));
  },
  audioFx(clipId) {
    const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
    return (clip?.audioState?.effectStack ?? []).map(effect => ({ id: effect.id, descriptorId: effect.descriptorId, enabled: effect.enabled !== false, params: effect.params }));
  },
  clip(clipId) {
    const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
    return clip ? { id: clip.id, startTime: clip.startTime, duration: clip.duration, edits: (clip.audioState?.editStack ?? []).length } : null;
  },
  setTranscript(clipId, words) {
    const full = words === null ? undefined : words.map(word => ({ ...word, confidence: 1 }));
    const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
    const mediaFileId = clip?.mediaFileId ?? clip?.source?.mediaFileId;
    // The shared media file carries the transcript too (word corrections read it first), so every case starts from the same words.
    if (mediaFileId) {
      useMediaStore.setState(state => ({ files: state.files.map(file => file.id === mediaFileId
        ? { ...file, transcript: full, transcriptArtifact: undefined, transcriptStatus: full ? 'ready' : 'none' } : file) }));
    }
    updateClipTranscript(clipId, { status: full ? 'ready' : 'none', progress: full ? 100 : 0, words: full });
    useTimelineStore.getState().invalidateCache();
  },
  words(clipId) {
    const state = useTimelineStore.getState();
    const clip = state.clips.find(candidate => candidate.id === clipId);
    if (!clip) return [];
    const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
    const file = mediaFileId ? useMediaStore.getState().files.find(candidate => candidate.id === mediaFileId) : undefined;
    const words = file?.transcript?.length ? file.transcript : clip.transcript ?? [];
    return words.map(word => ({ id: word.id, text: word.text, start: word.start, end: word.end }));
  },
  captions() {
    return useTimelineStore.getState().clips.filter(clip => clip.captionProperties).map(clip => ({
      id: clip.id, startTime: clip.startTime, duration: clip.duration, sourceClipId: clip.captionProperties.sourceClipId,
      wordsPerCaption: clip.captionProperties.wordsPerCaption, background: clip.captionProperties.background.enabled,
      highlightMode: clip.captionProperties.highlight.mode, highlightStyle: clip.captionProperties.highlight.style,
      textTransform: clip.captionProperties.textTransform, fontSize: clip.textProperties?.fontSize ?? null,
    }));
  },
  provider() { return useSettingsStore.getState().transcriptionProvider; },
  setProvider(provider) { useSettingsStore.getState().setTranscriptionProvider(provider); },
};
window.dispatchEvent(new Event('phone-m3-probe-ready'));
`

async function ensureProbe(page: Page): Promise<void> {
  if (await page.evaluate(() => Boolean((window as unknown as { __phoneM3Probe?: unknown }).__phoneM3Probe))) return
  await page.addScriptTag({ type: 'module', content: PROBE_SOURCE })
  await page.waitForFunction(() => Boolean((window as unknown as { __phoneM3Probe?: unknown }).__phoneM3Probe), undefined, { timeout: 30_000 })
}

interface Probe {
  snapshot(): string
  audioFx(clipId: string): Array<{ id: string; descriptorId: string; enabled: boolean; params: Record<string, unknown> }>
  clip(clipId: string): { id: string; startTime: number; duration: number; edits: number } | null
  setTranscript(clipId: string, words: ProbeWord[] | null): void
  words(clipId: string): ProbeWord[]
  captions(): CaptionReading[]
  provider(): string
  setProvider(provider: string): void
}

async function call<T>(page: Page, method: keyof Probe, ...args: unknown[]): Promise<T> {
  await ensureProbe(page)
  return page.evaluate(({ method, args }) => {
    const probe = (window as unknown as { __phoneM3Probe: Record<string, (...values: unknown[]) => unknown> }).__phoneM3Probe
    return probe[method](...args)
  }, { method, args }) as Promise<T>
}

/** Stable JSON of tracks, clips (timing, links, effects, audio effect stack, edit list, captions) and keyframes. */
export const m3Snapshot = (page: Page) => call<string>(page, 'snapshot')
export const audioFxOf = (page: Page, clipId: string) => call<ReturnType<Probe['audioFx']>>(page, 'audioFx', clipId)
export const clipOf = (page: Page, clipId: string) => call<ReturnType<Probe['clip']>>(page, 'clip', clipId)
/** Fixed provider answer for one clip (and its media file); null clears it again. */
export const setTranscript = (page: Page, clipId: string, words: ProbeWord[] | null) => call<void>(page, 'setTranscript', clipId, words)
export const transcriptWords = (page: Page, clipId: string) => call<ProbeWord[]>(page, 'words', clipId)
export const captionClips = (page: Page) => call<CaptionReading[]>(page, 'captions')
export const transcriptionProvider = (page: Page) => call<string>(page, 'provider')
export const setTranscriptionProvider = (page: Page, provider: string) => call<void>(page, 'setProvider', provider)
