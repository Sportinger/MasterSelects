import type { Page, WebSocketRoute } from '@playwright/test'
import { PHONE_ASSISTANT_TEST_IDS as AS } from '../../../src/components/mobileSkin/assistant/phoneAssistantTestIds'
import { expect, tapOn, type M1Session } from './m1Fixture'

/**
 * M5 assistant world, without a provider: the real chat runtime of the phone talks to the network it
 * always uses, and these routes answer it.
 * - Account API (`/api/me`, `/api/billing/summary`, `/api/auth/dev-login`, `/api/auth/logout`): a tiny
 *   simulated server with one signed-in flag, flipped by the app's own Dev Quick Login and Sign out.
 * - Codex Direct (`/api/direct-codex/ws`, the WebSocket all three model choices use): a fake app-server
 *   speaking the JSON-RPC the client really handles (initialize, thread/start|resume, turn/start, then
 *   server-to-client `item/tool/call` requests that the browser executes with the REAL editor tools,
 *   message deltas, `turn/completed`; `turn/interrupt` on Stop).
 * Both route once per page and fall back to the real network while no case is active, so other spec
 * files sharing the worker are not affected.
 */

export type FakeToolCall = { tool: string; arguments: Record<string, unknown> }

export interface FakeTurnPlan {
  /** Text streamed before the tool calls. */
  intro?: string
  calls?: FakeToolCall[]
  /** Final answer; omit to leave the turn running until Stop. */
  answer?: string
}

export interface FakeToolResult { tool: string; success: boolean; text: string }

interface AssistantNet {
  active: boolean
  signedIn: boolean
  credits: number
  /** Refuse the Direct socket upgrade (relay or kernel down): the page sees a close without open. */
  refuseSocket: boolean
  /**
   * Model providers this fake server has no configuration for: thread/start and thread/resume with one
   * of them fail the way the production app-server does ("failed to load configuration: Model provider
   * `deepseek` not found").
   */
  unknownModelProviders: string[]
  /** modelProvider (or 'default') of every thread/start and thread/resume, in order. */
  threadProviders: string[]
  /** Plans for the next turns, consumed in order. */
  turns: FakeTurnPlan[]
  connections: number
  prompts: string[]
  interrupts: number
  toolResults: FakeToolResult[]
  /** Every frame both ways (attached to a failing case). */
  frames: string[]
}

const nets = new WeakMap<Page, AssistantNet>()

function meBody(net: AssistantNet) {
  return {
    creditBalance: net.signedIn ? net.credits : 0,
    creditMeterReference: net.signedIn ? net.credits : 0,
    entitlements: {},
    hostedAIEnabled: false,
    plan: net.signedIn ? 'studio' : 'free',
    session: net.signedIn ? { authenticated: true, provider: 'dev' } : { authenticated: false },
    user: net.signedIn ? { id: 'phone-e2e-user', email: 'phone-e2e@masterselects.local' } : null,
  }
}

