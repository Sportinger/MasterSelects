import type { Locator, Page } from '@playwright/test'
import { PHONE_M1_TEST_IDS, phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_HOME_TEST_IDS } from '../../../src/components/mobileSkin/home/phoneHomeTestIds'
import { PHONE_SETTINGS_TEST_IDS } from '../../../src/components/mobileSkin/settings/phoneSettingsTestIds'
import { IDS, expect, test, type PhoneSession } from './phoneFixture'

/**
 * M6 accessibility of the phone skin (packet N5), one case per test in the shared Sammeltest
 * project (phoneFixture.ts): names and roles of every control on the main screen, spoken clip
 * names, keyboard reach of a sheet (Tab, Enter, Escape) with a focus trap and focus return, text
 * contrast computed from the rendered colours in the dark and the light theme, hit targets and
 * reduced motion of the sheet animation. Taps are real touch input (phoneTouch.ts).
 */
test.describe.configure({ timeout: 120_000 })

const MAIN_REGIONS = [IDS.topBar, IDS.previewRegion, IDS.transport, IDS.timeline, IDS.toolbar]
const FORMAT = phoneActionTestId('format')

async function tap(phone: PhoneSession, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('tap target is not rendered')
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  // A real finger hits whatever lies on top: fail loudly instead of tapping a covering notice.
  const covered = await target.evaluate((el, { x, y }) => {
    const hit = document.elementFromPoint(x, y)
    return hit && (el === hit || el.contains(hit)) ? '' : `${hit?.tagName.toLowerCase() ?? 'nothing'}.${hit?.className ?? ''}`
  }, point)
  if (covered) throw new Error(`tap target is covered by ${covered}`)
  await phone.touch.tap(point)
}

/**
 * The fixture's media import leaves the 'Copied into project' notice (ProjectMediaCopyToast, fixed above
 * the bottom edge for ~9 s) on screen; on the Projects home it can cover the Settings row. Dismiss it the
 * way a user would, then go on.
 */
async function dismissImportNotice(phone: PhoneSession): Promise<void> {
  const notice = phone.page.locator('.project-media-copy-toast')
  const dismiss = notice.getByRole('button', { name: 'Dismiss' })
  if (await dismiss.isVisible()) await tap(phone, dismiss)
  await expect(notice, 'the import notice still covers the home screen').toHaveCount(0, { timeout: 15_000 })
}

/** Resolves once the open sheet finished its rise animation (boxes are final). */
async function sheetSettled(page: Page): Promise<void> {
  await expect(page.getByTestId(IDS.sheet)).toBeVisible()
  await page.waitForFunction(() => {
    const sheet = document.querySelector('.phone-sheet')
    return Boolean(sheet) && sheet!.getAnimations().every(animation => animation.playState !== 'running')
  }, undefined, { timeout: 10_000 })
}

