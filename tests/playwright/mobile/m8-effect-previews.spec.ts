import type { Locator } from '@playwright/test'
import sharp from 'sharp'
import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_EFFECTS_TEST_IDS as FX } from '../../../src/components/mobileSkin/effects/phoneEffectsTestIds'
import { expect, importViaSheet, seek, settled, tapAction, tapClip, tapOn, test, IDS, type M1Session } from './m1Fixture'

/**
 * M8 effect previews: the Effects and Filters cards show the effect rendered on the picture (the
 * desktop thumbnail runtime), not initials. The truth is the card canvas's real pixels: Invert and
 * Brightness must look clearly different. Brightness is neutral at its default, so its card renders at
 * the fixed preview strength (phoneEffectPreviewParams.ts) and must be brighter than the unprocessed
 * frame (the negative of the Invert card). With nothing at the playhead the cards render on the
 * neutral sample frame. The preview grid must show at least 1.5 rows of cards without scrolling.
 */
test.describe.configure({ timeout: 180_000 })

interface Pixels { width: number; height: number; data: Buffer }

async function cardPixels(card: Locator): Promise<Pixels> {
  const canvas = card.getByTestId(FX.cardPreview).locator('canvas')
  const png = await canvas.screenshot({ animations: 'disabled', scale: 'css', timeout: 5_000 })
  const { data, info } = await sharp(png).removeAlpha().resize(64, 36, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

const mean = (pixels: Pixels) => pixels.data.reduce((sum, value) => sum + value, 0) / pixels.data.length
function meanDiff(a: Pixels, b: Pixels): number {
  let sum = 0
  for (let index = 0; index < a.data.length; index++) sum += Math.abs(a.data[index] - b.data[index])
  return sum / a.data.length
}
/** Mean of the negative of `a` (Invert's negative is the unprocessed frame). */
const negativeMean = (a: Pixels) => 255 - mean(a)

/**
 * Rows of preview cards visible inside the open sheet before any scrolling: full rows plus the visible
 * fraction of the next one. Measured on the sheet body as the user sees it right after opening.
 */
async function visibleCardRows(m1: M1Session): Promise<number> {
  return m1.sheet.evaluate((sheet) => {
    const body = sheet.querySelector<HTMLElement>('.phone-sheet__body')
    const cards = [...sheet.querySelectorAll<HTMLElement>('.phone-fx__grid > .phone-fx__card')]
    if (!body || cards.length === 0) return 0
    const bottom = Math.min(body.getBoundingClientRect().bottom, window.innerHeight)
    const tops = [...new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top)))].sort((a, b) => a - b)
    const height = cards[0].getBoundingClientRect().height
    let rows = 0
    for (const top of tops) rows += Math.max(0, Math.min(1, (bottom - top) / height))
    return rows
  })
}

async function closeLeftoverNotice(m1: M1Session): Promise<void> {
  const notice = m1.page.getByTestId(IDS.unavailableNotice)
  if (!await notice.isVisible()) return
  await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
  await expect(notice).toBeHidden()
}

/** Searches the Effects sheet for `effectType` and waits until its card shows a rendered picture. */
async function renderedEffectCard(m1: M1Session, effectType: string): Promise<{ card: Locator; pixels: Pixels; state: string }> {
  await m1.page.getByTestId(FX.effectsSearch).fill(effectType)
  const card = m1.sheet.locator(`[data-testid="${FX.effectsCard}"][data-effect-type="${effectType}"]`)
  await card.scrollIntoViewIfNeeded()
  const preview = card.getByTestId(FX.cardPreview)
  await expect(preview, `${effectType} card preview renders`).toHaveAttribute('data-preview-state', /^(ready|unchanged)$/, { timeout: 20_000 })
  await expect(card.locator('.phone-fx__card-badge'), 'no initials badge').toHaveCount(0)
  return { card, pixels: await cardPixels(card), state: (await preview.getAttribute('data-preview-state'))! }
}

