import { FLASHBOARD_CHAT_AGENT_MODE_STORAGE_KEY } from '../../../src/components/panels/flashboard/FlashBoardChatAgentMode'
import { expect, IDS, tapOn, test, type M1Session } from './m1Fixture'
import {
  AS, chooseModel, endAssistantCase, installAssistantNet, openAssistant, sendRequest, signIn, startAssistantCase,
} from './m5AssistantFixture'

/**
 * M5 model choices against a server that lacks one model's provider (production: the Codex app-server
 * has no DeepSeek provider, so Fast fails with "failed to load configuration: Model provider `deepseek`
 * not found"). The fake Direct server answers thread/start for that provider with the same error. What
 * does not work stays visible, greyed, with a reason; never a raw error, never an automatic resend.
 */
test.describe.configure({ timeout: 180_000 })

const FAST_UNAVAILABLE = 'Fast is not available on this server right now. Use Medium or Slow.'

/** Clears the session's greyed choices so the next case (and spec file) starts on a fresh server. */
async function resetModelAvailability(m1: Pick<M1Session, 'page'>): Promise<void> {
  await m1.page.evaluate(async () => {
    const moduleUrl = '/src/components/panels/flashboard/FlashBoardChatAgentAvailability.ts'
    const mod = await import(/* @vite-ignore */ moduleUrl) as { resetFlashBoardChatAgentAvailabilityForTests: () => void }
    mod.resetFlashBoardChatAgentAvailabilityForTests()
  }).catch(() => undefined)
}

test.beforeAll(async ({ world }) => {
  if (await installAssistantNet(world.page)) {
    await world.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
  }
})

test.afterAll(async ({ world }) => {
  // Leave the world as the next spec file expects it: signed out through the app's own account store
  // (the simulated server answers the logout), so no case there inherits this file's account.
  startAssistantCase(world.page)
  await world.page.evaluate(async () => {
    const storeModule = '/src/stores/accountStore.ts'
    const mod = await import(/* @vite-ignore */ storeModule) as { useAccountStore: { getState: () => { logout: () => Promise<void> } } }
    await mod.useAccountStore.getState().logout()
  }).catch(() => undefined)
  endAssistantCase(world.page)
})

test.afterEach(async ({ m1 }, testInfo) => {
  const frames = endAssistantCase(m1.page)
  await resetModelAvailability(m1)
  if (testInfo.status !== testInfo.expectedStatus && frames.length > 0) {
    await testInfo.attach('codex-socket-frames.txt', { body: frames.join('\n'), contentType: 'text/plain' })
  }
})

const chip = (m1: M1Session, mode: string) => m1.page.locator(`[data-testid="${AS.model}"][data-mode="${mode}"]`)
const latestAnswer = (m1: M1Session) => m1.page.locator(`[data-testid="${AS.message}"][data-role="assistant"]`).last()
const storedChoice = (m1: M1Session) => m1.page.evaluate((key) => localStorage.getItem(key), FLASHBOARD_CHAT_AGENT_MODE_STORAGE_KEY)

/** Starts a new conversation and closes the sheet, so later cases and spec files see an empty chat. */
async function closeAssistant(m1: M1Session): Promise<void> {
  if (await m1.page.getByTestId(AS.message).count() > 0) {
    await tapOn(m1, m1.page.getByTestId(AS.newChat))
    await expect(m1.page.getByTestId(AS.message)).toHaveCount(0)
  }
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden()
}

test('assistant-model-unavailable: Fast failing for a missing provider explains itself, greys Fast and switches to Slow without resending @phone', async ({ m1 }) => {
  const net = startAssistantCase(m1.page)
  await signIn(m1, net)
  await chooseModel(m1, 'standard')
  net.unknownModelProviders = ['deepseek']
  await sendRequest(m1, 'Split the selected clip into 4 equal parts.')

  await expect(latestAnswer(m1), 'the failed answer says plainly what to do').toContainText(FAST_UNAVAILABLE, { timeout: 30_000 })
  await expect(latestAnswer(m1), 'never the raw server error').not.toContainText(/Model provider|configuration|Codex Direct failed/i)
  await expect(chip(m1, 'standard'), 'Fast stays visible but greyed').toHaveAttribute('aria-disabled', 'true')
  await expect(chip(m1, 'standard')).toHaveAttribute('data-unavailable', 'true')
  await expect(chip(m1, 'direct'), 'nothing had worked yet, so the choice falls back to Slow').toHaveAttribute('aria-pressed', 'true')
  await expect(m1.page.getByTestId(AS.modelUnavailable), 'the reason is on screen, not only in a tooltip').toHaveText(FAST_UNAVAILABLE)
  expect(await storedChoice(m1), 'a reload must not start on the failing model again').toBe('direct')
  expect(net.threadProviders, 'the failed request was not resent').toEqual(['deepseek'])
  expect(net.prompts, 'no turn ever started on the failing model').toEqual([])

  await tapOn(m1, chip(m1, 'standard'))
  await expect(m1.page.getByTestId(AS.error), 'tapping the greyed choice says why').toHaveText(FAST_UNAVAILABLE)
  await expect(chip(m1, 'direct'), 'and keeps the working choice').toHaveAttribute('aria-pressed', 'true')

  net.turns.push({ answer: 'Done on Slow.' })
  await sendRequest(m1, 'Split the selected clip into 4 equal parts.')
  await expect(latestAnswer(m1)).toContainText('Done on Slow.', { timeout: 30_000 })
  expect(net.threadProviders, 'the new request ran on the default provider').toEqual(['deepseek', 'default'])
  expect(net.prompts).toHaveLength(1)

  await closeAssistant(m1)
  await openAssistant(m1)
  await expect(chip(m1, 'standard'), 'Fast stays greyed for the rest of the session').toHaveAttribute('aria-disabled', 'true')
  await expect(chip(m1, 'direct')).toHaveAttribute('aria-pressed', 'true')
  await closeAssistant(m1)
})

test('assistant-model-fallback: after a Fast failure the choice returns to the last model that worked @phone', async ({ m1 }) => {
  const net = startAssistantCase(m1.page)
  await signIn(m1, net)
  await chooseModel(m1, 'direct-medium')
  net.turns.push({ answer: 'Done on Medium.' })
  await sendRequest(m1, 'Add a video track.')
  await expect(latestAnswer(m1)).toContainText('Done on Medium.', { timeout: 30_000 })

  await chooseModel(m1, 'standard')
  net.unknownModelProviders = ['deepseek']
  await sendRequest(m1, 'Add another video track.')
  await expect(latestAnswer(m1)).toContainText(FAST_UNAVAILABLE, { timeout: 30_000 })
  await expect(chip(m1, 'direct-medium'), 'back on Medium, the last choice that worked').toHaveAttribute('aria-pressed', 'true')
  await expect(chip(m1, 'standard')).toHaveAttribute('aria-disabled', 'true')
  await expect(chip(m1, 'direct-medium')).toHaveAttribute('aria-disabled', 'false')
  expect(await storedChoice(m1)).toBe('direct-medium')
  expect(net.prompts, 'only the Medium request reached a turn').toHaveLength(1)
  expect(net.prompts[0]).toContain('Add a video track.')
  await closeAssistant(m1)
})
