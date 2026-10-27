import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Locator } from '@playwright/test'

import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_SHEET_FRAME_TEST_IDS, PHONE_SHEET_LAYOUT, phoneSheetCaps } from '../../../src/components/mobileSkin/sheets/phoneSheetSizing'
import { PHONE_COMPOSITIONS_TEST_IDS } from '../../../src/components/mobileSkin/compositions/phoneCompositionsTestIds'
import { PHONE_PANELS_TEST_IDS as PANELS } from '../../../src/components/mobileSkin/panels/phonePanelsTestIds'
import { PHONE_WORKSPACES } from '../../../src/components/mobileSkin/workspace/phoneWorkspaceCatalog'
import { PHONE_WORKSPACE_TEST_IDS as WS } from '../../../src/components/mobileSkin/workspace/phoneWorkspaceTestIds'
import { expect, IDS, importViaSheet, M1_IDS, tapAction, tapOn, test, TOPBAR_EXPORT, TOPBAR_PROJECTS, type M1Session } from './m1Fixture'

/**
 * M8 visual sweep: opens every screen of the phone editor once, the way a person reaches it, and
 * closes it again. Root and clip toolbar actions that open a sheet, every sheet and desktop panel of
 * All tools, the top bar screens (projects sheet, home, new-project form, export, compositions) and
 * every landscape editor of the Editors sheet (portrait and landscape viewport).
 *
 * With PHONE_VISUAL_SWEEP_DIR set, each settled screen is saved as
 * `<dir>/<project>/<nnn>-<name>.png` and one JSON line per screenshot goes to
 * `<dir>/<project>/metrics.jsonl`: viewport, preview, sheet, transport and timeline boxes (visible
 * height = the part inside the viewport and above the sheet). Without the variable the spec only
 * proves that every screen opens and closes. Every open sheet is always checked against the layout
 * invariants in expectSheetInvariants (preview minimum, sheet inside the viewport, primary action and
 * Undo reachable, no horizontal overflow, no toast over the sheet). Actions that are greyed in this state are listed in
 * `skipped.jsonl` (with the variable) and as test annotations.
 */
test.describe.configure({ timeout: 600_000 })

const SWEEP_ROOT = process.env.PHONE_VISUAL_SWEEP_DIR?.trim() || null

/** Actions that do not open a sheet (they edit directly or only show a hint). */
const NO_SHEET_ACTIONS = new Set(['edit', 'reorder', 'split', 'delete', 'ripple-delete', 'duplicate'])

interface Box { top: number; bottom: number; height: number }

interface ScreenMetrics {
  viewportWidth: number
  viewportHeight: number
  visualViewportHeight: number
  sheetHeightMode: string | null
  sheet: Box | null
  preview: Box | null
  previewCanvas: Box | null
  transport: Box | null
  timeline: Box | null
  toolbar: Box | null
  previewVisibleHeight: number
  previewCanvasVisibleHeight: number
  transportVisible: boolean
  timelineVisible: boolean
  timelineVisibleHeight: number
  toolbarVisible: boolean
  sheetTitle: string | null
  sheetDetent: string | null
  /** The header's primary action (Done, else Cancel/Close) is inside the viewport and not covered. */
  primaryActionVisible: boolean
  /** Undo in the docked transport can be hit at its centre. */
  undoReachable: boolean
  /** The page, the sheet or its body is wider than the viewport (px of overflow, 0 = none). */
  horizontalOverflow: number
  /** px the toast overlaps the sheet (0 = none or no toast). */
  toastOverSheet: number
  /** px an info toast overlaps the docked transport or the picture (0 = none). */
  toastOverPicture: number
}

function projectDir(projectName: string): string | null {
  return SWEEP_ROOT ? path.join(SWEEP_ROOT, projectName) : null
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
}

