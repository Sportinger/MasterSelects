import { readPreviewFrame } from './phoneTouch'
import { expect, IDS, importViaSheet, seek, tapClip, tapOn, type M1Session, type M1Timeline } from './m1Fixture'
import { waitForSettledHistory } from './m2DesignFixture'

/**
 * Helpers of the M3 compositions-and-timeline journeys (m3-compositions-timeline.spec.ts) in the M1
 * phone world: a fresh empty 1080x1920 / 30 fps composition per test, real touch on the phone UI,
 * the bridge only for arranging (playhead) and inspecting (timeline, compositions, markers).
 */

export interface BridgeComposition { id: string; name: string; width: number; height: number; duration: number; frameRate: number }
export interface BridgeTrack { id: string; name: string; type: string; visible: boolean; muted: boolean; solo: boolean; clipCount: number; clips: Array<{ id: string; mediaId?: string; sourceType?: string; startTime: number; duration: number; inPoint: number }> }
export interface BridgeMarker { id: string; time: number; label: string; color: string }

export async function compositions(m1: M1Session): Promise<BridgeComposition[]> {
  return (await m1.bridge.toolData<{ compositions: BridgeComposition[] }>('getMediaItems')).compositions
}

export async function activeComposition(m1: M1Session): Promise<BridgeComposition> {
  const [state, list] = await Promise.all([m1.timeline(), compositions(m1)])
  const active = list.find(comp => comp.id === state.activeCompositionId)
  if (!active) throw new Error('the active composition is not listed')
  return active
}

export async function tracks(m1: M1Session): Promise<BridgeTrack[]> {
  const state = await m1.bridge.toolData<{ videoTracks: BridgeTrack[]; audioTracks: BridgeTrack[] }>('getTimelineState')
  return [...state.videoTracks, ...state.audioTracks]
}

export async function markers(m1: M1Session): Promise<BridgeMarker[]> {
  return (await m1.bridge.toolData<{ markers: BridgeMarker[] }>('getMarkers')).markers
}

export async function mediaIdOf(m1: M1Session, clipId: string): Promise<string | undefined> {
  return (await tracks(m1)).flatMap(track => track.clips).find(clip => clip.id === clipId)?.mediaId
}

/** Imports A (4 s) and B (3 s) back to back through the media sheet; history settled. */
export async function importAB(m1: M1Session): Promise<M1Timeline> {
  const state = await importViaSheet(m1, { visual: [m1.media.a.path, m1.media.b.path] }, { main: 2, total: 2 })
  await waitForSettledHistory(m1)
  return state
}

/** Waits until the preview shows `frame` (frame code) twice in a row at the current playhead. */
export async function expectFrame(m1: M1Session, frame: number, what: string): Promise<void> {
  m1.probe.mark()
  await m1.probe.waitForFrame(frame, { allowed: () => true, timeoutMs: 20_000 })
  for (let read = 0; read < 2; read++) expect((await readPreviewFrame(m1.probe)).frame, `${what}. ${m1.probe.summary()}`).toBe(frame)
}

/** Seeks (arrangement) and waits for the frame the preview must show there. */
export async function seekToFrame(m1: M1Session, time: number, frame: number, what: string): Promise<void> {
  await seek(m1, time)
  await expectFrame(m1, frame, what)
}

/** Selects a clip by touch (only it). */
export async function selectOnly(m1: M1Session, clipId: string): Promise<void> {
  const selected = (await m1.timeline()).selectedIds
  if (!(selected.length === 1 && selected[0] === clipId)) await tapClip(m1, clipId)
  await expect.poll(async () => (await m1.timeline()).selectedIds, { message: 'the clip did not get selected' }).toEqual([clipId])
}

/** Taps the element with this test id (scrolled into view first). */
export async function tapTestId(m1: M1Session, testId: string): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(testId).first())
}

/** Taps a control inside the row matching `rowSelector`. */
export async function tapInRow(m1: M1Session, row: ReturnType<M1Session['page']['locator']>, testId: string): Promise<void> {
  await tapOn(m1, row.getByTestId(testId).first())
}

export async function expectSheetClosed(m1: M1Session): Promise<void> {
  await expect(m1.sheet, 'the sheet is still open').toBeHidden({ timeout: 30_000 })
}

/** Closes any leftover notice so the next tap reaches the sheet. */
export async function dismissNotice(m1: M1Session): Promise<string> {
  const notice = m1.page.getByTestId(IDS.unavailableNotice)
  await expect(notice).toBeVisible()
  const text = (await notice.textContent()) ?? ''
  await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
  await expect(notice).toBeHidden()
  return text
}

