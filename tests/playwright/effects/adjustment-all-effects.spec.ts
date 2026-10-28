import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test as base, expect, type ConsoleMessage, type Locator, type TestInfo } from '@playwright/test'
import sharp from 'sharp'
import type { FramePixels } from '../assertions/frameCodeOracle'
import { ExportDriver } from '../drivers/ExportDriver'
import { openFrameCodeProject, type FrameCodeProject } from '../fixtures/frameCodeProject'

/**
 * Adjustment layers take every effect that can work on the composite below (owner request
 * 2026-10-28: "all of them should"). One shared project: the frame-code clip on Video 1 and an
 * adjustment layer over its full length on a track above. The sweep adds every registry effect to
 * the adjustment layer through the effect picker and judges the preview's real pixels against
 * (a) the plain clip: an admitted effect must change the picture, unless it is identity at its
 *     defaults (then one strength parameter is raised and the case says so);
 * (b) the same effect applied directly on the clip: a pointwise or geometric effect on a full-frame
 *     clip sees the same input, so the two pictures must match closely (the difference is recorded).
 * Effects that cannot run on an adjustment layer must be missing from the picker, refused by the AI
 * tool with their reason and, when one is on the layer anyway (older project), skipped alone with a
 * notice on its card while the rest of the layer renders.
 */
interface Shared extends FrameCodeProject {
  adjustmentId: string
  clipId: string
  plain: FramePixels
  effects: EffectInfo[]
  logs: string[]
}

interface EffectParam { name: string; type: string; default?: unknown; min?: number; max?: number; wraps?: boolean }
interface EffectInfo { id: string; name: string; category: string; params: EffectParam[]; behavior: string; admitted: boolean; reason?: string }
interface ClipEffect { id: string; type?: string; name?: string; params?: Record<string, unknown>; enabled?: boolean }

const run = promisify(execFile)
// The paused frame every case reads; late enough that animated effects are past their first frame.
const PROBE_TIME = 1.5
const PROBE_FRAME = 45

const test = base.extend<object, { shared: Shared }>({
  shared: [async ({ browser }, provide, workerInfo) => {
    const project = await openFrameCodeProject(browser, workerInfo.project.use.baseURL, { composition: 'Adjustment-All-Effects' })
    const { bridge, page, probe } = project
    const logs: string[] = []
    page.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'warning' || message.type() === 'error') logs.push(message.text().slice(0, 400))
    })
    const state = await bridge.toolData<{ videoTracks: Array<{ id: string; clips: Array<{ id: string }> }> }>('getTimelineState')
    const clipId = state.videoTracks[0].clips[0].id
    const track = await bridge.toolData<{ id?: string; trackId?: string }>('createTrack', { type: 'video', name: 'Adjustments' })
    const trackId = track.trackId ?? track.id
    const created = await bridge.toolData<{ clipId: string }>('editMotionAdjustment', { operation: 'create', trackId, startTime: 0, duration: 4 })
    await bridge.toolData('setPlayhead', { time: PROBE_TIME })
    await probe.waitForFrame(PROBE_FRAME, { allowed: () => true, timeoutMs: 15_000 })
    const plain = await probe.capture()
    const listed = await bridge.toolData<{ categories: Array<{ category: string; effects: Array<{ id: string; name: string; params: EffectParam[] }> }> }>('listEffects')
    const classes = await page.evaluate(async () => {
      const module = await import('/src/services/motionDesign/adjustment/adjustmentEffectClassification.ts' as string)
      return (module.listAdjustmentEffectClassifications() as Array<{ effectType: string; behavior: string; admitted: boolean; reason?: string }>)
        .map(entry => ({ ...entry }))
    })
    const byId = new Map(listed.categories.flatMap(group => group.effects.map(effect => [effect.id, { ...effect, category: group.category }])))
    const effects = classes.filter(entry => !entry.effectType.startsWith('audio-')).map(entry => {
      const effect = byId.get(entry.effectType)
      return { id: entry.effectType, name: effect?.name ?? entry.effectType, category: effect?.category ?? '?', params: effect?.params ?? [],
        behavior: entry.behavior, admitted: entry.admitted, reason: entry.reason }
    })
    await provide({ ...project, adjustmentId: created.clipId, clipId, plain, effects, logs })
    await project.context.close()
  }, { scope: 'worker', timeout: 240_000 }],
})