async function measure(m1: M1Session): Promise<ScreenMetrics> {
  return m1.page.evaluate((ids) => {
    const boxOf = (testId: string): { top: number; bottom: number; height: number } | null => {
      const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
      if (!element) return null
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') return null
      const box = element.getBoundingClientRect()
      if (box.width < 1 || box.height < 1) return null
      return { top: Math.round(box.top * 10) / 10, bottom: Math.round(box.bottom * 10) / 10, height: Math.round(box.height * 10) / 10 }
    }
    const viewportHeight = window.innerHeight
    const sheetElement = document.querySelector<HTMLElement>(`[data-testid="${ids.sheet}"]`)
    const sheet = boxOf(ids.sheet)
    const limit = sheet ? Math.min(sheet.top, viewportHeight) : viewportHeight
    const visibleHeight = (box: { top: number; bottom: number } | null) => (box ? Math.max(0, Math.min(box.bottom, limit) - Math.max(box.top, 0)) : 0)
    const preview = boxOf(ids.preview)
    const previewCanvas = (() => {
      const element = document.querySelector<HTMLElement>(`[data-testid="${ids.preview}"] [data-testid="${ids.canvas}"]`)
      if (!element) return null
      const box = element.getBoundingClientRect()
      return box.height < 1 ? null : { top: Math.round(box.top * 10) / 10, bottom: Math.round(box.bottom * 10) / 10, height: Math.round(box.height * 10) / 10 }
    })()
    const transport = boxOf(ids.transport)
    const timeline = boxOf(ids.timeline)
    const toolbar = boxOf(ids.toolbar)
    // Occlusion: a box counts only where the topmost element at sample points belongs to it (the clear sheet backdrop is
    // skipped; sheets, the home and landscape editors lie on top of the shell without changing its layout).
    const uncovered = (testId: string, box: { top: number; bottom: number } | null): number => {
      const element = document.querySelector<HTMLElement>(testId === ids.canvas ? `[data-testid="${ids.preview}"] [data-testid="${ids.canvas}"]` : `[data-testid="${testId}"]`)
      if (!element || !box) return 0
      const rect = element.getBoundingClientRect()
      let hits = 0
      let samples = 0
      for (let y = Math.max(rect.top, 0) + 2; y < Math.min(rect.bottom, viewportHeight) - 1; y += 4) {
        samples++
        const xs = [rect.left + rect.width * 0.25, rect.left + rect.width * 0.5, rect.left + rect.width * 0.75]
        if (xs.some((x) => { const hit = document.elementsFromPoint(x, y).find((candidate) => !candidate.classList.contains('phone-sheet-backdrop')); return Boolean(hit && (element === hit || element.contains(hit) || hit.contains(element))) })) hits++
      }
      return samples === 0 ? 0 : Math.round(hits * 4 * 10) / 10
    }
    const fullyVisible = (testId: string, box: { top: number; bottom: number; height: number } | null) => Boolean(box && box.top >= -0.5 && box.bottom <= viewportHeight + 0.5 && uncovered(testId, box) >= box.height - 8)
    return {
      viewportWidth: window.innerWidth,
      viewportHeight,
      visualViewportHeight: Math.round((window.visualViewport?.height ?? viewportHeight) * 10) / 10,
      sheetHeightMode: sheetElement?.getAttribute('data-height') ?? null,
      sheet,
      preview,
      previewCanvas,
      transport,
      timeline,
      toolbar,
      previewVisibleHeight: Math.min(Math.round(visibleHeight(preview) * 10) / 10, uncovered(ids.preview, preview)),
      previewCanvasVisibleHeight: Math.min(Math.round(visibleHeight(previewCanvas) * 10) / 10, uncovered(ids.canvas, previewCanvas)),
      transportVisible: fullyVisible(ids.transport, transport),
      timelineVisible: Math.min(visibleHeight(timeline), uncovered(ids.timeline, timeline)) >= 24,
      timelineVisibleHeight: Math.min(Math.round(visibleHeight(timeline) * 10) / 10, uncovered(ids.timeline, timeline)),
      toolbarVisible: fullyVisible(ids.toolbar, toolbar),
      sheetTitle: sheetElement?.querySelector('.phone-sheet__title')?.textContent?.trim() ?? null,
      sheetDetent: sheetElement?.getAttribute('data-detent') ?? null,
      ...frameChecks(),
    }

    function hitAtCentre(element: Element | null): boolean {
      if (!element) return false
      const rect = element.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1 || rect.top < -0.5 || rect.bottom > viewportHeight + 0.5 || rect.left < -0.5 || rect.right > window.innerWidth + 0.5) return false
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return Boolean(hit && (hit === element || element.contains(hit)))
    }
    function frameChecks() {
      const body = sheetElement?.querySelector<HTMLElement>('.phone-sheet__body') ?? null
      const primary = sheetElement?.querySelector(`[data-testid="${ids.done}"]`) ?? sheetElement?.querySelector(`[data-testid="${ids.cancel}"]`) ?? null
      const sheetRect = sheetElement?.getBoundingClientRect()
      const overflow = Math.max(
        0,
        (document.scrollingElement?.scrollWidth ?? 0) - window.innerWidth,
        sheetRect ? sheetRect.right - window.innerWidth : 0,
        sheetRect ? -sheetRect.left : 0,
        body ? body.scrollWidth - body.clientWidth - 1 : 0,
      )
      const toast = document.querySelector(`[data-testid="${ids.toast}"]`)
      const toastRect = toast?.getBoundingClientRect()
      return {
        primaryActionVisible: hitAtCentre(primary),
        undoReachable: hitAtCentre(document.querySelector(`[data-testid="${ids.undo}"]`)),
        horizontalOverflow: Math.round(overflow),
        toastOverSheet: toastRect && sheetRect ? Math.round(Math.max(0, toastRect.bottom - sheetRect.top)) : 0,
        toastOverPicture: toastRect && sheetRect && !toast?.classList.contains('phone-toast--error')
          ? Math.round(Math.max(0, ...[ids.canvas, ids.transport].map((testId) => {
            const other = document.querySelector(testId === ids.canvas ? `[data-testid="${ids.preview}"] [data-testid="${ids.canvas}"]` : `[data-testid="${testId}"]`)?.getBoundingClientRect()
            if (!other) return 0
            const overlapX = Math.min(toastRect.right, other.right) - Math.max(toastRect.left, other.left)
            const overlapY = Math.min(toastRect.bottom, other.bottom) - Math.max(toastRect.top, other.top)
            return overlapX > 0 && overlapY > 0 ? overlapY : 0
          })))
          : 0,
      }
    }
  }, { sheet: IDS.sheet, preview: IDS.previewRegion, canvas: IDS.previewCanvas, transport: IDS.transport, timeline: IDS.timeline, toolbar: IDS.toolbar, done: IDS.sheetDone, cancel: IDS.sheetCancel, undo: IDS.undo, toast: IDS.toast })
}

