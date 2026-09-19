import type { Page } from '@playwright/test'
import { origin } from './existingGuards.mjs'

export interface ActionRecord {
  label: string; startedAt: string; durationMs?: number; outcome?: string
  settledAt?: string; completionUnknown?: boolean
}
export async function withinDeadline<T>(label: string, operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([Promise.resolve().then(operation), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error(`${label}: evidence/cleanup deadline; completion unknown`)), timeoutMs)
  })]) } finally { clearTimeout(timer) }
}

/** Node-side deadline includes target checks, transport and application execution. */
export class ActionGate {
  readonly records: ActionRecord[] = []
  private stopped?: string
  private pending = new Set<Promise<void>>()
  private readonly check: () => Promise<void>
  constructor(check: () => Promise<void>) { this.check = check }
  stop(reason: string) { this.stopped ??= reason }
  get reason() { return this.stopped }
  get outstanding() { return this.pending.size }

  async run<T>(label: string, operation: () => Promise<T>, timeoutMs = 15_000): Promise<T> {
    if (this.stopped) throw Error('Existing target stopped: ' + this.stopped)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw Error('Invalid action deadline')
    const started = Date.now()
    const row: ActionRecord = { label, startedAt: new Date(started).toISOString() }
    this.records.push(row)
    let timer: ReturnType<typeof setTimeout> | undefined
    const work = (async () => {
      await this.check()
      if (this.stopped) throw Error('Existing target stopped before action: ' + this.stopped)
      const value = await operation()
      await this.check()
      return value
    })()
    const settled = work.then(() => { row.settledAt = new Date().toISOString() }, () => { row.settledAt = new Date().toISOString() })
    this.pending.add(settled)
    void settled.then(() => this.pending.delete(settled))
    try {
      const value = await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          row.completionUnknown = true
          this.stop(`${label}: deadline exceeded; completion unknown; do not retry`)
          reject(Error(this.stopped))
        }, timeoutMs)
      })])
      row.outcome = 'completed'
      return value
    } catch (error) {
      this.stop(`${label}: ${String(error)}`)
      row.outcome = String(error)
      throw error
    } finally { clearTimeout(timer); row.durationMs = Date.now() - started }
  }

  async settle(timeoutMs = 5_000) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([Promise.all([...this.pending]), new Promise(resolve => { timer = setTimeout(resolve, timeoutMs) })]) }
    finally { clearTimeout(timer) }
    return { outstanding: this.outstanding, stopped: this.stopped, records: this.records }
  }
  async cleanup<T>(label: string, operation: () => Promise<T>, timeoutMs = 5_000): Promise<T> {
    if ((await this.settle(1000)).outstanding) throw Error('Outstanding action requires fenced controller recovery')
    // This path is used only by registry-owned cleanup, never ordinary UI/tool calls.
    const work = (async () => { await this.check(); const result = await operation(); await this.check(); return result })()
    const settled = work.then(() => {}, () => {})
    this.pending.add(settled); void settled.then(() => this.pending.delete(settled))
    return withinDeadline(label, () => work, timeoutMs)
  }
}

const gates = new WeakMap<Page, ActionGate>()
const originals = new WeakMap<object, object>()
export const actionGateFor = (page: Page) => {
  const gate = gates.get(page)
  if (!gate) throw Error('Existing page action boundary missing')
  return gate
}
export const unguardedPage = (page: Page) => (originals.get(page) ?? page) as Page
export const originalObject = <T extends object>(object: T): T => (originals.get(object) ?? object) as T
export async function cleanupOnExistingPage<T>(page: Page, action: (raw: Page) => Promise<T>): Promise<T> {
  const gate = gates.get(page)
  return gate ? gate.cleanup('Registry-owned cleanup', () => action(unguardedPage(page))) : withinDeadline('Registry-owned cleanup', () => action(page), 5000)
}