// ---------- pixel measures ----------
function meanDiff(a: FramePixels, b: FramePixels): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY
  let sum = 0
  for (let index = 0; index < a.data.length; index++) sum += Math.abs(a.data[index] - b.data[index])
  return sum / a.data.length
}
/** Share of pixels whose largest channel difference exceeds 24 (a visible change). */
function changedShare(a: FramePixels, b: FramePixels): number {
  if (a.width !== b.width || a.height !== b.height) return 1
  let changed = 0
  for (let index = 0; index < a.data.length; index += 3) {
    const delta = Math.max(Math.abs(a.data[index] - b.data[index]), Math.abs(a.data[index + 1] - b.data[index + 1]), Math.abs(a.data[index + 2] - b.data[index + 2]))
    if (delta > 24) changed++
  }
  return changed / (a.data.length / 3)
}
const round = (value: number, digits = 2) => Number(value.toFixed(digits))

/**
 * Reads the preview until it holds still (two reads in a row within 0.4 mean difference). With
 * `expectChange` it first waits up to `changeMs` for a picture that differs from `from`; a
 * picture that never moves away is returned as unchanged, not as an error.
 */
async function settle(shared: Shared, from: FramePixels, { expectChange = true, changeMs = 2_500, timeoutMs = 8_000 } = {}):
  Promise<{ pixels: FramePixels; stable: boolean; ms: number }> {
  const started = Date.now()
  let previous = await shared.probe.capture()
  while (Date.now() - started < timeoutMs) {
    const current = await shared.probe.capture()
    const still = meanDiff(previous, current) < 0.4
    const moved = meanDiff(from, current) > 0.6
    if (still && (!expectChange || moved || Date.now() - started > changeMs)) return { pixels: current, stable: true, ms: Date.now() - started }
    previous = current
  }
  return { pixels: previous, stable: false, ms: Date.now() - started }
}

// ---------- arrangement through the bridge ----------
async function effectsOf(shared: Shared, clipId: string): Promise<ClipEffect[]> {
  return (await shared.bridge.toolData<{ effects?: ClipEffect[] }>('getClipDetails', { clipId })).effects ?? []
}
async function clearEffects(shared: Shared): Promise<void> {
  // removeEffect, not editMotionAdjustment: the reset must also work when a case left an effect on the
  // layer that the adjustment tool refuses (the sweep judges that tool separately).
  for (const effect of await effectsOf(shared, shared.adjustmentId)) {
    await shared.bridge.toolData('removeEffect', { clipId: shared.adjustmentId, effectId: effect.id })
  }
  for (const effect of await effectsOf(shared, shared.clipId)) {
    await shared.bridge.toolData('removeEffect', { clipId: shared.clipId, effectId: effect.id })
  }
}

/** Reads until the preview shows the plain clip again (mean difference below 1). */
async function backToPlain(shared: Shared, timeoutMs = 6_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) if (meanDiff(await shared.probe.capture(), shared.plain) < 1) return true
  return false
}

/** Every case starts with no effects anywhere and the preview showing the plain clip again. */
async function reset(shared: Shared, testInfo: TestInfo): Promise<void> {
  await clearEffects(shared)
  await shared.bridge.toolData('setPlayhead', { time: PROBE_TIME })
  if (await backToPlain(shared)) return
  testInfo.annotations.push({ type: 'reset-reload', description: 'preview did not return to the plain clip, reloaded' })
  await shared.page.reload({ waitUntil: 'commit' })
  await shared.editor.bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
  await shared.editor.bridge.authenticate()
  await shared.editor.waitForProjectIdle(30_000)
  await shared.bridge.toolData('setPlayhead', { time: PROBE_TIME })
  await shared.probe.waitForFrame(PROBE_FRAME, { allowed: () => true, timeoutMs: 30_000 })
}