/**
 * Least visible preview height with any sheet open: 30 % of the visual viewport, at least 200 px
 * (sheets/phoneSheetSizing.ts). The occlusion probe samples every 4 px, hence the 6 px tolerance.
 */
function minPreviewHeight(metrics: ScreenMetrics): number {
  return Math.max(metrics.visualViewportHeight * PHONE_SHEET_LAYOUT.minPreviewShare, PHONE_SHEET_LAYOUT.minPreviewPx) - 6
}

/**
 * Layout invariants for every open sheet, on every phone project: the preview keeps its minimum
 * height, the sheet lies inside the viewport, its primary action and Undo can be hit without
 * scrolling, nothing overflows sideways and the toast never covers the sheet. Soft assertions, so
 * one run lists every screen that breaks a rule.
 */
function expectSheetInvariants(name: string, metrics: ScreenMetrics): void {
  const sheet = metrics.sheet
  if (!sheet) return
  const where = `${name} (${metrics.sheetTitle ?? 'untitled'}, ${metrics.viewportWidth}x${metrics.viewportHeight})`
  expect.soft(metrics.previewVisibleHeight, `${where}: visible preview height`).toBeGreaterThanOrEqual(minPreviewHeight(metrics))
  expect.soft(sheet.top, `${where}: sheet top inside the viewport`).toBeGreaterThanOrEqual(-0.5)
  expect.soft(sheet.bottom, `${where}: sheet bottom inside the viewport`).toBeLessThanOrEqual(metrics.viewportHeight + 0.5)
  expect.soft(metrics.primaryActionVisible, `${where}: primary action visible without scrolling`).toBe(true)
  expect.soft(metrics.undoReachable, `${where}: Undo reachable in the docked transport`).toBe(true)
  expect.soft(metrics.horizontalOverflow, `${where}: horizontal overflow in px`).toBeLessThanOrEqual(0)
  expect.soft(metrics.toastOverSheet, `${where}: toast overlaps the sheet by px`).toBeLessThanOrEqual(0)
  expect.soft(metrics.toastOverPicture, `${where}: toast overlaps the picture or the transport by px`).toBeLessThanOrEqual(0)
}

