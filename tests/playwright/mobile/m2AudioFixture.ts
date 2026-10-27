import { execFile, spawnSync } from 'node:child_process'
import { access, mkdir, rename } from 'node:fs/promises'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, type Page } from '@playwright/test'
import { DEFAULT_REPO_ROOT } from '../fixtures/bridgeClient'
import { frameCodeClip } from '../fixtures/frameCodeMedia'

/**
 * Media and probes of the M2 audio journeys (m2-audio.spec.ts).
 *
 * The truth for sound is the PCM the export renders: `AudioExportPipeline.exportRawAudio`
 * (the export's own mix of trims, clip effects, volume keyframes, mute, track and master bus,
 * without the encoder; the desktop "Measure" preflight uses the same call). The probe is an
 * inline module script that imports the editor's modules from the Vite dev server, so it
 * reads the same store instance the phone UI writes.
 */
const run = promisify(execFile)
const MEDIA_DIR = path.join(DEFAULT_REPO_ROOT, 'test-results', 'playwright', 'frame-code-media')

/** 440 Hz sine, ffmpeg's default amplitude 1/8 (RMS 0.0884), stereo, 48 kHz. */
export const TONE_SECONDS = 2

export interface M2AudioMedia {
  /** 2 s tone (WAV). */
  tone: string
  /** 2 s frame-code video (360x640, 30 fps) with the same tone as AAC sound. */
  videoWithTone: string
}

async function cached(file: string, make: (temporary: string) => Promise<unknown>, extension: string): Promise<string> {
  if (await access(file).then(() => true, () => false)) return file
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp.${extension}`
  await make(temporary)
  await rename(temporary, file)
  return file
}

export async function generateM2AudioMedia(): Promise<M2AudioMedia> {
  const tone = await cached(path.join(MEDIA_DIR, 'm2-tone-2s-v1.wav'), temporary => run('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${TONE_SECONDS}:sample_rate=48000`, '-ac', '2', temporary]), 'wav')
  const video = await frameCodeClip({ width: 360, height: 640, fps: 30, seconds: TONE_SECONDS })
  const videoWithTone = await cached(path.join(MEDIA_DIR, 'm2-fc-tone-2s-v1.mp4'), temporary => run('ffmpeg', ['-y', '-loglevel', 'error',
    '-i', video.path, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${TONE_SECONDS}:sample_rate=48000`,
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-shortest', '-movflags', '+faststart', temporary]), 'mp4')
  return { tone, videoWithTone }
}

/** A tone no other case imported (own content), so the editor treats it as a brand-new source. */
export async function uniqueTone(directory: string): Promise<string> {
  const frequency = 300 + Math.floor(Math.random() * 600)
  const file = path.join(directory, `m2-unique-tone-${frequency}-${process.pid}-${Date.now()}.wav`)
  await mkdir(directory, { recursive: true })
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${TONE_SECONDS}:sample_rate=48000`, '-ac', '2', file])
  return file
}

/**
 * The fake microphone's input: a 440 Hz tone the browser loops (launch flag
 * --use-file-for-fake-audio-capture). Created synchronously because launch options are
 * read when the spec file loads.
 */
export function fakeMicrophoneFile(): string {
  const file = path.join(MEDIA_DIR, 'm2-fake-mic-440-v1.wav')
  if (existsSync(file)) return file
  mkdirSync(MEDIA_DIR, { recursive: true })
  const temporary = `${file}.${process.pid}.tmp.wav`
  const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10:sample_rate=48000',
    '-ac', '1', '-af', 'volume=4', temporary], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`ffmpeg could not make the fake microphone file: ${result.stderr || result.error?.message}`)
  renameSync(temporary, file)
  return file
}

export function fakeMicrophoneArgs(): string[] {
  return ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fakeMicrophoneFile()}`]
}

// ---------------------------------------------------------------------------
// In-page probe
// ---------------------------------------------------------------------------

const PROBE_SOURCE = `
import { useTimelineStore } from '/src/stores/timeline/index.ts';
import { AudioExportPipeline } from '/src/engine/audio/AudioExportPipeline.ts';
import { hasOpenEditorGestures } from '/src/services/project/repository/transaction/editorGestureOwnership.ts';
import { getEditorHistoryAvailability } from '/src/services/project/repository/transaction/editorHistory.ts';
import { getEditorRepositorySession, withSourceIdentitiesPaused } from '/src/services/project/repository/transaction/editorMutationRuntime.ts';
import { useMediaStore } from '/src/stores/mediaStore/index.ts';