// ---------------------------------------------------------------------------
// Store probe for the sheet -> landscape editor hand-offs (N1): composition render engine, beat
// rules, track level/pan, clip analysis refs and open editor gestures, read from the editor's stores.
// ---------------------------------------------------------------------------

const HANDOFF_PROBE = `
import { useTimelineStore } from '/src/stores/timeline/index.ts';
import { useMediaStore } from '/src/stores/mediaStore/index.ts';
import { hasOpenEditorGestures } from '/src/services/project/repository/transaction/editorGestureOwnership.ts';
window.__phoneHandoffProbe = {
  read() {
    const timeline = useTimelineStore.getState();
    const media = useMediaStore.getState();
    const active = media.compositions.find(comp => comp.id === media.activeCompositionId);
    const rules = Object.values(timeline.compositionGraph?.rules ?? {}).filter(rule => rule && rule.operator === 'beat-distribute');
    return {
      openGestures: hasOpenEditorGestures(),
      selected: [...timeline.selectedClipIds],
      renderEngine: active?.renderSettings?.engine ?? 'raster',
      beatRules: rules.map(rule => ({ id: rule.id, members: rule.members.length, beatStep: rule.params.beatStep })),
      clips: timeline.clips.map(clip => ({ id: clip.id, trackId: clip.trackId, startTime: clip.startTime, duration: clip.duration,
        beatGridId: clip.audioState?.sourceAnalysisRefs?.beatGridId ?? clip.audioState?.processedAnalysisRefs?.beatGridId ?? null,
        warpPoints: clip.timeRemap?.kind === 'warp' ? clip.timeRemap.points.length : 0, effects: (clip.audioState?.effectStack ?? []).length })),
      tracks: timeline.tracks.map(track => ({ id: track.id, name: track.name, type: track.type,
        volumeDb: track.audioState?.volumeDb ?? 0, pan: track.audioState?.pan ?? 0 })),
    };
  },
};
`

export interface HandoffState {
  openGestures: boolean
  selected: string[]
  renderEngine: string
  beatRules: Array<{ id: string; members: number; beatStep: number }>
  clips: Array<{ id: string; trackId: string; startTime: number; duration: number; beatGridId: string | null; warpPoints: number; effects: number }>
  tracks: Array<{ id: string; name: string; type: string; volumeDb: number; pan: number }>
}

/** Reads the editor state the hand-off journeys assert on (see HANDOFF_PROBE). */
export async function handoffState(m1: M1Session): Promise<HandoffState> {
  const page = m1.page
  if (!await page.evaluate(() => Boolean((window as unknown as { __phoneHandoffProbe?: unknown }).__phoneHandoffProbe))) {
    await page.addScriptTag({ type: 'module', content: HANDOFF_PROBE })
    await page.waitForFunction(() => Boolean((window as unknown as { __phoneHandoffProbe?: unknown }).__phoneHandoffProbe), undefined, { timeout: 30_000 })
  }
  return page.evaluate(() => (window as unknown as { __phoneHandoffProbe: { read(): HandoffState } }).__phoneHandoffProbe.read())
}

/** The landscape editor that is open now ('' when none). */
export async function openWorkspaceId(m1: M1Session): Promise<string> {
  const root = m1.page.getByTestId('phone-workspace')
  return (await root.isVisible()) ? (await root.getAttribute('data-workspace')) ?? '' : ''
}

/** Leaves an open landscape editor with its Back button. */
export async function leaveWorkspace(m1: M1Session): Promise<void> {
  const root = m1.page.getByTestId('phone-workspace')
  if (await root.isVisible()) {
    await tapOn(m1, m1.page.getByTestId('phone-workspace-back'))
    await expect(root).toBeHidden()
  }
}

/** A sheet row handed over to a landscape editor: it is open, and no edit transaction stayed open. */
export async function expectHandedOver(m1: M1Session, workspace: string): Promise<HandoffState> {
  await expect(m1.page.getByTestId('phone-workspace'), `the ${workspace} editor did not open`).toHaveAttribute('data-workspace', workspace)
  await expect(m1.sheet, 'the sheet closed for the editor').toBeHidden()
  await expect.poll(async () => (await handoffState(m1)).openGestures, { message: 'the sheet left an edit transaction open' }).toBe(false)
  return handoffState(m1)
}