/** Waits until the open sheet (if any) left its loading fallback, its rise animation ended and its box stopped moving. */
async function settle(m1: M1Session, target?: Locator): Promise<void> {
  const { page } = m1
  const sheet = m1.sheet
  if (await sheet.isVisible()) {
    await expect.poll(async () => (await sheet.locator('.phone-sheet__title').textContent())?.trim(), { message: 'the sheet stayed on Loading', timeout: 20_000 }).not.toBe('Loading')
  }
  // Lazy content inside a sheet or panel ("Loading..." placeholders): best effort, a slow panel is captured as it is.
  await expect.poll(async () => page.evaluate((sheetId) => {
    const element = document.querySelector<HTMLElement>(`[data-testid="${sheetId}"]`)
    return element ? !/^\s*Loading\b/.test(element.querySelector('.phone-sheet__body')?.textContent ?? '') : true
  }, IDS.sheet), { timeout: 8_000 }).toBe(true).catch(() => undefined)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const watched = target ?? (await sheet.isVisible() ? sheet : page.getByTestId(IDS.root))
  let previous = ''
  for (let round = 0; round < 40; round++) {
    await m1.touch.nextFrame(3)
    const state = await watched.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const running = element.getAnimations({ subtree: false }).some((animation) => animation.playState === 'running')
      const images = [...element.querySelectorAll('img')].every((image) => image.complete)
      return `${Math.round(box.top)}:${Math.round(box.height)}:${running}:${images}`
    }).catch(() => 'gone')
    if (state === previous && !state.includes('true:') && state.endsWith(':true')) return
    if (state === previous && state === 'gone') return
    previous = state
  }
}

class Sweep {
  private index = 0
  private readonly lines: string[] = []
  private readonly skippedLines: string[] = []
  private readonly m1: M1Session
  private readonly group: number
  private readonly projectName: string
  private readonly annotate: (text: string) => void
  constructor(m1: M1Session, group: number, projectName: string, annotate: (text: string) => void) {
    this.m1 = m1
    this.group = group
    this.projectName = projectName
    this.annotate = annotate
  }

  async capture(name: string, context: Record<string, unknown> = {}, target?: Locator): Promise<void> {
    await settle(this.m1, target)
    this.index++
    const file = `${this.group}${String(this.index).padStart(2, '0')}-${slug(name)}.png`
    const dir = projectDir(this.projectName)
    const metrics = await measure(this.m1)
    expectSheetInvariants(name, metrics)
    if (dir) {
      await mkdir(dir, { recursive: true })
      await this.m1.page.screenshot({ path: path.join(dir, file), animations: 'disabled', caret: 'hide', timeout: 15_000 })
    }
    this.lines.push(JSON.stringify({ file, name, project: this.projectName, ...context, ...metrics }))
  }

  skip(name: string, reason: string): void {
    this.annotate(`${name}: ${reason}`)
    this.skippedLines.push(JSON.stringify({ group: this.group, name, reason }))
  }

  async flush(): Promise<void> {
    const dir = projectDir(this.projectName)
    if (!dir) return
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `metrics-${this.group}.part.jsonl`), this.lines.map((line) => `${line}\n`).join(''))
    await writeFile(path.join(dir, `skipped-${this.group}.part.jsonl`), this.skippedLines.map((line) => `${line}\n`).join(''))
  }
}

async function startSweep(m1: M1Session, group: number, testInfo: { project: { name: string }; annotations: Array<{ type: string; description?: string }> }): Promise<Sweep> {
  return new Sweep(m1, group, testInfo.project.name, (text) => testInfo.annotations.push({ type: 'visual-sweep-skip', description: text }))
}

async function importShortClip(m1: M1Session): Promise<string> {
  const state = await importViaSheet(m1, { visual: [m1.media.short.path] }, { main: 1, total: 1 })
  return state.main[0].id
}

async function closeSheet(m1: M1Session): Promise<void> {
  for (let attempt = 0; attempt < 3 && await m1.sheet.isVisible(); attempt++) {
    const cancel = m1.page.getByTestId(IDS.sheetCancel)
    if (await cancel.isVisible()) await tapOn(m1, cancel)
    else await m1.page.keyboard.press('Escape')
    await expect(m1.sheet).toBeHidden({ timeout: 5_000 }).catch(() => undefined)
  }
  await expect(m1.sheet, 'a sheet did not close').toBeHidden()
}

async function dismissNotice(m1: M1Session): Promise<string | null> {
  const notice = m1.page.getByTestId(IDS.unavailableNotice)
  if (!await notice.isVisible()) return null
  const text = (await notice.innerText()).replace(/\s+/g, ' ').trim()
  await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
  await expect(notice).toBeHidden()
  return text
}

