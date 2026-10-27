import { execFile } from 'node:child_process'
import { access, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'
import { DEFAULT_REPO_ROOT } from '../fixtures/bridgeClient'

/**
 * Media and probes of the G4 phone journeys (m7-audio-regions.spec.ts, m7-audio-recording.spec.ts,
 * m7-audio-score.spec.ts). Truth for sound is the export's own PCM mix
 * (AudioExportPipeline.exportRawAudio, per channel); truth for edits is the clip's audio edit
 * stack in the editor store; truth for notation is the stored scoreData read back through the
 * editor's ScoreModel.
 */
const run = promisify(execFile)
const MEDIA_DIR = path.join(DEFAULT_REPO_ROOT, 'test-results', 'playwright', 'frame-code-media')

async function cached(name: string, args: string[]): Promise<string> {
  const file = path.join(MEDIA_DIR, name)
  if (await access(file).then(() => true, () => false)) return file
  await mkdir(MEDIA_DIR, { recursive: true })
  const temporary = `${file}.${process.pid}.tmp.wav`
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...args, temporary])
  await rename(temporary, file)
  return file
}

export interface M7RegionMedia {
  /** 2 s, 440 Hz at amplitude 0.5 on both channels. */
  tone: string
  /** 2 s: 440 Hz (0.5) for the first second, digital silence for the second. */
  toneThenSilence: string
  /** 2 s stereo: left 440 Hz (0.5), right silent. */
  leftOnly: string
  /** 2 s: soft noise (about -50 dBFS) for 0.6 s, then 440 Hz (0.5). */
  quietThenTone: string
  /** 2 s, 40 Hz at amplitude 0.5 (below the region high-pass preset's 80 Hz). */
  rumble: string
}

export async function generateM7RegionMedia(): Promise<M7RegionMedia> {
  const sr = 's=48000:d=2'
  return {
    tone: await cached('m7-tone-05-2s-v1.wav', ['-f', 'lavfi', '-i', `aevalsrc='0.5*sin(2*PI*440*t)|0.5*sin(2*PI*440*t)':${sr}`]),
    toneThenSilence: await cached('m7-tone-then-silence-2s-v1.wav', ['-f', 'lavfi', '-i',
      `aevalsrc='if(lt(t\\,1)\\,0.5*sin(2*PI*440*t)\\,0)|if(lt(t\\,1)\\,0.5*sin(2*PI*440*t)\\,0)':${sr}`]),
    leftOnly: await cached('m7-left-only-2s-v1.wav', ['-f', 'lavfi', '-i', `aevalsrc='0.5*sin(2*PI*440*t)|0':${sr}`]),
    quietThenTone: await cached('m7-quiet-then-tone-2s-v1.wav', ['-f', 'lavfi', '-i',
      `aevalsrc='if(lt(t\\,0.6)\\,0.005*(random(0)*2-1)\\,0.5*sin(2*PI*440*t))|if(lt(t\\,0.6)\\,0.005*(random(1)*2-1)\\,0.5*sin(2*PI*440*t))':${sr}`]),
    rumble: await cached('m7-rumble-40hz-2s-v1.wav', ['-f', 'lavfi', '-i', `aevalsrc='0.5*sin(2*PI*40*t)|0.5*sin(2*PI*40*t)':${sr}`]),
  }
}

