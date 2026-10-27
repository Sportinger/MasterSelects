import type { ConsoleMessage, Page, TestInfo } from '@playwright/test'

import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_PANELS_TEST_IDS as PANELS } from '../../../src/components/mobileSkin/panels/phonePanelsTestIds'
import { expect, IDS, tapAction, tapOn, type M1Session } from './m1Fixture'

/**
 * Helpers of the M3 "All tools and desktop panels" journeys: open All tools by touch, open a desktop
 * panel from it, and measure the panel the way a person would notice problems (no content, sideways
 * overflow, no vertical scrolling, page errors).
 */

export const entry = (m1: M1Session, id: string) => m1.page.locator(`[data-testid="${PANELS.allToolsEntry}"][data-entry-id="${id}"]`)
export const host = (m1: M1Session) => m1.page.getByTestId(PANELS.panelHost)

/**
 * The Playwright Vite runs without the local API (8788) and without local helper services, so the
 * browser logs refused /api requests and refused localhost sockets. Those are the test host, not the
 * panel; they are kept as annotations. Everything else (page errors, console.error) fails the case.
 */
export function isTestHostNoise(text: string, url: string): boolean {
  let path = ''
  try { path = new URL(url).pathname } catch { path = '' }
  if (text.startsWith('Failed to load resource') && path.startsWith('/api/')) return true
  return /^WebSocket connection to 'wss?:\/\/(127\.0\.0\.1|localhost):\d+/.test(text) && /ERR_CONNECTION_REFUSED/.test(text)
}

/** Collects page errors and console errors while a case runs. */
export function collectErrors(page: Page): { errors: string[]; noise: string[]; stop: () => void } {
  const errors: string[] = []
  const noise: string[] = []
  const onError = (error: Error) => errors.push(`pageerror: ${error.message}`)
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() !== 'error') return
    const line = `console: ${message.text().slice(0, 300)} @ ${message.location().url}`
    if (isTestHostNoise(message.text(), message.location().url)) noise.push(line)
    else errors.push(line)
  }
  page.on('pageerror', onError)
  page.on('console', onConsole)
  return { errors, noise, stop: () => { page.off('pageerror', onError); page.off('console', onConsole) } }
}

/** All tools from the root toolbar (nothing selected). */
export async function openAllTools(m1: M1Session): Promise<void> {
  if ((await m1.timeline()).selectedIds.length > 0) {
    await m1.bridge.toolData('clearSelection')
    await expect.poll(async () => (await m1.timeline()).selectedIds.length).toBe(0)
  }
  await tapAction(m1, phoneActionTestId('all-tools'))
  await expect(m1.sheet, 'All tools did not open').toBeVisible()
  await expect(m1.page.getByTestId(PANELS.allToolsSearch)).toBeVisible()
}

/** Opens a desktop panel from the already open All tools sheet; resolves when the panel shows content. */
export async function openPanelFromAllTools(m1: M1Session, type: string): Promise<void> {
  const row = entry(m1, `panel:${type}`)
  await expect(row, `All tools lists the ${type} panel`).toHaveCount(1)
  await expect(row).toHaveAttribute('aria-disabled', 'false')
  await tapOn(m1, row)
  await expect(host(m1), `the ${type} panel did not open in the panel sheet`).toHaveAttribute('data-panel-type', type)
  await expect.poll(async () => panelContent(m1), { message: `the ${type} panel shows no content`, timeout: 30_000 }).toBe(true)
}

/** Text, or visible controls and graphics (an icon-only tool palette has no text). */
async function panelContent(m1: M1Session): Promise<boolean> {
  return host(m1).evaluate((node) => {
    const text = (node as HTMLElement).innerText.trim()
    if (/^Loading\b/.test(text)) return false
    if (/\S{3,}/.test(text)) return true
    return [...node.querySelectorAll('button, svg, canvas, input, select')].some((element) => {
      const box = element.getBoundingClientRect()
      return box.width > 4 && box.height > 4
    })
  }).catch(() => false)
}

export interface PanelLayout {
  /** How far the page is wider than the viewport (px). */
  pageOverflow: number
  /** How far the panel content is wider than the panel (px): would scroll sideways. */
  hostOverflow: number
  sheetLeft: number
  sheetRight: number
  viewportWidth: number
  overflowY: string
  /** Visible controls whose touch box is smaller than `minTarget` px tall (label and size). */
  small: string[]
  controls: number
  /** Visible elements reaching past the right edge of the viewport (diagnostics). */
  wide: string[]
}