function serveFakeCodex(ws: WebSocketRoute, net: AssistantNet): void {
  net.connections++
  let serverId = 0
  const waiting = new Map<string, (message: Record<string, unknown>) => void>()
  const send = (message: Record<string, unknown>) => {
    const text = JSON.stringify(message)
    net.frames.push(`server: ${text.slice(0, 300)}`)
    ws.send(text)
  }
  const request = (method: string, params: Record<string, unknown>) => new Promise<Record<string, unknown>>((resolve) => {
    const id = `srv-${++serverId}`
    waiting.set(id, resolve)
    send({ id, method, params })
  })
  // A real server's frames arrive as separate network tasks, so the client has applied the turn/start
  // reply (its turn id) before the first turn frame. Frames sent in one Node tick can reach the page
  // in one task; yielding a macrotask between frames restores the network's ordering guarantee.
  const nextTask = () => new Promise<void>((resolve) => setImmediate(resolve))
  const runTurn = async (threadId: string, turnId: string, plan: FakeTurnPlan) => {
    await nextTask()
    const delta = (text: string) => send({ method: 'item/agentMessage/delta', params: { threadId, turnId, delta: text } })
    if (plan.intro) delta(plan.intro)
    await nextTask()
    for (const [index, call] of (plan.calls ?? []).entries()) {
      const reply = await request('item/tool/call', { threadId, turnId, callId: `${turnId}-call-${index + 1}`, tool: call.tool, arguments: call.arguments })
      const result = (reply.result ?? {}) as { success?: boolean; contentItems?: Array<{ text?: string }> }
      net.toolResults.push({ tool: call.tool, success: result.success === true, text: result.contentItems?.[0]?.text ?? '' })
    }
    if (plan.answer === undefined) return
    await nextTask()
    delta(plan.answer)
    await nextTask()
    send({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', text: `${plan.intro ?? ''}${plan.answer}` } } })
    await nextTask()
    send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } })
  }
  ws.onMessage((raw) => {
    net.frames.push(`client: ${String(raw).slice(0, 300)}`)
    const message = JSON.parse(String(raw)) as { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown }
    if (message.method === undefined && message.id !== undefined) {
      waiting.get(String(message.id))?.(message as Record<string, unknown>)
      waiting.delete(String(message.id))
      return
    }
    if (message.id === undefined) return
    const params = message.params ?? {}
    if (message.method === 'thread/start' || message.method === 'thread/resume') {
      const provider = typeof params.modelProvider === 'string' ? params.modelProvider : 'default'
      net.threadProviders.push(provider)
      if (net.unknownModelProviders.includes(provider)) {
        send({ id: message.id, error: { code: -32603, message: `failed to load configuration: Model provider \`${provider}\` not found` } })
        return
      }
    }
    switch (message.method) {
      case 'thread/start':
        send({ id: message.id, result: { thread: { id: `phone-e2e-thread-${net.connections}` } } })
        return
      case 'thread/resume':
        send({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } })
        return
      case 'turn/start': {
        const turnId = `phone-e2e-turn-${net.prompts.length + 1}`
        const input = Array.isArray(params.input) ? params.input as Array<{ text?: string }> : []
        net.prompts.push(input[0]?.text ?? '')
        send({ id: message.id, result: { turn: { id: turnId } } })
        void runTurn(String(params.threadId), turnId, net.turns.shift() ?? { answer: 'Done.' })
        return
      }
      case 'turn/interrupt':
        net.interrupts++
        send({ id: message.id, result: {} })
        return
      default:
        send({ id: message.id, result: {} })
    }
  })
}

/**
 * Installs the routes once per page. Playwright mocks WebSockets through an init script, so the page
 * must load a new document afterwards: the caller reloads (beforeAll), and the M1 fixture reopens the
 * project from the phone home before the first case.
 */
export async function installAssistantNet(page: Page): Promise<boolean> {
  if (nets.has(page)) return false
  {
    const created: AssistantNet = { active: false, signedIn: false, credits: 25, refuseSocket: false, unknownModelProviders: [], threadProviders: [], turns: [], connections: 0, prompts: [], interrupts: 0, toolResults: [], frames: [] }
    nets.set(page, created)
    const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
    await page.route('**/api/me', async (route) => {
      if (!created.active) return route.fallback()
      await route.fulfill(json(meBody(created)))
    })
    await page.route('**/api/billing/summary', async (route) => {
      if (!created.active) return route.fallback()
      if (!created.signedIn) return route.fulfill(json({ error: 'Sign in first.' }, 401))
      await route.fulfill(json({
        creditBalance: created.credits, creditMeterReference: created.credits, entitlements: {}, hostedAIEnabled: false,
        plan: { id: 'studio', label: 'Studio', monthlyCredits: created.credits }, recentCredits: [], stripeCustomerId: null,
        subscription: null,
        usage: { byFeature: [], completedCount: 0, creditCost: 0, failedCount: 0, pendingCount: 0, since: '2026-10-01T00:00:00.000Z' },
        user: { id: 'phone-e2e-user', email: 'phone-e2e@masterselects.local', avatarUrl: null, displayName: 'Phone E2E' },
      }))
    })
    await page.route('**/api/auth/dev-login', async (route) => {
      if (!created.active) return route.fallback()
      created.signedIn = true
      await route.fulfill(json({ ok: true }))
    })
    await page.route('**/api/auth/logout', async (route) => {
      if (!created.active) return route.fallback()
      created.signedIn = false
      await route.fulfill(json({ ok: true }))
    })
    await page.routeWebSocket(/\/api\/direct-codex\/ws/, (ws) => {
      if (!created.active) {
        ws.connectToServer()
        return
      }
      if (created.refuseSocket) {
        created.connections++
        created.frames.push('server: upgrade refused')
        void ws.close()
        return
      }
      serveFakeCodex(ws, created)
    })
  }
  return true
}