function rmsOf(data, from, to) {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += data[index] * data[index];
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

window.__phoneAudioProbe = {
  async mixRms(start, end, windows) {
    const pipeline = new AudioExportPipeline({ sampleRate: 48000, normalize: false });
    const buffer = await pipeline.exportRawAudio(start, end);
    if (!buffer) return windows.map(() => 0);
    const data = buffer.getChannelData(0);
    return windows.map(([from, to]) => rmsOf(data,
      Math.max(0, Math.floor((from - start) * buffer.sampleRate)),
      Math.min(data.length, Math.floor((to - start) * buffer.sampleRate))));
  },
  snapshot() {
    const state = useTimelineStore.getState();
    const clips = state.clips.map(clip => ({
      id: clip.id, trackId: clip.trackId, startTime: clip.startTime, duration: clip.duration, inPoint: clip.inPoint,
      linkedClipId: clip.linkedClipId ?? null,
      effects: (clip.effects ?? []).map(effect => ({ id: effect.id, type: effect.type, enabled: effect.enabled, params: effect.params })),
      muted: clip.audioState?.muted === true,
    })).sort((a, b) => a.id.localeCompare(b.id));
    const keyframes = [...state.clipKeyframes.entries()]
      .map(([clipId, list]) => [clipId, list.map(k => [k.id, k.property, k.time, k.value, k.easing])])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return JSON.stringify({ tracks: state.tracks.map(track => [track.id, track.type]), clips, keyframes });
  },
  history() {
    const coordinator = getEditorRepositorySession()?.coordinator;
    const open = coordinator && coordinator.transactions ? [...coordinator.transactions.values()].map(tx => tx.label) : [];
    // Diagnostics only: the chain of the last local revisions (label, source, changed entities).
    const chain = [];
    let cursor = coordinator?.getStatus().revisionId;
    while (cursor && chain.length < 5 && coordinator.localRevisions?.get(cursor)) {
      const revision = coordinator.localRevisions.get(cursor);
      chain.push(revision.label + '/' + revision.source + ':' + revision.changes.map(change => change.entityKey).join(','));
      cursor = revision.parentRevisionId;
    }
    return { openGestures: hasOpenEditorGestures(), openTransactions: open, revisionId: coordinator?.getStatus().revisionId ?? null, recent: chain, ...getEditorHistoryAvailability() };
  },
  // Media files of the project without a verified source identity yet (the background hash
  // the editor commits as its own revision a few seconds after an import).
  sourcesVerified() {
    const coordinator = getEditorRepositorySession()?.coordinator;
    if (!coordinator) return ['no project session'];
    return useMediaStore.getState().files.filter(file => file.file instanceof Blob && file.file.size > 0)
      .filter(file => coordinator.getEntities().get('source-identity:' + file.id)?.value?.identityStatus !== 'verified')
      .map(file => file.name + ':' + (coordinator.getEntities().get('source-identity:' + file.id)?.value?.identityStatus ?? 'none'));
  },
  mediaNames() {
    return useMediaStore.getState().files.map(file => file.name);
  },
  holdSourceVerification() {
    if (window.__phoneReleaseVerification) return;
    void withSourceIdentitiesPaused(() => new Promise(resolve => { window.__phoneReleaseVerification = resolve; }));
  },
  releaseSourceVerification() {
    const release = window.__phoneReleaseVerification;
    window.__phoneReleaseVerification = undefined;
    release?.();
  },
  clipAudio(clipId) {
    const state = useTimelineStore.getState();
    const clip = state.clips.find(candidate => candidate.id === clipId);
    if (!clip) return null;
    const effect = (clip.effects ?? []).find(candidate => candidate.type === 'audio-volume');
    const keyframes = effect ? (state.clipKeyframes.get(clipId) ?? []).filter(k => k.property === 'effect.' + effect.id + '.volume')
      .map(k => ({ time: k.time, value: k.value })) : [];
    return { volume: typeof effect?.params?.volume === 'number' ? effect.params.volume : 1, enabled: effect ? effect.enabled !== false : true,
      muted: clip.audioState?.muted === true, keyframes, linkedClipId: clip.linkedClipId ?? null, trackId: clip.trackId,
      startTime: clip.startTime, duration: clip.duration };
  },
};
window.dispatchEvent(new Event('phone-audio-probe-ready'));
`

async function ensureProbe(page: Page): Promise<void> {
  if (await page.evaluate(() => Boolean((window as unknown as { __phoneAudioProbe?: unknown }).__phoneAudioProbe))) return
  await page.addScriptTag({ type: 'module', content: PROBE_SOURCE })
  await page.waitForFunction(() => Boolean((window as unknown as { __phoneAudioProbe?: unknown }).__phoneAudioProbe), undefined, { timeout: 30_000 })
}

interface Probe {
  history(): HistoryProbe
  sourcesVerified(): string[]
  mediaNames(): string[]
  holdSourceVerification(): void
  releaseSourceVerification(): void
  mixRms(start: number, end: number, windows: Array<[number, number]>): Promise<number[]>
  snapshot(): string
  clipAudio(clipId: string): ClipAudio | null
}

export interface HistoryProbe {
  openGestures: boolean
  /** Labels of open repository transactions; the editor cancels Undo while any is open. */
  openTransactions: string[]
  revisionId: string | null
  /** Diagnostics: label/source/entities of the latest local revisions, newest first. */
  recent: string[]
  canUndo: boolean
  canRedo: boolean
}

/** Undo availability and whether an editor gesture is still open (Undo is refused while one is). */
export async function historyProbe(page: Page): Promise<HistoryProbe> {
  await ensureProbe(page)
  return page.evaluate(() => (window as unknown as { __phoneAudioProbe: Probe }).__phoneAudioProbe.history())
}

export interface ClipAudio {
  volume: number
  enabled: boolean
  muted: boolean
  keyframes: Array<{ time: number; value: number }>
  linkedClipId: string | null
  trackId: string
  startTime: number
  duration: number
}

/** RMS of the export mix (channel 0) in each window, timeline seconds. */
export async function mixRms(page: Page, start: number, end: number, windows: Array<[number, number]>): Promise<number[]> {
  await ensureProbe(page)
  return page.evaluate(({ start, end, windows }) => (window as unknown as { __phoneAudioProbe: Probe }).__phoneAudioProbe.mixRms(start, end, windows), { start, end, windows })
}

/** Stable JSON of tracks, clips (timing, links, effects, mute) and every keyframe. */
export async function timelineSnapshot(page: Page): Promise<string> {
  await ensureProbe(page)
  return page.evaluate(() => (window as unknown as { __phoneAudioProbe: Probe }).__phoneAudioProbe.snapshot())
}

/** Waits until the background source verification of every media file has landed. */
export async function waitForSourcesVerified(page: Page, timeout = 60_000): Promise<void> {
  await ensureProbe(page)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __phoneAudioProbe: Probe }).__phoneAudioProbe.sourcesVerified()), {
    timeout, message: 'the background source verification of the imported media did not land (unverified files listed)',
  }).toEqual([])
}

/** Names of every media file in the project's media pool. */
export async function mediaNames(page: Page): Promise<string[]> {
  await ensureProbe(page)
  return page.evaluate(() => (window as unknown as { __phoneAudioProbe: Probe }).__phoneAudioProbe.mediaNames())
}

/** Pauses (or resumes) the editor's background source verification (withSourceIdentitiesPaused). */
export async function holdSourceVerification(page: Page, hold: boolean): Promise<void> {
  await ensureProbe(page)
  await page.evaluate(value => {
    const probe = (window as unknown as { __phoneAudioProbe: Probe }).__phoneAudioProbe
    if (value) probe.holdSourceVerification(); else probe.releaseSourceVerification()
  }, hold)
}

export async function clipAudio(page: Page, clipId: string): Promise<ClipAudio | null> {
  await ensureProbe(page)
  return page.evaluate(id => (window as unknown as { __phoneAudioProbe: Probe }).__phoneAudioProbe.clipAudio(id), clipId)
}

/** RMS of the first audio stream of an exported file, decoded by ffmpeg to 48 kHz mono float. */
export async function fileAudioRms(file: string, from: number, to: number): Promise<number> {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-ss', String(from), '-t', String(to - from), '-i', file, '-map', '0:a:0',
    '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const samples = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4))
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return samples.length > 0 ? Math.sqrt(sum / samples.length) : 0
}
