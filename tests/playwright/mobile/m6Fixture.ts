import type { Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { expect, tapOn, type M1Session } from './m1Fixture'

/**
 * Helpers of the M6 journeys (packet N3) on the shared M1 phone world. The in-page probe READS the
 * shared stores (settings, library items, mask pen draft); its only writes put settings back after a
 * case changed them through the phone UI, so the next case starts from the defaults.
 */

const PROBE_SOURCE = `
import { useSettingsStore } from '/src/stores/settingsStore.ts';
import { useMediaStore } from '/src/stores/mediaStore/index.ts';
import { usePhonePenStore } from '/src/components/mobileSkin/mask/phonePenStore.ts';

window.__phoneM6Probe = {
  settings() {
    const s = useSettingsStore.getState();
    return {
      showShortcutDisplay: s.showShortcutDisplay, shortcutDisplayScale: s.shortcutDisplayScale,
      replayMode: s.guidedActionReplayVisualizationMode, replayBudgetMs: s.guidedActionReplayBudgetMs,
      replayCompression: s.guidedActionReplayCompressionMode, youtubeApiKey: s.youtubeApiKey,
    };
  },
  library() {
    return useMediaStore.getState().files.map(file => ({
      id: file.id, name: file.name, type: file.type, frames: file.modelSequence?.frames?.length ?? file.gaussianSplatSequence?.frames?.length ?? 0,
      proxyStatus: file.proxyStatus ?? null,
    }));
  },
  pen() {
    const s = usePhonePenStore.getState();
    return { active: s.active, points: s.path.points.map(p => ({ x: p.x, y: p.y, handleX: p.handleX, handleY: p.handleY })), closed: s.path.closed };
  },
  // Cleanup only.
  restoreSettings(values) {
    const s = useSettingsStore.getState();
    if ('showShortcutDisplay' in values) s.setShowShortcutDisplay(values.showShortcutDisplay);
    if ('shortcutDisplayScale' in values) s.setShortcutDisplayScale(values.shortcutDisplayScale);
    if ('replayMode' in values) s.setGuidedActionReplayVisualizationMode(values.replayMode);
    if ('replayBudgetMs' in values) s.setGuidedActionReplayBudgetMs(values.replayBudgetMs);
    if ('replayCompression' in values) s.setGuidedActionReplayCompressionMode(values.replayCompression);
    if ('youtubeApiKey' in values) s.setYouTubeApiKey(values.youtubeApiKey);
  },
};
`

export interface M6Settings {
  showShortcutDisplay: boolean
  shortcutDisplayScale: number
  replayMode: string
  replayBudgetMs: number
  replayCompression: string
  youtubeApiKey: string
}
export interface M6LibraryFile { id: string; name: string; type: string; frames: number; proxyStatus: string | null }
export interface M6Pen { active: boolean; points: Array<{ x: number; y: number; handleX: number; handleY: number }>; closed: boolean }

async function ensureProbe(page: Page): Promise<void> {
  if (await page.evaluate(() => Boolean((window as unknown as { __phoneM6Probe?: unknown }).__phoneM6Probe))) return
  await page.addScriptTag({ type: 'module', content: PROBE_SOURCE })
  await page.waitForFunction(() => Boolean((window as unknown as { __phoneM6Probe?: unknown }).__phoneM6Probe), undefined, { timeout: 30_000 })
}

async function call<T>(page: Page, method: 'settings' | 'library' | 'pen'): Promise<T> {
  await ensureProbe(page)
  return page.evaluate((name) => (window as unknown as { __phoneM6Probe: Record<string, () => unknown> }).__phoneM6Probe[name]() as T, method)
}

export const m6Settings = (page: Page) => call<M6Settings>(page, 'settings')
export const m6Library = (page: Page) => call<M6LibraryFile[]>(page, 'library')
export const m6Pen = (page: Page) => call<M6Pen>(page, 'pen')

export async function restoreM6Settings(page: Page, values: Partial<M6Settings>): Promise<void> {
  await ensureProbe(page)
  await page.evaluate((next) => (window as unknown as { __phoneM6Probe: { restoreSettings(v: typeof next): void } }).__phoneM6Probe.restoreSettings(next), values)
}

/** The grey-out notice explains itself; OK closes it again. */
export async function expectExplained(m1: M1Session, text: RegExp): Promise<void> {
  const notice = m1.page.getByTestId(PHONE_TEST_IDS.unavailableNotice)
  await expect(notice).toContainText(text)
  await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
  await expect(notice).toBeHidden()
}

/** Writes a minimal valid binary glTF (no meshes) for sequence import tests. */
export function writeMinimalGlb(file: string): void {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0 }))
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)])
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + padded.length, 8)
  const chunk = Buffer.alloc(8)
  chunk.writeUInt32LE(padded.length, 0)
  chunk.writeUInt32LE(0x4e4f534a, 4)
  writeFileSync(file, Buffer.concat([header, chunk, padded]))
}