const PROBE_SOURCE = `
import { useTimelineStore } from '/src/stores/timeline/index.ts';
import { AudioExportPipeline } from '/src/engine/audio/AudioExportPipeline.ts';
import { ScoreModel } from '/src/services/score/ScoreModel.ts';
import { scoreToEvents } from '/src/services/score/scoreToEvents.ts';
import { audioRecordingService } from '/src/services/audio/AudioRecordingService.ts';
import { createAudioRecordingTargets } from '/src/services/audio/timelineRecordingWorkflow.ts';

function rms(data, from, to) {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += data[i] * data[i];
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

window.__phoneRegionProbe = {
  async channelRms(start, end, windows) {
    const buffer = await new AudioExportPipeline({ sampleRate: 48000, normalize: false }).exportRawAudio(start, end);
    if (!buffer) return windows.map(() => [0, 0]);
    const channels = [buffer.getChannelData(0), buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1))];
    return windows.map(([from, to]) => channels.map(data => rms(data,
      Math.max(0, Math.floor((from - start) * buffer.sampleRate)), Math.min(data.length, Math.floor((to - start) * buffer.sampleRate)))));
  },
  /** Sum of left*right products over a window divided by the energies (sign = polarity relation). */
  async correlation(start, end, from, to) {
    const buffer = await new AudioExportPipeline({ sampleRate: 48000, normalize: false }).exportRawAudio(start, end);
    if (!buffer || buffer.numberOfChannels < 2) return 0;
    const l = buffer.getChannelData(0), r = buffer.getChannelData(1);
    let lr = 0, ll = 0, rr = 0;
    for (let i = Math.floor((from - start) * buffer.sampleRate); i < Math.floor((to - start) * buffer.sampleRate); i += 1) { lr += l[i] * r[i]; ll += l[i] * l[i]; rr += r[i] * r[i]; }
    return ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : 0;
  },
  region() {
    const state = useTimelineStore.getState();
    const selection = state.audioRegionSelection;
    const clips = state.clips.map(clip => ({
      id: clip.id, trackId: clip.trackId, startTime: clip.startTime, duration: clip.duration, inPoint: clip.inPoint, outPoint: clip.outPoint,
      sourceType: clip.source?.type ?? null,
      edits: (clip.audioState?.editStack ?? []).map(op => ({ id: op.id, type: op.type, enabled: op.enabled !== false, timeRange: op.timeRange ?? null,
        channelMask: op.channelMask ?? null, params: op.params })),
    }));
    return { selection, clipboard: state.audioRegionClipboard, clips, selectedClipIds: [...state.selectedClipIds] };
  },
  score(clipId) {
    const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
    if (!clip?.scoreData) return null;
    const model = ScoreModel.fromScoreData(clip.scoreData);
    const score = model.getScore();
    const notes = model.getAllNotes().map(note => ({ step: note.step ?? null, alter: note.alter ?? null, octave: note.octave ?? null,
      duration: note.duration, rest: note.isRest === true, dots: note.dots ?? 0, tied: Boolean(note.tiedTo), tuplet: Boolean(note.tupletId),
      stem: note.stemDirection ?? 'auto', beat: note.beat.num / note.beat.den, measure: note.measure, articulations: note.articulations ?? [] }));
    const { events } = scoreToEvents(score);
    return { notes, tempo: score.tempo, events: events.map(event => ({ midi: event.midi, start: event.start, duration: event.duration })) };
  },
  /** An interrupted take: record on the track, stop without adding (the take stays in the rescue list). */
  async recordWithoutCommit(minimumSeconds) {
    const trackId = useTimelineStore.getState().addTrack('audio');
    const track = useTimelineStore.getState().tracks.find(candidate => candidate.id === trackId);
    await audioRecordingService.start({ startTime: 0.25, targets: createAudioRecordingTargets([track]), getTimelineTime: () => 0.25 });
    await new Promise(resolve => {
      const started = performance.now();
      const tick = () => (performance.now() - started) / 1000 >= minimumSeconds ? resolve() : requestAnimationFrame(tick);
      requestAnimationFrame(tick);
    });
    const result = await audioRecordingService.stop();
    return { sessionId: result.sessionId, trackId };
  },
  recoveryIds() { return audioRecordingService.listRecoveryEntries().map(entry => entry.sessionId + ':' + entry.status); },
  async recommit(sessionId) {
    try { return (await audioRecordingService.commitRecoveryEntry(sessionId)).clips.length; } catch (error) { return 'error:' + (error?.message ?? String(error)); }
  },
};
`

async function ensureProbe(page: Page): Promise<void> {
  if (await page.evaluate(() => Boolean((window as unknown as { __phoneRegionProbe?: unknown }).__phoneRegionProbe))) return
  await page.addScriptTag({ type: 'module', content: PROBE_SOURCE })
  await page.waitForFunction(() => Boolean((window as unknown as { __phoneRegionProbe?: unknown }).__phoneRegionProbe), undefined, { timeout: 30_000 })
}

export interface RegionEdit {
  id: string
  type: string
  enabled: boolean
  timeRange: { start: number; end: number } | null
  channelMask: number[] | null
  params: Record<string, string | number | boolean | null>
}

export interface RegionState {
  selection: { clipId: string; startTime: number; endTime: number; sourceInPoint: number; sourceOutPoint: number } | null
  clipboard: { sourceClipId: string; duration: number } | null
  clips: Array<{ id: string; trackId: string; startTime: number; duration: number; inPoint: number; outPoint: number; sourceType: string | null; edits: RegionEdit[] }>
  selectedClipIds: string[]
}

type ProbeWindow = { __phoneRegionProbe: Record<string, (...args: never[]) => unknown> }

async function call<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  await ensureProbe(page)
  return page.evaluate(([name, values]) => {
    const probe = (window as unknown as ProbeWindow).__phoneRegionProbe
    return (probe[name as string] as (...a: unknown[]) => unknown)(...(values as unknown[]))
  }, [method, args] as const) as Promise<T>
}

/** RMS per [left, right] in each window of the export mix between start and end (seconds). */
export const channelRms = (page: Page, start: number, end: number, windows: Array<[number, number]>) =>
  call<number[][]>(page, 'channelRms', start, end, windows)
export const channelCorrelation = (page: Page, start: number, end: number, from: number, to: number) =>
  call<number>(page, 'correlation', start, end, from, to)
export const regionState = (page: Page) => call<RegionState>(page, 'region')
export const scoreState = (page: Page, clipId: string) => call<{
  notes: Array<{ step: string | null; alter: number | null; octave: number | null; duration: string; rest: boolean; dots: number; tied: boolean; tuplet: boolean; stem: string; beat: number; measure: number; articulations: string[] }>
  tempo: number
  events: Array<{ midi: number; start: number; duration: number }>
} | null>(page, 'score', clipId)
/** Arrangement: a fresh audio track and a take recorded onto it but never added (as after a crash). */
export const recordWithoutCommit = (page: Page, minimumSeconds: number) => call<{ sessionId: string; trackId: string }>(page, 'recordWithoutCommit', minimumSeconds)
export const recoveryIds = (page: Page) => call<string[]>(page, 'recoveryIds')
export const recommit = (page: Page, sessionId: string) => call<number | string>(page, 'recommit', sessionId)
