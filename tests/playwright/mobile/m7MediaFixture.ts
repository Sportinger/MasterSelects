import type { Page } from '@playwright/test'
import { phoneActionTestId, PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { PHONE_LIBRARY_TEST_IDS as LIB } from '../../../src/components/mobileSkin/library/phoneLibraryTestIds'
import { PHONE_PROJECT_TEST_IDS as PROJ } from '../../../src/components/mobileSkin/project/phoneProjectTestIds'
import { PHONE_SETTINGS_TEST_IDS as SET } from '../../../src/components/mobileSkin/settings/phoneSettingsTestIds'
import { PHONE_SOURCE_TEST_IDS as SRC } from '../../../src/components/mobileSkin/source/phoneSourceTestIds'
import { expect, tapAction, tapOn, waitForIdle, type M1Session } from './m1Fixture'
import { sheetSettled } from './m3LibraryFixture'

/**
 * Helpers of the G6 journeys (media, source monitor, app chrome, assistant extras, export) on the
 * shared M1 phone world. The in-page probe READS the shared stores (source monitor, timeline clips,
 * library files, active composition); its only writes are arrangements a person cannot make by touch
 * in a test (a seeded variant comparison of the assistant) and their cleanup.
 */

const PROBE_SOURCE = `
import { useMediaStore } from '/src/stores/mediaStore/index.ts';
import { useTimelineStore } from '/src/stores/timeline/index.ts';
import { useStoryboardStore } from '/src/stores/storyboardStore/index.ts';

const fingerprint = { schemaVersion: 1, algorithm: 'sha-256', value: 'a'.repeat(64) };
const emptyFragment = () => ({ schemaVersion: 1, durationSeconds: 2, tracks: [], clips: [], links: [], keyframes: [], effects: [],
  masks: [], transitions: [], markers: [], annotations: [], sceneIds: [], candidateIds: [], warnings: [] });

window.__phoneG6Probe = {
  source() {
    const s = useMediaStore.getState();
    return { fileId: s.sourceMonitorFileId, inPoint: s.sourceMonitorInPoint, outPoint: s.sourceMonitorOutPoint };
  },
  clips() {
    const t = useTimelineStore.getState();
    return t.clips.map(c => ({ id: c.id, name: c.name, trackId: c.trackId, trackType: t.tracks.find(k => k.id === c.trackId)?.type ?? null,
      start: c.startTime, duration: c.duration, inPoint: c.inPoint, outPoint: c.outPoint, speed: c.speed ?? 1, mediaFileId: c.mediaFileId ?? c.source?.mediaFileId ?? null }))
      .sort((a, b) => a.start - b.start || String(a.trackId).localeCompare(String(b.trackId)));
  },
  files() {
    return useMediaStore.getState().files.map(f => ({ id: f.id, name: f.name, type: f.type, waveformStatus: f.waveformStatus ?? null, proxyStatus: f.proxyStatus ?? null }));
  },
  activeComposition() { return useMediaStore.getState().activeCompositionId; },
  seedVariants(base, variantCompId) {
    const comp = { id: variantCompId };
    const store = useStoryboardStore.getState();
    const setId = 'g6-variant-set-' + Date.now();
    store.putVariantSet({ schemaVersion: 1, id: setId, title: 'G6 alternatives', baseCompositionId: base, sceneIds: [],
      scope: { startTime: 0, endTime: 2, trackIds: [], includeLinked: true }, baseFingerprint: fingerprint, boundaryFingerprint: fingerprint,
      status: 'review', optionIds: [setId + '-a', setId + '-b', setId + '-c'], createdAt: Date.now() });
    const titles = ['Balanced', 'Dynamic', 'Calm'];
    titles.forEach((title, index) => store.putVariantOption({ schemaVersion: 1, id: setId + '-' + 'abc'[index], variantSetId: setId, title,
      rationale: title + ' option', state: index === 0 ? 'ready' : 'building', fragment: emptyFragment(),
      ...(index === 0 ? { materializedCompositionId: comp.id } : {}), candidateIds: [] }));
    return { setId, base, variantCompId: comp.id, optionAId: setId + '-a' };
  },
  // Cleanup only: removes the seeded comparison so later cases see an assistant without one.
  clearVariants(setId) {
    useStoryboardStore.setState(state => {
      const variantSets = { ...state.variantSets }; delete variantSets[setId];
      const variantOptions = Object.fromEntries(Object.entries(state.variantOptions).filter(([, o]) => o.variantSetId !== setId));
      return { variantSets, variantOptions };
    });
  },
};
`

export interface G6Clip {
  id: string; name: string; trackId: string; trackType: 'video' | 'audio' | null; start: number; duration: number
  inPoint: number; outPoint: number; speed: number; mediaFileId: string | null
}
export interface G6File { id: string; name: string; type: string; waveformStatus: string | null; proxyStatus: string | null }

async function ensureProbe(page: Page): Promise<void> {
  if (await page.evaluate(() => Boolean((window as unknown as { __phoneG6Probe?: unknown }).__phoneG6Probe))) return
  await page.addScriptTag({ type: 'module', content: PROBE_SOURCE })
  await page.waitForFunction(() => Boolean((window as unknown as { __phoneG6Probe?: unknown }).__phoneG6Probe), undefined, { timeout: 30_000 })
}

async function call<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  await ensureProbe(page)
  return page.evaluate(({ name, rest }) => {
    const probe = (window as unknown as { __phoneG6Probe: Record<string, (...a: unknown[]) => unknown> }).__phoneG6Probe
    return probe[name](...rest) as T
  }, { name: method, rest: args })
}