async function ensureSelected(m1: M1Session, clipId: string): Promise<void> {
  if ((await m1.timeline()).selectedIds.includes(clipId)) return
  await m1.bridge.toolData('selectClips', { clipIds: [clipId] })
  await expect.poll(async () => (await m1.timeline()).selectedIds).toContain(clipId)
}

async function ensureNothingSelected(m1: M1Session): Promise<void> {
  if ((await m1.timeline()).selectedIds.length === 0) return
  await m1.bridge.toolData('clearSelection')
  await expect.poll(async () => (await m1.timeline()).selectedIds.length).toBe(0)
}

/** Taps a toolbar action; returns true when a sheet or workspace opened, false (after recording why) otherwise. */
async function openByAction(m1: M1Session, sweep: Sweep, actionId: string, label: string): Promise<boolean> {
  const button = m1.page.getByTestId(phoneActionTestId(actionId))
  if (await button.count() === 0) {
    sweep.skip(label, 'not on the toolbar in this state')
    return false
  }
  if (await button.getAttribute('aria-disabled') === 'true') {
    await tapAction(m1, phoneActionTestId(actionId))
    const reason = await dismissNotice(m1)
    sweep.skip(label, `greyed: ${reason ?? 'no reason shown'}`)
    return false
  }
  await tapAction(m1, phoneActionTestId(actionId))
  const opened = await expect(m1.sheet).toBeVisible({ timeout: 10_000 }).then(() => true, () => false)
  if (!opened) {
    const reason = await dismissNotice(m1)
    sweep.skip(label, `no sheet opened${reason ? ` (${reason})` : ''}`)
  }
  return opened
}

/** The actions the toolbar renders in its current scope (id and label), read from the DOM. */
async function toolbarActions(m1: M1Session, scope: 'root' | 'clip'): Promise<Array<{ id: string; label: string }>> {
  await expect(m1.toolbar).toHaveAttribute('data-scope', scope)
  return m1.toolbar.locator('[data-testid^="phone-action-"]').evaluateAll((nodes) => nodes.map((node) => ({
    id: (node.getAttribute('data-testid') ?? '').replace(/^phone-action-/, ''),
    label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 40),
  })))
}

test.afterAll(async ({}, testInfo) => {
  const dir = projectDir(testInfo.project.name)
  if (!dir) return
  const files = (await readdir(dir).catch(() => [] as string[])).toSorted()
  for (const kind of ['metrics', 'skipped']) {
    const parts = files.filter((file) => file.startsWith(`${kind}-`) && file.endsWith('.part.jsonl'))
    const merged = (await Promise.all(parts.map((file) => readFile(path.join(dir, file), 'utf8')))).join('')
    await writeFile(path.join(dir, `${kind}.jsonl`), merged)
  }
})

test('sweep 1: editor, top bar, projects, home and new-project form @phone', async ({ m1 }, testInfo) => {
  const dir = projectDir(testInfo.project.name)
  if (dir) await rm(dir, { recursive: true, force: true })
  const sweep = await startSweep(m1, 1, testInfo)
  await sweep.capture('editor-empty')
  const clipId = await importShortClip(m1)
  await sweep.capture('editor-with-clip')
  await ensureSelected(m1, clipId)
  await expect(m1.page.getByTestId(phoneActionTestId('split'))).toBeVisible()
  await sweep.capture('editor-clip-selected')
  await ensureNothingSelected(m1)

  await tapOn(m1, m1.page.getByTestId(IDS.projectName))
  await expect(m1.sheet, 'the projects sheet did not open').toBeVisible()
  await sweep.capture('topbar-projects-sheet', { via: 'project name' })
  await closeSheet(m1)

  await tapOn(m1, m1.page.getByTestId(TOPBAR_EXPORT))
  await expect(m1.sheet, 'the export sheet did not open').toBeVisible()
  await sweep.capture('topbar-export-sheet', { via: 'top bar export' })
  await closeSheet(m1)

  await tapOn(m1, m1.page.getByTestId(PHONE_COMPOSITIONS_TEST_IDS.topBarButton))
  await expect(m1.sheet, 'the compositions sheet did not open').toBeVisible()
  await sweep.capture('topbar-compositions-sheet', { via: 'top bar compositions' })
  await closeSheet(m1)

  await tapOn(m1, m1.page.getByTestId('phone-topbar-assistant'))
  await expect(m1.sheet, 'the assistant sheet did not open').toBeVisible()
  await sweep.capture('topbar-assistant-sheet', { via: 'top bar assistant' })
  await closeSheet(m1)

  const home = m1.page.getByTestId(M1_IDS.home)
  await tapOn(m1, m1.page.getByTestId(TOPBAR_PROJECTS))
  await expect(home, 'the home did not open from the top bar').toBeVisible()
  await sweep.capture('home', { via: 'top bar projects' }, home)
  const newProject = m1.page.getByTestId(M1_IDS.newProject)
  if (await newProject.isVisible()) {
    await tapOn(m1, newProject)
    await expect(m1.page.getByTestId(M1_IDS.createProject)).toBeVisible()
    await sweep.capture('home-new-project-form', { via: 'home new project' }, home)
  }
  await tapOn(m1, home.getByRole('button', { name: 'Back to editing' }))
  await expect(home).toBeHidden()
  await expect(m1.page.getByTestId(IDS.timeline)).toBeVisible()
  await sweep.flush()
})

