import type { Locator } from '@playwright/test'
import sharp from 'sharp'
import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_WORKSPACE_TEST_IDS as WS } from '../../../src/components/mobileSkin/workspace/phoneWorkspaceTestIds'
import { IDS, expect, tapAction, tapOn, type M1Session } from './m1Fixture'

/**
 * Helpers of the M4 colour-editor journeys (packet R3). They build on the M1 phone world
 * (m1Fixture.ts: one UI-built project, a fresh empty composition per test, real touch). The
 * landscape editor is entered by turning the emulated phone (width and height swapped) and left in
 * portrait again at the end of each case. Truth: the clip's colour grade in the timeline store
 * (`clip.colorCorrection`, read through the dev-only `window.store`), the preview's pixels and the
 * scope canvas' pixels. Every action under test is real touch.
 */

export const COLLAPSE_KEY = 'ms.phoneWorkspace.collapsed'

export interface GradeNode { id: string; type: string; name: string; enabled: boolean; params: Record<string, unknown> }
export interface Grade { activeVersionId: string; versions: Array<{ id: string; nodes: GradeNode[] }>; ui: { selectedNodeId?: string } }

/** The clip's colour grade from the timeline store (null when the clip has none yet). */
export async function readGrade(m1: M1Session, clipId: string): Promise<Grade | null> {
  return m1.page.evaluate((id) => {
    const store = (window as unknown as { store?: { getState(): { clips: Array<{ id: string; colorCorrection?: unknown }> } } }).store
    if (!store) throw new Error('window.store is not exposed (dev build expected)')
    const clip = store.getState().clips.find(item => item.id === id)
    return clip?.colorCorrection ? JSON.parse(JSON.stringify(clip.colorCorrection)) as Grade : null
  }, clipId)
}

/** The whole clip from the timeline store as JSON (for "nothing changed" checks). */
export async function clipJson(m1: M1Session, clipId: string): Promise<string> {
  return m1.page.evaluate((id) => {
    const store = (window as unknown as { store: { getState(): { clips: Array<{ id: string }> } } }).store
    const clip = store.getState().clips.find(item => item.id === id)
    return JSON.stringify(clip, (_key, value: unknown) => (value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value] : value))
  }, clipId)
}

export function activeNodes(grade: Grade | null): GradeNode[] {
  return grade?.versions.find(version => version.id === grade.activeVersionId)?.nodes ?? []
}

export function primaryNode(grade: Grade | null): GradeNode | undefined {
  return activeNodes(grade).find(node => node.type === 'primary')
}

export async function clipKeyframeCount(m1: M1Session, clipId: string, prefix = 'color.'): Promise<number> {
  return m1.page.evaluate(({ id, start }) => {
    const store = (window as unknown as { store: { getState(): { clipKeyframes: Map<string, Array<{ property: string }>> } } }).store
    return (store.getState().clipKeyframes.get(id) ?? []).filter(keyframe => keyframe.property.startsWith(start)).length
  }, { id: clipId, start: prefix })
}

/** Turns the emulated phone to landscape; returns the portrait size to restore. */
export async function turnToLandscape(m1: M1Session): Promise<{ width: number; height: number }> {
  const portrait = m1.page.viewportSize()
  if (!portrait) throw new Error('no viewport')
  const size = portrait.width < portrait.height ? portrait : { width: portrait.height, height: portrait.width }
  await m1.page.setViewportSize({ width: size.height, height: size.width })
  await expect.poll(() => m1.page.evaluate(() => window.innerWidth > window.innerHeight), { message: 'the page did not turn to landscape' }).toBe(true)
  return size
}

/** Leaves the editor (Back) when it is open and turns the phone back to portrait. */
export async function leaveLandscape(m1: M1Session, portrait: { width: number; height: number }): Promise<void> {
  const back = m1.page.getByTestId(WS.back)
  if (await back.isVisible().catch(() => false)) await tapOn(m1, back)
  await expect(m1.page.getByTestId(WS.root)).toHaveCount(0)
  await m1.page.setViewportSize(portrait)
  await expect.poll(() => m1.page.evaluate(() => window.innerWidth < window.innerHeight)).toBe(true)
}

/** Forgets every remembered side-panel choice (arrangement: each case starts with open side panels). */
export async function resetSidePanels(m1: M1Session): Promise<void> {
  await m1.page.evaluate((key) => { window.localStorage.removeItem(key) }, COLLAPSE_KEY)
}

/** Root toolbar -> Editors -> Colour, by touch. Nothing selected keeps the root toolbar. */
export async function openColourFromEditors(m1: M1Session): Promise<void> {
  await expect.poll(async () => (await m1.timeline()).selectedIds.length, { message: 'the root toolbar needs an empty selection' }).toBe(0)
  await tapAction(m1, phoneActionTestId('editors'))
  await expect(m1.sheet, 'the Editors sheet did not open').toBeVisible()
  await tapOn(m1, m1.page.getByTestId(`${WS.editorRow}-color`))
  await expect(m1.page.getByTestId(WS.root)).toHaveAttribute('data-workspace', 'color')
  await expect(m1.sheet).toBeHidden()
  await expect(controlsPanel(m1).locator('.color-tool-dock'), 'the colour controls did not load').toBeVisible({ timeout: 30_000 })
}

export const controlsPanel = (m1: M1Session): Locator => m1.page.getByTestId(WS.main)
export const scopesSide = (m1: M1Session): Locator => m1.page.getByTestId(WS.sideLeft)
export const nodesSide = (m1: M1Session): Locator => m1.page.getByTestId(WS.sideRight)

export async function tapTool(m1: M1Session, tool: string): Promise<void> {
  await tapOn(m1, controlsPanel(m1).locator(`[data-color-tool="${tool}"]`))
}

export function wheelPad(m1: M1Session, label: 'Lift' | 'Gamma' | 'Gain' | 'Offset'): Locator {
  return controlsPanel(m1).locator('.resolve-color-wheel').filter({ has: m1.page.locator('header strong', { hasText: label }) }).locator('.color-wheel-pad')
}

export async function centreOf(target: Locator): Promise<{ x: number; y: number }> {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('target not rendered')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export async function tapUndo(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.undo))
}

export interface Shot { width: number; height: number; data: Buffer }

/** Element pixels at CSS scale, resized to a fixed size so two reads compare one to one. */
export async function elementPixels(target: Locator, size = { width: 96, height: 64 }): Promise<Shot> {
  const png = await target.screenshot({ animations: 'allow', caret: 'initial', scale: 'css', timeout: 5_000 })
  const { data, info } = await sharp(png).removeAlpha().resize(size.width, size.height, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

/** Share of pixels brighter than `threshold` in any channel: how much trace a scope draws. */
export function litShare(shot: Shot, threshold = 70): number {
  let lit = 0
  for (let index = 0; index < shot.data.length; index += 3) {
    if (Math.max(shot.data[index], shot.data[index + 1], shot.data[index + 2]) > threshold) lit++
  }
  return lit / (shot.data.length / 3)
}

/** Mean absolute channel difference of two equally sized shots. */
export function meanDifference(a: Shot, b: Shot): number {
  let sum = 0
  for (let index = 0; index < a.data.length; index++) sum += Math.abs(a.data[index] - b.data[index])
  return sum / a.data.length
}