/** Every visible interactive element inside the given test ids, with its role and accessible name. */
async function unnamedControls(page: Page, regionIds: string[]): Promise<string[]> {
  return page.evaluate((ids) => {
    const SELECTOR = 'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [role="tab"], [role="option"], [role="slider"], [role="radio"]'
    const IMPLICIT: Record<string, string> = { BUTTON: 'button', A: 'link', INPUT: 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox' }
    const nameOf = (el: HTMLElement): string => {
      const label = el.getAttribute('aria-label')?.trim()
      if (label) return label
      const by = el.getAttribute('aria-labelledby')
      if (by) return by.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim()
      const labels = (el as HTMLInputElement).labels
      if (labels && labels.length > 0) return [...labels].map(item => item.textContent ?? '').join(' ').trim()
      return (el.textContent?.trim() || el.getAttribute('title')?.trim() || '')
    }
    const problems: string[] = []
    for (const id of ids) {
      const region = document.querySelector(`[data-testid="${id}"]`)
      if (!region) { problems.push(`region ${id} missing`); continue }
      for (const el of region.querySelectorAll<HTMLElement>(SELECTOR)) {
        if (el.getClientRects().length === 0 || el.closest('[aria-hidden="true"]')) continue
        const role = el.getAttribute('role') || IMPLICIT[el.tagName] || ''
        const name = nameOf(el)
        if (!role || !name) problems.push(`${id}: <${el.tagName.toLowerCase()} data-testid="${el.dataset.testid ?? ''}" class="${el.className}"> role="${role}" name="${name}"`)
      }
    }
    return problems
  }, regionIds)
}

/** Contrast of rendered text against the first opaque background behind it. */
async function lowContrastText(page: Page, selectors: string[], optional: string[] = []): Promise<string[]> {
  return page.evaluate(({ list, optional }) => {
    const parse = (value: string): [number, number, number, number] | null => {
      const match = value.match(/rgba?\(([^)]+)\)/)
      if (!match) return null
      const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number)
      return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
    }
    const lum = ([r, g, b]: number[]) => {
      const c = [r, g, b].map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const background = (el: Element | null): number[] => {
      for (let node = el; node; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor)
        if (bg && bg[3] >= 0.99) return bg
        // A pill drawn by ::before behind the content (the primary top bar button).
        const before = getComputedStyle(node, '::before')
        const pill = before.content !== 'none' && before.position === 'absolute' ? parse(before.backgroundColor) : null
        if (pill && pill[3] >= 0.99) return pill
      }
      return [0, 0, 0, 1]
    }
    const problems: string[] = []
    for (const selector of list) {
      const elements = [...document.querySelectorAll<HTMLElement>(selector)].filter(el => el.getClientRects().length > 0 && (el.textContent ?? '').trim())
      if (elements.length === 0) { if (!optional.includes(selector)) problems.push(`${selector}: no visible text`); continue }
      for (const el of elements) {
        const style = getComputedStyle(el)
        const fg = parse(style.color)
        if (!fg) continue
        const bg = background(el)
        const [hi, lo] = [lum(fg), lum(bg)].toSorted((a, b) => b - a)
        const ratio = (hi + 0.05) / (lo + 0.05)
        const disabled = el.closest('[aria-disabled="true"], :disabled') !== null
        const needed = disabled ? 3 : 4.5
        if (ratio < needed) problems.push(`${selector} "${el.textContent?.trim().slice(0, 30)}" ${ratio.toFixed(2)}:1 < ${needed} (${style.color} on rgb(${bg.slice(0, 3).join(',')}))`)
      }
    }
    return problems
  }, { list: selectors, optional })
}

/** Shown only in some states (an empty composition). */
const OPTIONAL_TEXT = ['.phone-timeline__empty']
const TEXT_SELECTORS = [
  '.phone-top-bar__title', '.phone-comp-tab', '.phone-transport__now', '.phone-transport__total',
  '.phone-tool__label', '.phone-icon-button__label', '.phone-timeline__empty',
]
const SHEET_TEXT_SELECTORS = ['.phone-sheet__title', '.phone-sheet__action']

async function setTheme(phone: PhoneSession, theme: string): Promise<void> {
  const { page } = phone
  await tap(phone, page.getByTestId('phone-topbar-projects'))
  await expect(page.getByTestId(PHONE_M1_TEST_IDS.home)).toBeVisible()
  await dismissImportNotice(phone)
  await tap(phone, page.getByTestId(PHONE_HOME_TEST_IDS.settings))
  await sheetSettled(page)
  const chip = page.locator(`[data-testid="${PHONE_SETTINGS_TEST_IDS.themeChip}"][data-theme="${theme}"]`)
  await tap(phone, chip)
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await tap(phone, page.getByTestId(IDS.sheetDone))
  await expect(page.getByTestId(IDS.sheet)).toHaveCount(0)
  await tap(phone, page.getByRole('button', { name: 'Back to editing' }))
  await expect(page.getByTestId(PHONE_M1_TEST_IDS.home)).toHaveCount(0)
}

test('N5/a11y-names-roles: every control on the main screen, toolbar, timeline and sheet frame has a role and a name @phone', async ({ phone }) => {
  const { page } = phone
  expect(await unnamedControls(page, MAIN_REGIONS), 'controls without role or accessible name').toEqual([])
  await expect(phone.toolbar).toMatchAriaSnapshot(`
    - navigation "Tools":
      - button "Edit"
      - button "Audio"
      - button "Text"
  `)
  await expect(page.getByTestId(IDS.transport)).toMatchAriaSnapshot(`
    - group "Playback":
      - button "Play"
      - button "Undo"
      - button "Redo"
  `)
  await tap(phone, page.getByTestId(FORMAT))
  await sheetSettled(page)
  const sheet = page.getByRole('dialog')
  await expect(sheet, 'the sheet is a named dialog').toHaveAccessibleName(/\S/)
  // The transport stays docked under the sheet (Play, Undo, Redo keep working), so the sheet is a
  // non-modal dialog: aria-modal would hide those controls from assistive technology.
  await expect(page.getByTestId(IDS.transport)).toBeVisible()
  await expect(sheet).not.toHaveAttribute('aria-modal', 'true')
  expect(await unnamedControls(page, [IDS.sheet]), 'sheet controls without role or name').toEqual([])
  await tap(phone, page.getByTestId(IDS.sheetCancel))
  await expect(page.getByTestId(IDS.sheet)).toHaveCount(0)
})