test('sweep 2: root toolbar sheets @phone', async ({ m1 }, testInfo) => {
  const sweep = await startSweep(m1, 2, testInfo)
  await importShortClip(m1)
  await ensureNothingSelected(m1)
  const actions = await toolbarActions(m1, 'root')
  expect(actions.length, 'root toolbar actions').toBeGreaterThan(5)
  for (const action of actions.filter((candidate) => !NO_SHEET_ACTIONS.has(candidate.id))) {
    await ensureNothingSelected(m1)
    if (!await openByAction(m1, sweep, action.id, `root-${action.id}`)) continue
    await sweep.capture(`root-${action.id}`, { via: `root toolbar: ${action.label}` })
    await closeSheet(m1)
  }
  await sweep.flush()
})

test('sweep 3: clip toolbar sheets @phone', async ({ m1 }, testInfo) => {
  const sweep = await startSweep(m1, 3, testInfo)
  const clipId = await importShortClip(m1)
  await ensureSelected(m1, clipId)
  const actions = await toolbarActions(m1, 'clip')
  expect(actions.length, 'clip toolbar actions').toBeGreaterThan(5)
  for (const action of actions.filter((candidate) => !NO_SHEET_ACTIONS.has(candidate.id))) {
    await ensureSelected(m1, clipId)
    if (!await openByAction(m1, sweep, action.id, `clip-${action.id}`)) continue
    await sweep.capture(`clip-${action.id}`, { via: `clip toolbar: ${action.label}` })
    await closeSheet(m1)
  }
  await sweep.flush()
})

/** Opens All tools from the root toolbar and returns its entries of `kind` (id, label, disabled). */
async function allToolsEntries(m1: M1Session, kind: string): Promise<Array<{ id: string; label: string; disabled: boolean }>> {
  await ensureNothingSelected(m1)
  await tapAction(m1, phoneActionTestId('all-tools'))
  await expect(m1.page.getByTestId(PANELS.allToolsSearch), 'All tools did not open').toBeVisible()
  const entries = await m1.page.locator(`[data-testid="${PANELS.allToolsEntry}"][data-kind="${kind}"]`).evaluateAll((nodes) => nodes.map((node) => ({
    id: node.getAttribute('data-entry-id') ?? '',
    label: (node.querySelector('.phone-alltools__label')?.textContent ?? node.textContent ?? '').trim().slice(0, 40),
    disabled: node.getAttribute('aria-disabled') === 'true',
  })))
  await closeSheet(m1)
  return entries
}