// ---------- the effect picker (the action under test) ----------
async function openPicker(shared: Shared): Promise<void> {
  const { page } = shared
  await shared.bridge.toolData('selectClips', { clipIds: [shared.adjustmentId] })
  await page.getByRole('tab', { name: 'Properties' }).click()
  const effectsTab = page.locator('.tab-btn', { hasText: /^Effects/ })
  await effectsTab.click()
  const picker = page.locator('details.effect-catalog-picker')
  if (!await picker.evaluate(node => (node as HTMLDetailsElement).open)) await picker.locator('summary').click()
}

/** A picker tile by its effect name; experimental effects carry " (Experimental)" in the list. */
function pickerTile(picker: Locator, name: string): Locator {
  return picker.locator('.look-tile-apply').and(picker.getByTitle(new RegExp(`^Apply ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\(Experimental\\))?$`)))
}

async function addThroughPicker(shared: Shared, effect: EffectInfo): Promise<boolean> {
  await openPicker(shared)
  const picker = shared.page.locator('details.effect-catalog-picker')
  await picker.getByRole('textbox', { name: 'Search effects' }).fill(effect.name)
  const tile = pickerTile(picker, effect.name)
  if (await tile.count() === 0) return false
  await tile.first().click()
  await expect.poll(async () => (await effectsOf(shared, shared.adjustmentId)).length, { timeout: 5_000 }).toBeGreaterThan(0)
  return true
}

// ---------- strength bump for effects that are identity at their defaults ----------
const STRENGTH = /amount|intensity|strength|mix|exposure|temperature|shift|radius|size|level|angle|distortion|offset|opacity|power|scale|density|blur/i
function bumpedParams(effect: EffectInfo): Record<string, unknown> {
  const numeric = effect.params.filter((param): param is EffectParam & { default: number; min: number; max: number } =>
    param.type === 'number' && typeof param.default === 'number' && param.min !== undefined && param.max !== undefined)
  const params: Record<string, unknown> = {}
  const move = (param: (typeof numeric)[number], direction: 1 | -1) => {
    const span = param.max - param.min, target = param.default + direction * span * 0.35
    params[param.name] = target <= param.max && target >= param.min ? target : param.default - direction * span * 0.35
  }
  // A bright-pass threshold above the test pattern's brightest value (235) hides the effect: lower it.
  for (const param of numeric) if (/threshold/i.test(param.name)) move(param, -1)
  for (const param of numeric) if (STRENGTH.test(param.name)) move(param, 1)
  if (!Object.keys(params).length && numeric[0]) move(numeric[0], 1)
  return params
}

interface Row {
  effect: string
  name: string
  behavior: string
  picker: 'listed' | 'missing' | 'hidden-ok' | 'listed-but-unavailable'
  changesImage?: boolean
  changeVsPlain?: number
  changedShare?: number
  bumped?: Record<string, number>
  matchesDirect?: string
  diffVsDirect?: number
  directVsPlain?: number
  warning?: string
  logs?: string[]
  verdict: string
}

test.describe.configure({ timeout: 90 * 60_000 })