export async function measurePanel(m1: M1Session, minTarget = 32): Promise<PanelLayout> {
  return m1.page.evaluate(({ hostId, sheetId, minTarget }) => {
    const host = document.querySelector<HTMLElement>(`[data-testid="${hostId}"]`)
    const sheet = document.querySelector<HTMLElement>(`[data-testid="${sheetId}"]`)
    if (!host || !sheet) throw new Error('no panel host or sheet')
    const viewportWidth = window.innerWidth
    const sheetBox = sheet.getBoundingClientRect()
    const hostBox = host.getBoundingClientRect()
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect()
      if (box.width < 1 || box.height < 1) return false
      const style = getComputedStyle(element)
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
    }
    const name = (element: Element) => (element.getAttribute('aria-label') || element.textContent || element.getAttribute('title') || element.tagName).trim().slice(0, 40)
    const controls = [...host.querySelectorAll('button, [role="button"], [role="tab"], select, input:not([type="hidden"]):not([type="range"]):not([type="checkbox"]):not([type="radio"])')]
      .filter(visible)
      // Only what lies inside the visible part of the panel counts; scrolled-away rows are checked when scrolled to.
      .filter((element) => { const box = element.getBoundingClientRect(); return box.bottom > hostBox.top && box.top < hostBox.bottom })
    const small = controls.filter((element) => element.getBoundingClientRect().height < minTarget - 0.5)
      .map((element) => `${name(element)} ${Math.round(element.getBoundingClientRect().width)}x${Math.round(element.getBoundingClientRect().height)}`)
    const wide = [...host.querySelectorAll('*')].filter((element) => visible(element) && element.getBoundingClientRect().right > viewportWidth + 1)
      .slice(0, 6).map((element) => `${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]} ${Math.round(element.getBoundingClientRect().right)}`)
    return {
      pageOverflow: document.documentElement.scrollWidth - viewportWidth,
      hostOverflow: host.scrollWidth - host.clientWidth,
      sheetLeft: sheetBox.left,
      sheetRight: sheetBox.right,
      viewportWidth,
      overflowY: getComputedStyle(host).overflowY,
      small,
      controls: controls.length,
      wide,
    }
  }, { hostId: PANELS.panelHost, sheetId: IDS.sheet, minTarget })
}

/** Opens each panel in turn from All tools and checks content, width, scrolling and errors. */
export async function checkPanelGroup(m1: M1Session, types: readonly string[], testInfo: TestInfo): Promise<void> {
  const { errors, noise, stop } = collectErrors(m1.page)
  try {
    await openAllTools(m1)
    for (const type of types) {
      await openPanelFromAllTools(m1, type)
      const layout = await measurePanel(m1)
      testInfo.annotations.push({ type: `panel-${type}`, description: `${layout.controls} controls in view` })
      if (process.env.MASTERSELECTS_PHONE_PANEL_SHOTS) {
        await m1.page.screenshot({ path: testInfo.outputPath(`panel-${type}.png`) })
      }
      expect(layout.pageOverflow, `${type}: the page is wider than the phone`).toBeLessThanOrEqual(1)
      expect(layout.hostOverflow, `${type}: the panel scrolls sideways (${layout.wide.join(', ')})`).toBeLessThanOrEqual(1)
      expect(layout.sheetLeft, `${type}: sheet left edge`).toBeGreaterThanOrEqual(-1)
      expect(layout.sheetRight, `${type}: sheet right edge`).toBeLessThanOrEqual(layout.viewportWidth + 1)
      expect(['auto', 'scroll'], `${type}: the panel scrolls vertically`).toContain(layout.overflowY)
      expect(layout.small, `${type}: controls smaller than a finger`).toEqual([])
      // Back to the list through the sheet's own "All tools" button.
      await tapOn(m1, m1.page.getByTestId(IDS.sheetDone))
      await expect(m1.page.getByTestId(PANELS.allToolsSearch), `${type}: All tools did not come back`).toBeVisible()
    }
    await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
    await expect(m1.sheet).toBeHidden()
  } finally {
    stop()
  }
  for (const line of noise) testInfo.annotations.push({ type: 'test-host-noise', description: line })
  expect(errors, `page or console errors while the panels were open`).toEqual([])
}