async function sweepAllTools(m1: M1Session, sweep: Sweep, clipId: string, kind: 'sheet' | 'panel', capturedFirst: boolean): Promise<void> {
  const entries = await allToolsEntries(m1, kind)
  expect(entries.length, `All tools lists ${kind} entries`).toBeGreaterThan(0)
  for (const item of entries) {
    const name = `alltools-${item.id.replace(':', '-')}`
    await ensureNothingSelected(m1)
    await tapAction(m1, phoneActionTestId('all-tools'))
    await expect(m1.page.getByTestId(PANELS.allToolsSearch)).toBeVisible()
    const row = m1.page.locator(`[data-testid="${PANELS.allToolsEntry}"][data-entry-id="${item.id}"]`)
    if (await row.getAttribute('aria-disabled') === 'true') {
      // Clip sheets (Trim modes, Replace) need a selection: select the clip while All tools stays open.
      await m1.bridge.toolData('selectClips', { clipIds: [clipId] })
      const enabled = await expect(row).toHaveAttribute('aria-disabled', 'false', { timeout: 5_000 }).then(() => true, () => false)
      if (!enabled) {
        await tapOn(m1, row)
        const reason = await dismissNotice(m1)
        sweep.skip(name, `greyed: ${reason ?? 'no reason shown'}`)
        await closeSheet(m1)
        continue
      }
    }
    await tapOn(m1, row)
    const workspace = m1.page.getByTestId(WS.root)
    // The entry opens a sheet, a desktop panel, a landscape editor, or explains why not.
    await expect.poll(async () => await workspace.isVisible() || await m1.page.getByTestId(IDS.unavailableNotice).isVisible()
      || (await m1.sheet.isVisible() && !await m1.page.getByTestId(PANELS.allToolsSearch).isVisible()), { timeout: 15_000 }).toBe(true).catch(() => undefined)
    if (await workspace.isVisible()) {
      await sweep.capture(name, { via: `All tools: ${item.label}` }, workspace)
      await tapOn(m1, m1.page.getByTestId(WS.back))
      await expect(workspace).toBeHidden()
      continue
    }
    if (!await m1.sheet.isVisible()) {
      const reason = await dismissNotice(m1)
      sweep.skip(name, `no sheet opened${reason ? ` (${reason})` : ''}`)
      continue
    }
    if (kind === 'panel') {
      await expect(m1.page.getByTestId(PANELS.panelHost)).toBeVisible({ timeout: 15_000 }).catch(() => undefined)
    }
    await sweep.capture(name, { via: `All tools: ${item.label}`, entryDisabledWithoutSelection: item.disabled, capturedFirst })
    await closeSheet(m1)
  }
}

test('sweep 4: every sheet of All tools @phone', async ({ m1 }, testInfo) => {
  const sweep = await startSweep(m1, 4, testInfo)
  const clipId = await importShortClip(m1)
  await ensureNothingSelected(m1)
  await tapAction(m1, phoneActionTestId('all-tools'))
  await expect(m1.page.getByTestId(PANELS.allToolsSearch)).toBeVisible()
  await sweep.capture('alltools-list', { via: 'root toolbar: All tools' })
  await closeSheet(m1)
  await sweepAllTools(m1, sweep, clipId, 'sheet', true)
  await sweep.flush()
})

test('sweep 5: every desktop panel of All tools @phone', async ({ m1 }, testInfo) => {
  const sweep = await startSweep(m1, 5, testInfo)
  const clipId = await importShortClip(m1)
  await sweepAllTools(m1, sweep, clipId, 'panel', false)
  await sweep.flush()
})

test('sweep 6: every landscape editor of the Editors sheet @phone', async ({ m1 }, testInfo) => {
  const sweep = await startSweep(m1, 6, testInfo)
  await importShortClip(m1)
  const portrait = m1.page.viewportSize()
  if (!portrait) throw new Error('no viewport size')
  const landscape = { width: portrait.height, height: portrait.width }
  for (const editor of PHONE_WORKSPACES) {
    for (const [orientation, size] of [['portrait', portrait], ['landscape', landscape]] as const) {
      await ensureNothingSelected(m1)
      await m1.page.setViewportSize(portrait)
      await tapAction(m1, phoneActionTestId('editors'))
      await expect(m1.sheet, 'the Editors sheet did not open').toBeVisible()
      if (editor === PHONE_WORKSPACES[0] && orientation === 'portrait') await sweep.capture('editors-list', { via: 'root toolbar: Editors' })
      const row = m1.page.getByTestId(`${WS.editorRow}-${editor.id}`)
      if (await row.count() === 0) {
        sweep.skip(`editor-${editor.id}`, 'no row in the Editors sheet')
        await closeSheet(m1)
        break
      }
      await tapOn(m1, row)
      const root = m1.page.getByTestId(WS.root)
      await expect(root, `the ${editor.id} editor did not open`).toHaveAttribute('data-workspace', editor.id)
      await expect(m1.page.getByTestId(WS.main)).toBeVisible()
      try {
        if (orientation === 'landscape') await m1.page.setViewportSize(size)
        await sweep.capture(`editor-${editor.id}-${orientation}`, { via: `Editors: ${editor.title}`, orientation }, root)
      } finally {
        await m1.page.setViewportSize(portrait)
      }
      await tapOn(m1, m1.page.getByTestId(WS.back))
      await expect(root).toBeHidden()
    }
  }
  await sweep.flush()
})