test('the adjustment-layer picker lists every admitted effect and names the unavailable ones @module:effects', async ({ shared }, testInfo) => {
  await reset(shared, testInfo)
  await openPicker(shared)
  const picker = shared.page.locator('details.effect-catalog-picker')
  await picker.getByRole('textbox', { name: 'Search effects' }).fill('')
  const titles = await picker.locator('.look-tile-apply').evaluateAll(nodes => nodes.map(node => node.getAttribute('title')?.replace(/^Apply /, '').replace(/ \(Experimental\)$/, '') ?? ''))
  const admitted = shared.effects.filter(effect => effect.admitted)
  const unavailable = shared.effects.filter(effect => !effect.admitted)
  const missing = admitted.filter(effect => !titles.includes(effect.name)).map(effect => effect.id)
  const leaked = unavailable.filter(effect => titles.includes(effect.name)).map(effect => effect.id)
  const footnote = await picker.locator('.effect-catalog-footnote').innerText().catch(() => '')
  const unnamed = unavailable.filter(effect => !footnote.includes(effect.name)).map(effect => effect.id)
  await testInfo.attach('picker.json', { body: JSON.stringify({ tiles: titles.length, admitted: admitted.length, unavailable: unavailable.map(effect => effect.id), footnote }, null, 1), contentType: 'application/json' })
  await picker.locator('summary').click()
  expect(missing, 'admitted effects missing from the adjustment picker').toEqual([])
  expect(leaked, 'unavailable effects offered on an adjustment layer').toEqual([])
  expect(unnamed, `unavailable effects not named in the footnote "${footnote}"`).toEqual([])
})

test('every registry video effect on an adjustment layer: changes the picture and matches the direct clip effect @module:effects', async ({ shared }, testInfo) => {
  const rows: Row[] = []
  const only = process.env.ADJUSTMENT_SWEEP_ONLY?.split(',').filter(Boolean)
  for (const effect of shared.effects.filter(item => !only || only.includes(item.id))) {
    await reset(shared, testInfo)
    shared.logs.length = 0
    const started = Date.now()
    try {
      rows.push(effect.admitted ? await sweepAdmitted(shared, effect) : await sweepUnavailable(shared, effect))
    } catch (error) {
      rows.push({ effect: effect.id, name: effect.name, behavior: effect.behavior, picker: 'listed', verdict: `ERROR: ${String((error as Error).message ?? error).split('\n')[0].slice(0, 240)}` })
    }
    Object.assign(rows.at(-1)!, { ms: Date.now() - started })
    console.log(`ROW ${JSON.stringify(rows.at(-1))}`)
  }
  await testInfo.attach('adjustment-effects.json', { body: JSON.stringify(rows, null, 1), contentType: 'application/json' })
  const bad = rows.filter(row => !row.verdict.startsWith('ok'))
  expect(bad.map(row => `${row.effect}: ${row.verdict}`), 'effects that do not work as expected on an adjustment layer').toEqual([])
})

