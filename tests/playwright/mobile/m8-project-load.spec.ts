import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { PHONE_M1_TEST_IDS as HOME, PHONE_TEST_IDS as IDS } from '../../../src/components/mobileSkin/contracts'
import { PHONE_PROJECT_TEST_IDS as PROJ } from '../../../src/components/mobileSkin/project/phoneProjectTestIds'
import { warmGpu } from '../fixtures/frameCodeProject'
import { installDeterministicStorage } from './phoneFixture'

/**
 * M8 project load budget of the phone skin on browser storage (no folder picker, as on Android):
 * create an empty project, save it (Back to projects saves and closes), reopen it, and Save As a copy.
 * Every operation reports its phase timings (window.__MS_PROJECT_LOAD__, the same report the
 * project_load_phases analytics event carries); each phase must finish within PHASE_BUDGET_MS here.
 * The owner saw "Reading saved project" stand for about 30 s on a Pixel; the timings name the phase.
 */
test.describe.configure({ mode: 'serial', timeout: 240_000 })

const PHASE_BUDGET_MS = 3_000
const TOTAL_BUDGET_MS = 6_000

interface LoadTiming {
  kind: 'open' | 'create' | 'duplicate' | 'scratch' | 'save'
  outcome: string
  totalMs: number
  phases: Record<string, number>
  storage: string
  /** Time from the end of the lifecycle work to the first painted frame (ready opens only). */
  firstFrameMs?: number
  mainThread: { longTaskMaxMs: number; frameGapMaxMs: number }
}

async function timings(page: Page): Promise<LoadTiming[]> {
  return page.evaluate(() => (globalThis as { __MS_PROJECT_LOAD__?: unknown[] }).__MS_PROJECT_LOAD__ ?? []) as Promise<LoadTiming[]>
}

/** Waits for the next finished report of `kind` after `seen` earlier reports and checks its budget. */
async function expectWithinBudget(page: Page, kind: LoadTiming['kind'], seen: number): Promise<LoadTiming> {
  let report: LoadTiming | undefined
  await expect.poll(async () => {
    report = (await timings(page)).slice(seen).find(entry => entry.kind === kind)
    return report?.outcome ?? null
  }, { timeout: 60_000, message: `the ${kind} reported its phase timings` }).toBe('ready')
  const firstFrame = report!.firstFrameMs === undefined ? '' : `, first frame ${Math.round(report!.firstFrameMs)}`
  const summary = `${kind}: total ${Math.round(report!.totalMs)} ms, ${Object.entries(report!.phases).map(([phase, ms]) => `${phase} ${Math.round(ms)}`).join(', ')}${firstFrame}`
  test.info().annotations.push({ type: 'phase timings', description: summary })
  process.stdout.write(`[m8 phase timings] ${summary}\n`)
  expect(report!.storage, 'the project lives in browser storage').toMatch(/^(opfs|indexeddb)$/)
  for (const [phase, ms] of Object.entries(report!.phases)) expect(ms, `${summary}: phase ${phase}`).toBeLessThan(PHASE_BUDGET_MS)
  expect(report!.totalMs, summary).toBeLessThan(TOTAL_BUDGET_MS)
  if (report!.firstFrameMs !== undefined) expect(report!.firstFrameMs, `${summary}: first frame`).toBeLessThan(PHASE_BUDGET_MS)
  expect(Object.keys(report!), 'the kept report holds no location, handle or path').not.toContain('location')
  return report!
}

async function waitForIdleProgress(page: Page): Promise<void> {
  await expect(page.getByRole('progressbar'), 'the project load progress finished').toHaveCount(0, { timeout: 60_000 })
}

test('M8/project-load-budget: create, save, reopen and Save As an empty project on browser storage stay within budget @phone', async ({ browser }, testInfo) => {
  const use = testInfo.project.use
  if (!use.baseURL || !use.viewport) throw new Error('Phone project with baseURL and viewport required')
  const context = await browser.newContext({ viewport: use.viewport, deviceScaleFactor: use.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: use.userAgent })
  const page = await context.newPage()
  try {
    await warmGpu(page, use.baseURL)
    await installDeterministicStorage(page, randomUUID())
    await page.goto(new URL('/m', use.baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const home = page.getByTestId(HOME.home)
    await expect(home, 'the phone home appears on a fresh /m').toBeVisible({ timeout: 90_000 })

    // Create, tapped right away: a background scratch open still running must not delay it.
    const name = `Load ${randomUUID().slice(0, 6)}`
    let seen = (await timings(page)).length
    const create = page.getByTestId(HOME.createProject)
    if (!await create.isVisible()) await page.getByTestId(HOME.newProject).tap()
    await page.getByTestId(HOME.projectNameInput).fill(name)
    await create.tap()
    await expect(page.getByTestId(IDS.timeline), 'the new project opens in the editor').toBeVisible({ timeout: 60_000 })
    await expectWithinBudget(page, 'create', seen)
    await waitForIdleProgress(page)

    // Save: Back to projects saves the project and closes it.
    seen = (await timings(page)).length
    await page.getByTestId(IDS.projectName).tap()
    await expect(page.getByTestId(PROJ.tools)).toBeVisible()
    await page.getByRole('button', { name: 'Back to projects' }).tap()
    await expect(home, 'back on the phone home').toBeVisible({ timeout: 60_000 })
    await expectWithinBudget(page, 'save', seen)

    // Reopen from the project list.
    seen = (await timings(page)).length
    await page.getByTestId(HOME.projectRow).filter({ hasText: name }).first().tap()
    await expect(page.getByTestId(IDS.timeline), 'the project opens again').toBeVisible({ timeout: 60_000 })
    await expectWithinBudget(page, 'open', seen)
    await waitForIdleProgress(page)

    // Save As (Duplicate) copies the history and opens the copy.
    seen = (await timings(page)).length
    await page.getByTestId(IDS.projectName).tap()
    await expect(page.getByTestId(PROJ.tools)).toBeVisible()
    await page.getByTestId(PROJ.duplicate).tap()
    await page.getByTestId(PROJ.duplicateName).fill(`${name} copy`)
    await page.getByTestId(PROJ.duplicateCreate).tap()
    await expectWithinBudget(page, 'duplicate', seen)
    await expect(page.getByTestId(IDS.projectName), 'editing the copy').toContainText(`${name} copy`, { timeout: 30_000 })
  } finally {
    await context.close()
  }
})