test('sheet frame: content-fit height, grab handle detents, remembered size and drag to close @phone', async ({ m1 }) => {
  const { page } = m1
  await importShortClip(m1)
  await ensureNothingSelected(m1)
  const grabber = page.getByTestId(PHONE_SHEET_FRAME_TEST_IDS.grabber)
  const sheetBox = async () => {
    const box = await m1.sheet.boundingBox()
    if (!box) throw new Error('no sheet box')
    return box
  }
  const caps = async () => page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('.phone-shell')
    const topBar = document.querySelector<HTMLElement>('[data-testid="phone-top-bar"]')
    return { viewport: shell?.getBoundingClientRect().height ?? window.innerHeight, topStrips: topBar?.getBoundingClientRect().bottom ?? 0 }
  }).then(({ viewport, topStrips }) => phoneSheetCaps(viewport, topStrips))
  const openOverlay = async () => {
    await tapAction(m1, phoneActionTestId('overlay'))
    await expect(m1.sheet).toBeVisible()
    await settle(m1)
  }

  await openOverlay()
  const limits = await caps()
  await expect(m1.sheet).toHaveAttribute('data-height', 'tool')
  await expect(m1.sheet).toHaveAttribute('data-detent', 'fit')
  const fit = await sheetBox()
  expect(fit.height, 'a tool sheet opens no higher than its cap').toBeLessThanOrEqual(limits.tool + 1)
  expectSheetInvariants('frame: overlay fit', await measure(m1))

  // Tap: from the largest stop the sheet goes down to a smaller one, and the preview grows.
  const previewBefore = (await page.getByTestId(IDS.previewRegion).boundingBox())!.height
  await tapOn(m1, grabber)
  await expect(m1.sheet).not.toHaveAttribute('data-detent', 'fit')
  await settle(m1)
  const small = await sheetBox()
  expect(small.height, 'the smaller detent is lower').toBeLessThan(fit.height - 4)
  await expect.poll(async () => (await page.getByTestId(IDS.previewRegion).boundingBox())!.height, { message: 'the preview grows' }).toBeGreaterThan(previewBefore + 4)
  expectSheetInvariants('frame: overlay small', await measure(m1))

  // The size is remembered for this sheet id while the session lasts.
  const smallDetent = await m1.sheet.getAttribute('data-detent')
  await closeSheet(m1)
  await openOverlay()
  await expect(m1.sheet, 'the detent is remembered per sheet').toHaveAttribute('data-detent', smallDetent ?? '')

  // Keyboard: ArrowUp steps back up; the handle keeps a styled keyboard focus.
  await grabber.focus()
  await page.keyboard.press('ArrowUp')
  await expect(m1.sheet).not.toHaveAttribute('data-detent', smallDetent ?? '')
  await settle(m1)
  expect((await sheetBox()).height).toBeGreaterThan(small.height + 4)

  // Drag up to the largest stop, then down from the smallest stop: past 30 % of the sheet it closes.
  const handle = await visibleCentreOf(grabber)
  await m1.touch.pan(handle, { x: 0, y: -400 }, { steps: 16, still: 4 })
  await settle(m1)
  const top = await sheetBox()
  expect(top.height, 'a drag up never passes the full cap').toBeLessThanOrEqual(limits.full + 1)
  expectSheetInvariants('frame: overlay dragged up', await measure(m1))
  await grabber.focus()
  for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowDown')
  await settle(m1)
  const lowest = await sheetBox()
  await m1.touch.pan(await visibleCentreOf(grabber), { x: 0, y: Math.round(lowest.height * 0.6) }, { steps: 16, still: 4 })
  await expect(m1.sheet, 'dragging the handle down from the smallest size closes the sheet').toBeHidden()

  // Leave the default size for the following cases.
  await openOverlay()
  await grabber.focus()
  for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await expect(m1.sheet).toHaveAttribute('data-detent', 'fit')
  await closeSheet(m1)
})

async function visibleCentreOf(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox()
  if (!box) throw new Error('no box')
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
}