async function sweepAdmitted(shared: Shared, effect: EffectInfo): Promise<Row> {
  const row: Row = { effect: effect.id, name: effect.name, behavior: effect.behavior, picker: 'listed', verdict: '' }
  if (!await addThroughPicker(shared, effect)) {
    row.picker = 'missing'
    await shared.bridge.toolData('addEffect', { clipId: shared.adjustmentId, effectType: effect.id })
  }
  let onLayer = await settle(shared, shared.plain)
  let [added] = await effectsOf(shared, shared.adjustmentId)
  if (meanDiff(onLayer.pixels, shared.plain) <= 0.6) {
    const bump = bumpedParams(effect)
    if (Object.keys(bump).length) {
      row.bumped = Object.fromEntries(Object.entries(bump).map(([key, value]) => [key, round(value as number, 3)]))
      await shared.bridge.toolData('updateEffect', { clipId: shared.adjustmentId, effectId: added.id, params: bump })
      onLayer = await settle(shared, shared.plain)
      ;[added] = await effectsOf(shared, shared.adjustmentId)
    }
  }
  const notice = shared.page.getByTestId('motion-adjustment-effect-notice')
  row.warning = (await notice.count()) ? (await notice.allInnerTexts()).join(' | ').slice(0, 300) : undefined
  row.changeVsPlain = round(meanDiff(onLayer.pixels, shared.plain))
  row.changedShare = round(changedShare(onLayer.pixels, shared.plain), 3)
  row.changesImage = row.changeVsPlain > 0.6
  // The same effect, same parameters, directly on the clip. First the preview must be back on the
  // plain clip, or the still-visible adjustment result would pass for the direct one.
  await clearEffects(shared)
  if (!await backToPlain(shared)) throw new Error('the preview did not return to the plain clip after removing the effect from the adjustment layer')
  await shared.bridge.toolData('addEffect', { clipId: shared.clipId, effectType: effect.id, params: added?.params ?? {} })
  const direct = await settle(shared, shared.plain)
  row.diffVsDirect = round(meanDiff(onLayer.pixels, direct.pixels))
  row.directVsPlain = round(meanDiff(direct.pixels, shared.plain))
  const directChanged = row.directVsPlain > 0.6
  row.matchesDirect = row.diffVsDirect <= 2 ? 'yes' : row.diffVsDirect <= 8 ? 'close' : directChanged ? 'differs' : 'differs (direct unchanged)'
  const relevant = shared.logs.filter(line => line.includes(effect.id) || /adjustment/i.test(line))
  if (relevant.length) row.logs = relevant.slice(0, 3)
  if (!onLayer.stable || !direct.stable) row.matchesDirect += ' (animated)'
  row.verdict = !row.changesImage
    ? (directChanged ? 'FAIL: no change on the adjustment layer although the direct effect changes the clip' : 'ok-identity: no visible change at these settings, also not on the clip')
    : row.warning && /bypass/i.test(row.warning) ? `FAIL: admitted effect reported as bypassed: ${row.warning}`
      : row.diffVsDirect > 8 && effect.behavior === 'accumulated-frame' ? 'REVIEW: differs from the direct clip effect'
        : 'ok'
  return row
}

async function sweepUnavailable(shared: Shared, effect: EffectInfo): Promise<Row> {
  const row: Row = { effect: effect.id, name: effect.name, behavior: effect.behavior, picker: 'hidden-ok', verdict: '' }
  await openPicker(shared)
  const picker = shared.page.locator('details.effect-catalog-picker')
  await picker.getByRole('textbox', { name: 'Search effects' }).fill(effect.name)
  if (await pickerTile(picker, effect.name).count()) row.picker = 'listed-but-unavailable'
  await picker.locator('summary').click()
  const refused = await shared.bridge.tool('addEffect', { clipId: shared.adjustmentId, effectType: effect.id })
  const toolMessage = JSON.stringify(refused).slice(0, 400)
  const toolNamesReason = !refused.success && /adjustment layer/i.test(toolMessage)
  // An older project with the effect already on the layer, next to Invert: only it is skipped.
  await shared.page.evaluate(async ({ clipId, type, name }) => {
    const { useTimelineStore } = await import('/src/stores/timeline/index.ts' as string)
    const store = useTimelineStore.getState()
    store.updateClip(clipId, { effects: [
      { id: `legacy-${type}`, name, type, enabled: true, params: {} },
      { id: 'legacy-invert', name: 'Invert', type: 'invert', enabled: true, params: {} },
    ] })
  }, { clipId: shared.adjustmentId, type: effect.id, name: effect.name })
  const shown = await settle(shared, shared.plain)
  // The adjustment tool must still edit a layer that holds such an effect (an agent repairing an older project).
  const repair = await shared.bridge.tool('editMotionAdjustment', { operation: 'configure', clipId: shared.adjustmentId, opacity: 0.99 })
  const repairMessage = repair.success ? '' : String((repair as { error?: string }).error ?? '').slice(0, 200)
  if (repair.success) await shared.bridge.tool('editMotionAdjustment', { operation: 'configure', clipId: shared.adjustmentId, opacity: 1 })
  const inverted = { ...shared.plain, data: Buffer.from(shared.plain.data.map(value => 255 - value)) }
  const diffToInverted = meanDiff(shown.pixels, inverted)
  const notice = shared.page.getByTestId('motion-adjustment-effect-notice')
  await openPicker(shared)
  await shared.page.locator('details.effect-catalog-picker summary').click()
  await expect(notice.first()).toBeVisible({ timeout: 3_000 }).catch(() => undefined)
  row.warning = (await notice.count()) ? (await notice.allInnerTexts()).join(' | ').slice(0, 300) : undefined
  row.changeVsPlain = round(meanDiff(shown.pixels, shared.plain))
  row.matchesDirect = `n/a (rest of layer vs Invert alone: ${round(diffToInverted)})`
  row.changesImage = diffToInverted > 6
  const logged = shared.logs.some(line => line.includes(effect.id) || line.includes(effect.name))
  row.logs = shared.logs.filter(line => line.includes(effect.id) || line.includes(effect.name)).slice(0, 2)
  const problems = [
    row.picker !== 'hidden-ok' && 'offered in the picker',
    !toolNamesReason && `tool did not refuse with a reason: ${toolMessage}`,
    diffToInverted > 6 && `the rest of the layer did not render as Invert alone (diff ${round(diffToInverted)})`,
    !row.warning && 'no notice on the effect card',
    !logged && 'no log line',
    repairMessage && `editMotionAdjustment cannot edit the layer while it holds this effect: ${repairMessage}`,
  ].filter(Boolean)
  row.verdict = problems.length ? `FAIL: ${problems.join('; ')}` : 'ok-refused: hidden, tool refuses with reason, skipped alone with notice and log'
  return row
}

