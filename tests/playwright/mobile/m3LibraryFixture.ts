import type { Page } from '@playwright/test'
import { PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { expect, tapOn, waitForIdle, type M1Session } from './m1Fixture'

/**
 * Helpers of the M3 Library / Settings / Project journeys (packet Q4) on the shared M1 phone world.
 * The in-page probe only READS the shared stores (library items, settings, project name, history);
 * the one arrangement it offers (closing an account dialog) never changes the login state.
 */

const PROBE_SOURCE = `
import { useMediaStore } from '/src/stores/mediaStore/index.ts';
import { useSettingsStore } from '/src/stores/settingsStore.ts';
import { useAccountStore } from '/src/stores/accountStore.ts';
import { getEditorRepositorySession } from '/src/services/project/repository/transaction/editorMutationRuntime.ts';
import { hasOpenEditorGestures } from '/src/services/project/repository/transaction/editorGestureOwnership.ts';

window.__phoneLibraryProbe = {
  library() {
    const state = useMediaStore.getState();
    return {
      files: state.files.map(file => ({
        id: file.id, name: file.name, parentId: file.parentId ?? null, labelColor: file.labelColor ?? 'none',
        thumbnailUrl: file.thumbnailUrl ?? null, waveformStatus: file.waveformStatus ?? null,
        sourceMode: file.sourceSelection?.mode ?? 'auto', linkedSources: (file.linkedSources ?? []).map(source => source.id),
        fileHash: file.fileHash ?? null,
      })),
      folders: state.folders.map(folder => ({ id: folder.id, name: folder.name, parentId: folder.parentId ?? null })),
      compositions: state.compositions.map(comp => ({ id: comp.id, name: comp.name })),
      activeCompositionId: state.activeCompositionId,
      projectName: state.currentProjectName,
    };
  },
  settings() {
    const state = useSettingsStore.getState();
    return { theme: state.theme, transcriptionProvider: state.transcriptionProvider, customHue: state.customHue };
  },
  history() {
    const status = getEditorRepositorySession()?.coordinator.getStatus();
    return { revisionId: status?.revisionId ?? null, openGestures: hasOpenEditorGestures() };
  },
  accountDialog() { return useAccountStore.getState().dialog; },
  closeAccountDialog() { useAccountStore.getState().closeDialog(); },
  // Cleanup only: puts settings back after a case changed them through the sheet.
  restoreSettings(values) {
    const state = useSettingsStore.getState();
    if (values.customHue !== undefined) state.setCustomHue(values.customHue);
    if (values.transcriptionProvider !== undefined) state.setTranscriptionProvider(values.transcriptionProvider);
  },
};
`

export interface LibraryFile {
  id: string; name: string; parentId: string | null; labelColor: string; thumbnailUrl: string | null
  waveformStatus: string | null; sourceMode: string; linkedSources: string[]; fileHash: string | null
}
export interface LibraryState {
  files: LibraryFile[]
  folders: Array<{ id: string; name: string; parentId: string | null }>
  compositions: Array<{ id: string; name: string }>
  activeCompositionId: string | null
  projectName: string
}

async function ensureProbe(page: Page): Promise<void> {
  if (await page.evaluate(() => Boolean((window as unknown as { __phoneLibraryProbe?: unknown }).__phoneLibraryProbe))) return
  await page.addScriptTag({ type: 'module', content: PROBE_SOURCE })
  await page.waitForFunction(() => Boolean((window as unknown as { __phoneLibraryProbe?: unknown }).__phoneLibraryProbe), undefined, { timeout: 30_000 })
}

type ProbeMethod = 'library' | 'settings' | 'history' | 'accountDialog' | 'closeAccountDialog'
async function call<T>(page: Page, method: ProbeMethod): Promise<T> {
  await ensureProbe(page)
  return page.evaluate((name) => (window as unknown as { __phoneLibraryProbe: Record<string, () => unknown> }).__phoneLibraryProbe[name]() as T, method)
}

export const libraryState = (page: Page) => call<LibraryState>(page, 'library')
export const settingsState = (page: Page) => call<{ theme: string; transcriptionProvider: string; customHue: number }>(page, 'settings')
export const historyState = (page: Page) => call<{ revisionId: string | null; openGestures: boolean }>(page, 'history')
export const accountDialog = (page: Page) => call<string | null>(page, 'accountDialog')
export const closeAccountDialog = (page: Page) => call<void>(page, 'closeAccountDialog')

/** One tap on Undo; resolves once the editor checked out another revision. */
export async function undoOnce(m1: M1Session): Promise<void> {
  await expect.poll(async () => (await historyState(m1.page)).openGestures, { message: 'an editor gesture is still open' }).toBe(false)
  const before = (await historyState(m1.page)).revisionId
  await tapOn(m1, m1.page.getByTestId(PHONE_TEST_IDS.undo))
  await expect.poll(async () => (await historyState(m1.page)).revisionId, { message: 'Undo did not move to another revision' }).not.toBe(before)
  await waitForIdle(m1)
}

/** Waits until the revision stops changing after a command (the change is committed). */
export async function committed(m1: M1Session, before: string | null): Promise<void> {
  await expect.poll(async () => (await historyState(m1.page)).revisionId, { message: 'the change did not create a revision' }).not.toBe(before)
  await expect.poll(async () => (await historyState(m1.page)).openGestures).toBe(false)
}

/** Cleanup after a settings case: values back to what they were before it. */
export async function restoreSettings(page: Page, values: { customHue?: number; transcriptionProvider?: string }): Promise<void> {
  await ensureProbe(page)
  await page.evaluate((next) => (window as unknown as { __phoneLibraryProbe: { restoreSettings(v: typeof next): void } }).__phoneLibraryProbe.restoreSettings(next), values)
}

/** Resolves once the open sheet finished its rise animation, so element boxes are final for a tap. */
export async function sheetSettled(m1: M1Session): Promise<void> {
  await expect(m1.sheet).toBeVisible()
  await m1.page.waitForFunction(() => {
    const sheet = document.querySelector('.phone-sheet')
    return Boolean(sheet) && sheet!.getAnimations().every(animation => animation.playState !== 'running')
  }, undefined, { timeout: 10_000 })
}

export async function tapDone(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(PHONE_TEST_IDS.sheetDone))
}

export async function tapCancel(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(PHONE_TEST_IDS.sheetCancel))
}

/** Closes whatever sheet is open with Cancel/Close until none is left. */
export async function closeSheets(m1: M1Session): Promise<void> {
  for (let attempt = 0; attempt < 4 && await m1.sheet.isVisible(); attempt++) {
    await tapCancel(m1)
    await m1.touch.nextFrame(2)
  }
  await expect(m1.sheet).toBeHidden({ timeout: 10_000 })
}
