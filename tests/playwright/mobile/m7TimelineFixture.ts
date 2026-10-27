import { expect, type M1Session } from './m1Fixture'

/**
 * Store probe of the G1 timeline-tools journeys (m7-timeline.spec.ts): reads the editor state the
 * cases assert on (snapping, beat grid, range, tempo map, metronome, view options, clip parents,
 * source label colours, bake regions) and resets the timeline preferences before each case, since
 * they persist in the browser like on the desktop. Arranging only; every action under test is real
 * touch on the phone UI.
 */

const PROBE = `
import { useTimelineStore } from '/src/stores/timeline/index.ts';
import { useMediaStore } from '/src/stores/mediaStore/index.ts';
import { hasOpenEditorGestures } from '/src/services/project/repository/transaction/editorGestureOwnership.ts';
window.__phoneG1Probe = {
  read() {
    const t = useTimelineStore.getState();
    const m = useMediaStore.getState();
    const labelOf = (clip) => {
      const id = clip.mediaFileId || clip.source?.mediaFileId;
      const file = id ? m.files.find(f => f.id === id) : null;
      return file?.labelColor ?? 'none';
    };
    return {
      openGestures: hasOpenEditorGestures(),
      snapping: t.snappingEnabled,
      beatGrid: t.rulerLanes.some(lane => lane.format === 'bars'),
      subdivision: t.timelineGridSubdivision,
      metronome: t.metronomeEnabled, metronomeVolume: t.metronomeVolume, metronomeMode: t.metronomeMode,
      inPoint: t.inPoint, outPoint: t.outPoint, loop: t.loopPlayback,
      focus: t.trackFocusMode, thumbnails: t.thumbnailsEnabled, waveforms: t.waveformsEnabled,
      tempo: (t.tempoMap?.events ?? []).map(e => ({ time: e.time, bpm: e.bpm, numerator: e.numerator, denominator: e.denominator, curve: e.curve ?? 'jump' })),
      compositionBake: t.videoBakeRegions.map(r => ({ id: r.id, status: r.status ?? 'marked' })),
      clips: t.clips.map(c => ({ id: c.id, trackId: c.trackId, name: c.name, startTime: c.startTime, duration: c.duration, inPoint: c.inPoint,
        parentClipId: c.parentClipId ?? null, sourceType: c.source?.type ?? null, label: labelOf(c),
        bake: (c.videoState?.bakeRegions ?? []).map(r => ({ id: r.id, status: r.status ?? 'marked' })) })),
      tracks: t.tracks.map(tr => ({ id: tr.id, type: tr.type, parentTrackId: tr.parentTrackId ?? null })),
    };
  },
  resetPrefs() {
    const t = useTimelineStore.getState();
    if (t.snappingEnabled) t.toggleSnapping();
    for (const lane of t.rulerLanes.filter(l => l.format === 'bars')) t.removeRulerLane(lane.id);
    t.setTimelineGridSubdivision('beat');
    if (useTimelineStore.getState().metronomeEnabled) useTimelineStore.getState().toggleMetronome();
    t.setMetronomeVolume(0.5);
    t.setMetronomeMode('beats');
    t.clearInOut();
    t.setLoopPlayback(false);
    t.setThumbnailsEnabled(true);
    t.setWaveformsEnabled(true);
    t.setTrackFocusMode('balanced');
  },
};
`

export interface G1Clip {
  id: string; trackId: string; name: string; startTime: number; duration: number; inPoint: number
  parentClipId: string | null; sourceType: string | null; label: string; bake: Array<{ id: string; status: string }>
}

export interface G1State {
  openGestures: boolean
  snapping: boolean; beatGrid: boolean; subdivision: string
  metronome: boolean; metronomeVolume: number; metronomeMode: string
  inPoint: number | null; outPoint: number | null; loop: boolean
  focus: string; thumbnails: boolean; waveforms: boolean
  tempo: Array<{ time: number; bpm: number; numerator: number; denominator: number; curve: string }>
  compositionBake: Array<{ id: string; status: string }>
  clips: G1Clip[]
  tracks: Array<{ id: string; type: string; parentTrackId: string | null }>
}

async function ensureProbe(m1: M1Session): Promise<void> {
  const page = m1.page
  if (await page.evaluate(() => Boolean((window as unknown as { __phoneG1Probe?: unknown }).__phoneG1Probe))) return
  await page.addScriptTag({ type: 'module', content: PROBE })
  await page.waitForFunction(() => Boolean((window as unknown as { __phoneG1Probe?: unknown }).__phoneG1Probe), undefined, { timeout: 30_000 })
}

export async function g1State(m1: M1Session): Promise<G1State> {
  await ensureProbe(m1)
  return m1.page.evaluate(() => (window as unknown as { __phoneG1Probe: { read(): G1State } }).__phoneG1Probe.read())
}

/** Puts the persisted timeline preferences back to the defaults (arranging, not under test). */
export async function resetTimelinePrefs(m1: M1Session): Promise<void> {
  await ensureProbe(m1)
  await m1.page.evaluate(() => (window as unknown as { __phoneG1Probe: { resetPrefs(): void } }).__phoneG1Probe.resetPrefs())
}

export async function clipState(m1: M1Session, clipId: string): Promise<G1Clip> {
  const clip = (await g1State(m1)).clips.find(candidate => candidate.id === clipId)
  if (!clip) throw new Error(`clip ${clipId} is gone`)
  return clip
}

/** Waits until no edit transaction is open (a sheet's Done/Cancel finished). */
export async function expectNoOpenGesture(m1: M1Session): Promise<void> {
  await expect.poll(async () => (await g1State(m1)).openGestures, { message: 'an edit transaction stayed open' }).toBe(false)
}