test('a one-second export renders Hue Shift, Mirror and Pixelate on the adjustment layer @module:effects', async ({ shared }, testInfo) => {
  await reset(shared, testInfo)
  const { bridge, page } = shared
  await bridge.toolData('editMotionAdjustment', { operation: 'configure', clipId: shared.adjustmentId, effects: [
    { type: 'hue-shift', parameters: { shift: 0.25 } },
    { type: 'mirror' },
    { type: 'pixelate' },
  ] })
  await bridge.toolData('setPlayhead', { time: 0.5 })
  const preview = await settle(shared, shared.plain)
  await bridge.toolData('setInOutPoints', { inPoint: 0, outPoint: 1 })
  const exporter = new ExportDriver(page)
  await exporter.open()
  await exporter.selectFastWebCodecs()
  await exporter.useCompositionSettings()
  await exporter.useInOutMarkers()
  await exporter.setFilename('adjustment-effects')
  const file = testInfo.outputPath('adjustment-effects.mp4')
  await exporter.exportTo(file)
  await bridge.toolData('setInOutPoints', { inPoint: null, outPoint: null })
  // Frame 15 of the export (0.5 s), scaled to the preview capture size.
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })
  const { data, info } = await sharp(stdout as Buffer).resize(preview.pixels.width, preview.pixels.height, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const exported: FramePixels = { width: info.width, height: info.height, channels: 3, data }
  await clearEffects(shared)
  await bridge.toolData('setPlayhead', { time: 0.5 })
  const plain = await settle(shared, preview.pixels)
  const result = {
    exportVsPreview: round(meanDiff(exported, preview.pixels)),
    exportVsPlain: round(meanDiff(exported, plain.pixels)),
    previewVsPlain: round(meanDiff(preview.pixels, plain.pixels)),
  }
  await testInfo.attach('export.json', { body: JSON.stringify(result, null, 1), contentType: 'application/json' })
  console.log(`EXPORT ${JSON.stringify(result)}`)
  expect(result.previewVsPlain, 'the effects change the preview').toBeGreaterThan(10)
  expect(result.exportVsPlain, 'the exported frame shows the effects, not the plain clip').toBeGreaterThan(result.exportVsPreview * 2)
  expect(result.exportVsPreview, 'the exported frame matches the preview with the effects').toBeLessThan(8)
})