/** Starts a case: no turn plans, counters at zero, the simulated account as the last case left it. */
export function startAssistantCase(page: Page): AssistantNet {
  const net = nets.get(page)
  if (!net) throw new Error('installAssistantNet(page) must run (with a reload) before the first assistant case')
  Object.assign(net, { active: true, refuseSocket: false, unknownModelProviders: [], threadProviders: [], turns: [], connections: 0, prompts: [], interrupts: 0, toolResults: [], frames: [] })
  return net
}

/** Ends the case; returns the socket frames of the case for a failure attachment. */
export function endAssistantCase(page: Page): string[] {
  const net = nets.get(page)
  if (!net) return []
  net.active = false
  return net.frames
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

export const assistantRoot = (m1: M1Session) => m1.page.getByTestId(AS.root)
export const accessLine = (m1: M1Session) => m1.page.getByTestId(AS.access)

export async function openAssistant(m1: M1Session): Promise<void> {
  if (!await assistantRoot(m1).isVisible()) await tapOn(m1, m1.page.getByTestId('phone-topbar-assistant'))
  await expect(assistantRoot(m1), 'the assistant sheet did not open').toBeVisible({ timeout: 20_000 })
}

/** Signs in through the app's own dialogs (Sign in → Dev Quick Login → close the account dialog). */
export async function signIn(m1: M1Session, net: AssistantNet): Promise<void> {
  await openAssistant(m1)
  if (await accessLine(m1).getAttribute('data-access-kind') === 'ready' && net.signedIn) return
  if (await accessLine(m1).getAttribute('data-access-kind') !== 'signedOut') await signOut(m1)
  await tapOn(m1, m1.page.getByTestId(AS.accessAction))
  const auth = m1.page.locator('.auth-dialog-signin')
  await expect(auth, 'Sign in did not open the account sign-in dialog').toBeVisible()
  await tapOn(m1, auth.locator('.auth-dialog-dev-plan-btn').first())
  const account = m1.page.locator('.auth-dialog-wide')
  await expect(account, 'the account dialog did not follow the sign-in').toBeVisible()
  await tapOn(m1, account.getByRole('button', { name: 'Close', exact: true }))
  await expect(account).toHaveCount(0)
  await expect(accessLine(m1)).toHaveAttribute('data-access-kind', 'ready')
  expect(net.signedIn).toBe(true)
}

/** Signs out through the account dialog the access line opens. */
export async function signOut(m1: M1Session): Promise<void> {
  await openAssistant(m1)
  if (await accessLine(m1).getAttribute('data-access-kind') === 'signedOut') return
  await tapOn(m1, m1.page.getByTestId(AS.accessAction))
  const account = m1.page.locator('.auth-dialog-wide')
  await expect(account).toBeVisible()
  // The dialog animates in; a tap during that may land beside the button, so tap until it is gone.
  await expect(async () => {
    await tapOn(m1, account.getByRole('button', { name: 'Sign out', exact: true }))
    await expect(account).toHaveCount(0, { timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
  await expect(accessLine(m1)).toHaveAttribute('data-access-kind', 'signedOut')
}

/** Picks a model choice by touch (the fake server answers every choice the same way). */
export async function chooseModel(m1: M1Session, mode: 'standard' | 'direct-medium' | 'direct'): Promise<void> {
  const chip = m1.page.locator(`[data-testid="${AS.model}"][data-mode="${mode}"]`)
  await tapOn(m1, chip)
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
}

/** Types a request and sends it with the Send button. */
export async function sendRequest(m1: M1Session, prompt: string): Promise<void> {
  await m1.page.getByTestId(AS.prompt).fill(prompt)
  const send = m1.page.getByTestId(AS.send)
  await expect(send).toHaveAttribute('aria-disabled', 'false')
  await tapOn(m1, send)
}

export { AS }