export const g6Source = (page: Page) => call<{ fileId: string | null; inPoint: number | null; outPoint: number | null }>(page, 'source')
export const g6Clips = (page: Page) => call<G6Clip[]>(page, 'clips')
export const g6Files = (page: Page) => call<G6File[]>(page, 'files')
export const g6ActiveComposition = (page: Page) => call<string | null>(page, 'activeComposition')
/**
 * Arranges a variant comparison like the assistant leaves one: the variant composition is made with
 * the editor's own createComposition tool (so the repository knows it), the case's composition is
 * reopened, and the storyboard store gets a set in review whose option A points at that composition.
 */
export async function g6SeedVariants(m1: M1Session): Promise<{ setId: string; base: string; variantCompId: string; optionAId: string }> {
  const base = await g6ActiveComposition(m1.page)
  await m1.bridge.toolData('createComposition', { name: 'G6 variant A', width: 1080, height: 1920, frameRate: 30, duration: 2 })
  await expect.poll(() => g6ActiveComposition(m1.page), { message: 'the variant composition was made' }).not.toBe(base)
  const variantCompId = (await g6ActiveComposition(m1.page))!
  await m1.bridge.toolData('openComposition', { compositionId: base })
  await expect.poll(() => g6ActiveComposition(m1.page), { message: 'back on the case composition' }).toBe(base)
  await waitForIdle(m1)
  return call(m1.page, 'seedVariants', base, variantCompId)
}
export const g6ClearVariants = (page: Page, setId: string) => call<void>(page, 'clearVariants', setId)

/** Video clips as "start+duration@in" (seconds, 3 decimals), sorted; the shape a placement changes. */
export function g6Signature(clips: G6Clip[]): string {
  return clips.filter(clip => clip.trackType === 'video')
    .map(clip => `${clip.trackId}:${clip.start.toFixed(3)}+${clip.duration.toFixed(3)}@${clip.inPoint.toFixed(3)}`).join(' ')
}

export async function openLibrary(m1: M1Session): Promise<void> {
  await m1.bridge.toolData('clearSelection')
  await tapAction(m1, phoneActionTestId('library'))
  await expect(m1.page.getByTestId(LIB.root), 'the Library sheet opened').toBeVisible()
  await sheetSettled(m1)
}

/** Library > item view of `fileId`. */
export async function openLibraryItem(m1: M1Session, fileId: string): Promise<void> {
  await openLibrary(m1)
  await tapOn(m1, m1.page.locator(`[data-testid="${LIB.row}"][data-item-id="${fileId}"] [data-testid="${LIB.rowOpen}"]`))
  await expect(m1.page.getByTestId(LIB.item)).toHaveAttribute('data-item-id', fileId)
}

/** Library > item > Source monitor (opening the Library clears the timeline selection). */
export async function openSource(m1: M1Session, fileId: string): Promise<void> {
  await openLibraryItem(m1, fileId)
  await tapOn(m1, m1.page.getByTestId(LIB.openSource))
  await expect(m1.page.getByTestId(SRC.root), 'the source sheet opened').toHaveAttribute('data-source-id', fileId)
  await sheetSettled(m1)
}

/** Imports one file into the library only (no clip), through the Library's own import input. */
export async function importToLibrary(m1: M1Session, file: string): Promise<G6File> {
  const before = await g6Files(m1.page)
  await openLibrary(m1)
  await m1.page.getByTestId(LIB.importInput).setInputFiles(file)
  let added: G6File | undefined
  await expect.poll(async () => {
    added = (await g6Files(m1.page)).find(entry => !before.some(old => old.id === entry.id))
    return Boolean(added)
  }, { timeout: 60_000, message: 'the file did not reach the library' }).toBe(true)
  await tapOn(m1, m1.page.getByTestId(PHONE_TEST_IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden()
  await waitForIdle(m1)
  return added!
}

export async function openSettings(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(PHONE_TEST_IDS.projectName))
  await expect(m1.page.getByTestId(PROJ.tools), 'the project sheet shows its tools').toBeVisible()
  await sheetSettled(m1)
  await tapOn(m1, m1.page.getByTestId(PROJ.openSettings))
  await expect(m1.page.getByTestId(SET.root), 'Settings opened from the project sheet').toBeVisible()
  await sheetSettled(m1)
}

export async function openProjectSheet(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(PHONE_TEST_IDS.projectName))
  await expect(m1.page.getByTestId(PROJ.tools), 'the project sheet shows its tools').toBeVisible()
  await sheetSettled(m1)
}