test('N5/a11y-clip-names: timeline clips are options named by clip name, start and length @phone', async ({ phone }) => {
  const { page } = phone
  const timeline = await phone.timeline()
  const first = timeline.clips[0]
  const option = page.getByRole('option', { name: `${first.name}, starts at 0.00 s, ${first.duration.toFixed(2)} s long`, exact: true })
  await expect(option, 'the first clip has no spoken name with start and length').toHaveCount(1)
  await expect(option).toHaveAttribute('aria-selected', 'false')
  const tiles = await phone.clips.count()
  expect(tiles).toBeGreaterThan(1)
  await expect(page.getByRole('option', { name: /, starts at \d.* s, \d.* s long$/ })).toHaveCount(tiles)
  await expect(page.getByTestId(IDS.timelineSurface)).toHaveAccessibleName(/Timeline/)
})

test('N5/a11y-keyboard-sheet: Tab reaches the toolbar in screen order, Enter opens a sheet, Tab stays inside the sheet and its docked transport, Escape closes and focus returns @phone', async ({ phone }) => {
  const { page } = phone
  // Start where a keyboard user starts: on the first control of the screen.
  await page.getByTestId('phone-topbar-projects').focus()
  const regionsSeen: string[] = [IDS.topBar]
  let reached = false
  for (let press = 0; press < 90 && !reached; press++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate((ids) => {
      const active = document.activeElement as HTMLElement | null
      const region = ids.find(id => active?.closest(`[data-testid="${id}"]`))
      return { region: region ?? null, testId: active?.dataset.testid ?? null }
    }, [IDS.topBar, IDS.transport, IDS.timeline, IDS.toolbar])
    if (info.region && regionsSeen.at(-1) !== info.region) regionsSeen.push(info.region)
    reached = info.testId === FORMAT
  }
  expect(reached, `Tab never reached the Format tool (regions seen: ${regionsSeen.join(' > ')})`).toBe(true)
  expect(regionsSeen, 'focus order follows the screen from top to bottom').toEqual([IDS.topBar, IDS.transport, IDS.timeline, IDS.toolbar])

  await page.keyboard.press('Enter')
  await sheetSettled(page)
  const insideSheet = () => page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="phone-sheet"]')))
  // Tab cycles through the docked transport and the sheet (PhoneSheet), nothing else.
  const insideSheetOrTransport = () => page.evaluate((transport) => Boolean(document.activeElement?.closest(`[data-testid="phone-sheet"], [data-testid="${transport}"]`)), IDS.transport)
  expect(await insideSheet(), 'focus did not move into the sheet').toBe(true)
  for (let press = 0; press < 25; press++) {
    await page.keyboard.press(press % 5 === 4 ? 'Shift+Tab' : 'Tab')
    expect(await insideSheetOrTransport(), `Tab ${press + 1} left the sheet and its docked transport`).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(page.getByTestId(IDS.sheet), 'Escape did not close the sheet').toHaveCount(0)
  await expect(page.getByTestId(FORMAT), 'focus did not return to the opener').toBeFocused()
  const ring = await page.getByTestId(FORMAT).evaluate(el => getComputedStyle(el).outlineStyle)
  expect(ring, 'keyboard focus has no visible ring').not.toBe('none')
})

test('N5/a11y-contrast-dark: rendered body text reaches 4.5:1 (greyed 3:1) in the dark phone theme @phone', async ({ phone }) => {
  const { page } = phone
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).not.toBe('light')
  expect(await lowContrastText(page, TEXT_SELECTORS, OPTIONAL_TEXT)).toEqual([])
  await tap(phone, page.getByTestId(FORMAT))
  await sheetSettled(page)
  expect(await lowContrastText(page, SHEET_TEXT_SELECTORS)).toEqual([])
  await tap(phone, page.getByTestId(IDS.sheetCancel))
  await expect(page.getByTestId(IDS.sheet)).toHaveCount(0)
})