export async function protectExistingPage(raw: Page, targetId: string, preparing = false) {
  const browserSession = await raw.context().browser()!.newBrowserCDPSession()
  const pageSession = await raw.context().newCDPSession(raw)
  const { frameTree } = await pageSession.send('Page.getFrameTree')
  let loaderId = frameTree.frame.loaderId, expectedUrl = origin + '/editor', navigationIndex = 0
  const check = async () => {
    const [targets, tree] = await Promise.all([browserSession.send('Target.getTargets'), pageSession.send('Page.getFrameTree')])
    const pages = targets.targetInfos.filter(target => target.type === 'page')
    if (pages.length !== 1 || pages[0].targetId !== targetId || pages[0].url !== expectedUrl) throw Error('Existing target changed')
    if (raw.url() !== expectedUrl || tree.frameTree.frame.loaderId !== loaderId) throw Error('Existing document changed')
  }
  const gate = new ActionGate(check)
  await gate.run('adopt target/document', async () => {}, 5_000)
  const proxies = new WeakMap<object, object>()
  const actions = new Set(['click', 'dblclick', 'tap', 'fill', 'clear', 'press', 'pressSequentially', 'type', 'check', 'uncheck',
    'setChecked', 'selectOption', 'setInputFiles', 'dragTo', 'hover', 'focus', 'blur', 'dispatchEvent', 'scrollIntoViewIfNeeded',
    'move', 'down', 'up', 'wheel', 'insertText', 'evaluate', 'evaluateHandle', 'screenshot', 'dispose',
    'setViewportSize', 'bringToFront', 'addInitScript', 'waitForTimeout', 'waitFor'])
  const chains = new Set(['locator', 'getByRole', 'getByLabel', 'getByText', 'getByTestId', 'getByTitle', 'getByPlaceholder',
    'getByAltText', 'first', 'last', 'nth', 'filter', 'and', 'or', 'frameLocator', 'context', 'browser'])
  const forbidden = new Set(['newPage', 'newContext', 'close', 'goto', 'reload', 'goBack', 'goForward'])
  const unwrap = (value: unknown): unknown => {
    if (value && typeof value === 'object') {
      const original = originals.get(value)
      if (original) return original
      if (Array.isArray(value)) return value.map(unwrap)
      if (Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrap(item)]))
    }
    return value
  }
  const wrap = (object: object): object => {
    const found = proxies.get(object)
    if (found) return found
    const proxy = new Proxy(object, { get(target, key) {
      const value = Reflect.get(target, key, target)
      if (key === 'goto' && preparing) return (url: string, options: unknown) => {
        const allowed = ['about:blank', origin + '/editor'][navigationIndex]
        if (target !== raw || url !== allowed) { gate.stop('Unexpected preparation navigation'); throw Error(gate.reason) }
        return gate.run('Declared preparation navigation', async () => {
          const result = await raw.goto(url, options as Parameters<Page['goto']>[1])
          expectedUrl = url; loaderId = (await pageSession.send('Page.getFrameTree')).frameTree.frame.loaderId
          navigationIndex++
          return result
        }, 20_000)
      }
      if (typeof key === 'string' && forbidden.has(key)) return () => { gate.stop('Forbidden retained-target operation: ' + key); throw Error(gate.reason) }
      if (typeof value === 'function') return (...args: unknown[]) => {
        const call = () => Reflect.apply(value, target, args.map(unwrap))
        if (typeof key === 'string' && actions.has(key)) {
          const result = gate.run(`UI ${key}`, async () => call())
          return key === 'evaluateHandle' ? result.then(handle => {
            if (!handle || typeof handle !== 'object') throw Error('Expected browser handle')
            return wrap(handle)
          }) : result
        }
        const result = call()
        return typeof key === 'string' && chains.has(key) && result && typeof result === 'object' ? wrap(result) : result
      }
      if ((key === 'mouse' || key === 'keyboard' || key === 'touchscreen') && value) return wrap(value)
      return value
    } })
    proxies.set(object, proxy); originals.set(proxy, object)
    return proxy
  }
  const page = wrap(raw) as Page
  gates.set(page, gate)
  return { page, gate, get loaderId() { return loaderId }, async finishPreparation() {
    if (!preparing || navigationIndex !== 2 || expectedUrl !== origin + '/editor') throw Error('Incomplete declared preparation')
    await check(); preparing = false
  }, async dispose() {
    const result = await gate.settle()
    let finalTargetError: string | undefined
    try { await withinDeadline('Final target observation', check, 3000) } catch (error) { finalTargetError = String(error) }
    await Promise.allSettled([withinDeadline('Detach page observer', () => pageSession.detach(), 2000), withinDeadline('Detach browser observer', () => browserSession.detach(), 2000)])
    return { ...result, finalTargetError }
  } }
}