test('effect-previews: cards render the effect on the current frame; Invert and Brightness differ visibly @phone', async ({ m1 }) => {
  await closeLeftoverNotice(m1)
  const state = await importViaSheet(m1, { visual: [m1.media.a.path] }, { main: 1, total: 1 })
  await seek(m1, 1)
  await settled(m1)
  await tapClip(m1, state.main[0].id)
  await tapAction(m1, phoneActionTestId('effects'))
  await expect(m1.sheet).toBeVisible()
  await expect(m1.sheet.locator('.phone-fx__grid')).toHaveAttribute('data-preview-source', 'frame')
  await expect.poll(() => visibleCardRows(m1), { message: 'at least 1.5 rows of previews show without scrolling' }).toBeGreaterThanOrEqual(1.5)

  const invert = await renderedEffectCard(m1, 'invert')
  const brightness = await renderedEffectCard(m1, 'brightness')
  expect(invert.state, 'Invert visibly changes the frame').toBe('ready')
  // Brightness is neutral at its default: its card renders at the fixed preview strength instead.
  expect(brightness.state, 'Brightness previews a visible change').toBe('ready')
  await expect(brightness.card.getByTestId(FX.cardPreview)).toHaveAttribute('data-preview-demo', 'true')
  await expect(brightness.card.getByTestId(FX.cardPreview)).not.toContainText('No visible change')
  expect(meanDiff(invert.pixels, brightness.pixels), 'Invert and Brightness cards differ').toBeGreaterThan(40)
  expect(mean(brightness.pixels) - negativeMean(invert.pixels), 'the Brightness card is brighter than the unprocessed frame').toBeGreaterThan(8)
  // Cards stay finger-sized (the search now shows the Brightness card).
  const box = (await brightness.card.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(88)
  expect(box.height).toBeGreaterThanOrEqual(44)
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden()
})

test('effect-previews: with nothing at the playhead cards render on the sample frame; greyed cards keep picture and reason @phone', async ({ m1 }) => {
  await closeLeftoverNotice(m1)
  await tapAction(m1, phoneActionTestId('effects-root'))
  await expect(m1.sheet).toBeVisible()
  await expect(m1.sheet.locator('.phone-fx__grid')).toHaveAttribute('data-preview-source', 'sample')
  // The group chips scroll sideways with an edge fade instead of a hard cut.
  await expect(m1.sheet.locator('.phone-fx__chips')).toHaveAttribute('data-fade-end', 'true')
  await expect.poll(() => visibleCardRows(m1), { message: 'at least 1.5 rows of previews show without scrolling' }).toBeGreaterThanOrEqual(1.5)
  const invert = await renderedEffectCard(m1, 'invert')
  const plain = await renderedEffectCard(m1, 'brightness')
  expect(mean(invert.pixels), 'the sample frame is not black').toBeGreaterThan(20)
  expect(meanDiff(invert.pixels, plain.pixels), 'Invert differs from the plain sample frame').toBeGreaterThan(40)
  // Glow works on an adjustment layer now; Slit Scan (needs a clip's own source video) cannot go
  // there: greyed, but still previewed.
  const glow = await renderedEffectCard(m1, 'glow')
  await expect(glow.card).not.toHaveAttribute('aria-disabled', 'true')
  const slitScan = await renderedEffectCard(m1, 'slit-scan')
  await expect(slitScan.card).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden()
})

test('filter-previews: look cards and None render real pictures, not initials @phone', async ({ m1 }) => {
  await closeLeftoverNotice(m1)
  const state = await importViaSheet(m1, { visual: [m1.media.a.path] }, { main: 1, total: 1 })
  await seek(m1, 1)
  await settled(m1)
  await tapClip(m1, state.main[0].id)
  await tapAction(m1, phoneActionTestId('filters'))
  await expect(m1.sheet).toBeVisible()
  const none = m1.page.getByTestId(FX.filtersNone)
  await expect(none.getByTestId(FX.cardPreview)).toHaveAttribute('data-preview-state', 'ready', { timeout: 20_000 })
  await expect.poll(() => visibleCardRows(m1), { message: 'at least 1.5 rows of filters show without scrolling' }).toBeGreaterThanOrEqual(1.5)
  const first = m1.sheet.getByTestId(FX.filtersCard).first()
  await expect(first.getByTestId(FX.cardPreview)).toHaveAttribute('data-preview-state', /^(ready|unchanged)$/, { timeout: 20_000 })
  await expect(m1.sheet.locator('.phone-fx__card-badge')).toHaveCount(0)
  expect(meanDiff(await cardPixels(first), await cardPixels(none)), 'the first look changes the picture').toBeGreaterThan(3)
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden()
})