test('N5/theme-light: the light editor theme gives the phone light tokens with 4.5:1 body text, and dark comes back @phone', async ({ phone }) => {
  const { page } = phone
  const background = () => page.getByTestId(IDS.toolbar).evaluate(el => getComputedStyle(el).backgroundColor)
  const darkToolbar = await background()
  try {
    await setTheme(phone, 'light')
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
    // The light palette comes from .mobile-skin[data-phone-scheme='light'] (PhoneApp.css), set by phoneColorScheme.ts.
    await expect(page.getByTestId(IDS.root)).toHaveAttribute('data-phone-scheme', 'light')
    await expect.poll(background, 'the toolbar did not turn light').toBe('rgb(247, 248, 250)')
    expect(await page.getByTestId(IDS.root).evaluate(el => getComputedStyle(el).colorScheme)).toBe('light')
    expect(await lowContrastText(page, TEXT_SELECTORS, OPTIONAL_TEXT)).toEqual([])
    await tap(phone, page.getByTestId(FORMAT))
    await sheetSettled(page)
    expect(await lowContrastText(page, SHEET_TEXT_SELECTORS)).toEqual([])
    await tap(phone, page.getByTestId(IDS.sheetCancel))
    await expect(page.getByTestId(IDS.sheet)).toHaveCount(0)
  } finally {
    await setTheme(phone, 'dark')
  }
  await expect.poll(background, 'the dark phone palette did not come back').toBe(darkToolbar)
  await expect(page.getByTestId(IDS.root)).toHaveAttribute('data-phone-scheme', 'dark')
})

test('N5/a11y-hit-targets: primary controls are at least 44x44 CSS px, secondary ones at least 24 px @phone', async ({ phone }) => {
  const { page } = phone
  const measure = async (locators: Locator[], min: number) => {
    const small: string[] = []
    for (const control of locators) {
      if (!await control.isVisible()) continue
      const box = await control.boundingBox()
      if (box && (box.width < min - 0.5 || box.height < min - 0.5)) small.push(`${await control.getAttribute('data-testid') ?? await control.getAttribute('aria-label')} ${Math.round(box.width)}x${Math.round(box.height)}`)
    }
    return small
  }
  const primary = [
    ...await page.getByTestId(IDS.topBar).locator('.phone-top-bar__row button').all(),
    ...await page.getByTestId(IDS.transport).getByRole('button').all(),
    ...await phone.toolbar.getByRole('button').all(),
  ]
  expect(primary.length).toBeGreaterThan(8)
  expect(await measure(primary, 44), 'primary touch targets under 44 px').toEqual([])
  const secondary = await page.getByTestId(IDS.topBar).locator('.phone-comp-strip button').all()
  expect(await measure(secondary, 24), 'secondary touch targets under 24 px').toEqual([])
  await tap(phone, page.getByTestId(FORMAT))
  await sheetSettled(page)
  expect(await measure([page.getByTestId(IDS.sheetCancel), page.getByTestId(IDS.sheetDone)], 44), 'sheet header actions under 44 px').toEqual([])
  await tap(phone, page.getByTestId(IDS.sheetCancel))
  await expect(page.getByTestId(IDS.sheet)).toHaveCount(0)
})

test('N5/a11y-reduced-motion: the sheet rises with motion, and without it under prefers-reduced-motion @phone', async ({ phone }) => {
  const { page } = phone
  const animationOf = () => page.getByTestId(IDS.sheet).evaluate(el => getComputedStyle(el).animationName)
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await tap(phone, page.getByTestId(FORMAT))
    await expect(page.getByTestId(IDS.sheet)).toBeVisible()
    expect(await animationOf()).toBe('phone-sheet-rise')
    await tap(phone, page.getByTestId(IDS.sheetCancel))
    await expect(page.getByTestId(IDS.sheet)).toHaveCount(0)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await tap(phone, page.getByTestId(FORMAT))
    await expect(page.getByTestId(IDS.sheet)).toBeVisible()
    expect(await animationOf(), 'the sheet still animates under reduced motion').toBe('none')
    expect(await page.getByTestId(IDS.sheet).evaluate(el => el.getAnimations().length)).toBe(0)
    await tap(phone, page.getByTestId(IDS.sheetCancel))
    await expect(page.getByTestId(IDS.sheet)).toHaveCount(0)
  } finally {
    await page.emulateMedia({ reducedMotion: null })
  }
})
