/**
 * In-page measurement for the inspector latency journey. Everything here runs in the browser:
 * `installLatencyInstrumentation` as an init script (before the editor loads, because the React
 * commit counter must exist before React does), the preview sampler and the store counters through
 * `page.evaluate`. The journey reads only plain numbers back.
 *
 * What is stamped, and why:
 * - pointer input: `pointermove` (capture, window) with the event timestamp;
 * - frames: every animation frame and its paint (a MessageChannel message posted from the frame
 *   callback runs after that frame's paint);
 * - the dragged control: a MutationObserver on its `aria-valuenow`, so a control repaint is the first
 *   paint after the DOM shows the new value;
 * - the preview: three full-width pixel rows of the preview canvas read after every paint (what the
 *   compositor got), matched later against reference rows rendered for known values;
 * - React: committed fibers and the components where each update started (the "roots").
 *
 * The functions are serialised into the page, so they must not use imports or closures.
 */

export interface MoveStamp { ts: number; h: number }
export interface ValueStamp { t: number; v: number }
export interface FrameStamp { raf: number; paint: number; sigIndex: number }
export interface LongTaskStamp { start: number; duration: number }
export interface LatencyCapture {
  t0: number
  t1: number
  release: number
  moves: MoveStamp[]
  values: ValueStamp[]
  pairedValues: ValueStamp[]
  frames: FrameStamp[]
  longtasks: LongTaskStamp[]
  loafBlockingMs: number
  commits: number
  fibers: number[]
  roots: Array<[string, number]>
  sampleCostMs: number
  samples: number
}

/** Init script: frame, input, mutation, long-task and React commit stamps. Idle until `start()`. */
export function installLatencyInstrumentation(): void {
  type Capture = {
    on: boolean; t0: number; t1: number; release: number; moves: Array<{ ts: number; h: number }>
    values: Array<{ t: number; v: number }>; pairedValues: Array<{ t: number; v: number }>
    frames: Array<{ raf: number; paint: number; sigIndex: number }>; pendingRaf: number[]
    longtasks: Array<{ start: number; duration: number }>; loafBlockingMs: number
    commits: number; fibers: number[]; roots: Record<string, number>
    sample: ((t: number) => number) | null; sampleCostMs: number; samples: number
    observers: MutationObserver[]
  }
  const host = window as unknown as { __inspectorLatency?: Capture; __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }
  if (host.__inspectorLatency) return
  // The drag uses the clientX path (pointer lock would freeze the cursor in an automated browser).
  try {
    Element.prototype.requestPointerLock = function () {
      return Promise.reject(new DOMException('pointer lock is disabled for the latency journey', 'NotSupportedError'))
    } as typeof Element.prototype.requestPointerLock
  } catch { /* keep the native API */ }
  const L: Capture = { on: false, t0: 0, t1: 0, release: 0, moves: [], values: [], pairedValues: [], frames: [], pendingRaf: [],
    longtasks: [], loafBlockingMs: 0, commits: 0, fibers: [], roots: {}, sample: null, sampleCostMs: 0, samples: 0, observers: [] }
  host.__inspectorLatency = L

  type Fiber = { tag: number; flags: number; subtreeFlags: number; alternate: Fiber | null; child: Fiber | null; sibling: Fiber | null
    return: Fiber | null; type?: { displayName?: string; name?: string; render?: { displayName?: string; name?: string }; type?: { displayName?: string; name?: string } } }
  const isComponent = (fiber: Fiber | null) => !!fiber && (fiber.tag === 0 || fiber.tag === 1 || fiber.tag === 11 || fiber.tag === 14 || fiber.tag === 15)
  const nameOf = (fiber: Fiber) => fiber.type?.displayName || fiber.type?.name || fiber.type?.render?.displayName || fiber.type?.render?.name
    || fiber.type?.type?.displayName || fiber.type?.type?.name || '?'
  const PERFORMED_WORK = 1
  const hook = {
    renderers: new Map<number, unknown>(), supportsFiber: true, isDisabled: false, nextId: 0,
    inject(renderer: unknown) { const id = ++this.nextId; this.renderers.set(id, renderer); return id },
    checkDCE() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {}, setStrictMode() {},
    onCommitFiberRoot(_id: number, root: { current: Fiber }) {
      if (!L.on) return
      let rendered = 0
      const stack: Array<Fiber | null> = [root.current]
      while (stack.length) {
        const fiber = stack.pop()
        if (!fiber) continue
        if ((fiber.flags & PERFORMED_WORK) && isComponent(fiber)) {
          rendered++
          let parent = fiber.return
          while (parent && !isComponent(parent)) parent = parent.return
          if (!parent || !(parent.flags & PERFORMED_WORK) || parent.alternate === null) {
            const key = parent ? `${nameOf(fiber)} < ${nameOf(parent)}` : nameOf(fiber)
            L.roots[key] = (L.roots[key] ?? 0) + 1
          }
        }
        if (((fiber.flags | fiber.subtreeFlags) & PERFORMED_WORK) || fiber.alternate === null) stack.push(fiber.child)
        stack.push(fiber.sibling)
      }
      L.commits++
      L.fibers.push(rendered)
    },
  }
  try { Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook, configurable: true, writable: true }) } catch { /* already defined */ }

  window.addEventListener('pointermove', event => { if (L.on) L.moves.push({ ts: event.timeStamp, h: performance.now() }) }, { capture: true })
  window.addEventListener('pointerup', () => { if (L.on && !L.release) L.release = performance.now() }, { capture: true })
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    const raf = L.pendingRaf.shift()
    if (!L.on || raf === undefined) return
    const paint = performance.now()
    let sigIndex = -1
    if (L.sample) {
      const started = performance.now()
      sigIndex = L.sample(paint)
      L.sampleCostMs += performance.now() - started
      L.samples++
    }
    L.frames.push({ raf, paint, sigIndex })
  }
  const onFrame = (time: number) => {
    if (L.on) { L.pendingRaf.push(time); channel.port2.postMessage(0) }
    requestAnimationFrame(onFrame)
  }
  requestAnimationFrame(onFrame)
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (L.on) L.longtasks.push({ start: entry.startTime, duration: entry.duration })
    }).observe({ type: 'longtask' })
  } catch { /* no long-task timing */ }
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (L.on) L.loafBlockingMs += (entry as PerformanceEntry & { blockingDuration?: number }).blockingDuration ?? 0
    }).observe({ type: 'long-animation-frame' })
  } catch { /* no LoAF timing */ }
}

/**
 * Starts a capture: watches the dragged control (and its paired field, if any) and turns the
 * preview sampler on. Runs in the page.
 */
export function startCapture({ control, paired }: { control: Element; paired: Element | null }): void {
  const L = (window as unknown as { __inspectorLatency: {
    on: boolean; t0: number; t1: number; release: number; moves: unknown[]; values: Array<{ t: number; v: number }>
    pairedValues: Array<{ t: number; v: number }>; frames: unknown[]; pendingRaf: number[]; longtasks: unknown[]; loafBlockingMs: number
    commits: number; fibers: number[]; roots: Record<string, number>; sampleCostMs: number; samples: number; observers: MutationObserver[]
  } }).__inspectorLatency
  for (const observer of L.observers) observer.disconnect()
  L.observers = []
  const watch = (element: Element, into: Array<{ t: number; v: number }>) => {
    let last = Number(element.getAttribute('aria-valuenow'))
    const observer = new MutationObserver(() => {
      const value = Number(element.getAttribute('aria-valuenow'))
      if (L.on && value !== last) { into.push({ t: performance.now(), v: value }); last = value }
    })
    observer.observe(element, { attributes: true, attributeFilter: ['aria-valuenow'] })
    L.observers.push(observer)
  }
  Object.assign(L, { moves: [], values: [], pairedValues: [], frames: [], pendingRaf: [], longtasks: [], loafBlockingMs: 0,
    commits: 0, fibers: [], roots: {}, sampleCostMs: 0, samples: 0, release: 0 })
  const sampler = (window as unknown as { __previewSampler?: { signatures: unknown[] } }).__previewSampler
  if (sampler) sampler.signatures = []
  watch(control, L.values)
  if (paired) watch(paired, L.pairedValues)
  L.t0 = performance.now()
  L.on = true
}

/** Stops the capture and returns its stamps (signatures stay in the page for matching). */
export function stopCapture(): Omit<LatencyCapture, 'roots'> & { roots: Array<[string, number]> } {
  const L = (window as unknown as { __inspectorLatency: Record<string, unknown> & { on: boolean; t1: number; roots: Record<string, number>; observers: MutationObserver[] } }).__inspectorLatency
  L.on = false
  L.t1 = performance.now()
  for (const observer of L.observers) observer.disconnect()
  const roots = Object.entries(L.roots).toSorted((a, b) => b[1] - a[1]).slice(0, 12)
  const pick = (key: string) => JSON.parse(JSON.stringify(L[key]))
  return { t0: pick('t0'), t1: L.t1, release: pick('release'), moves: pick('moves'), values: pick('values'), pairedValues: pick('pairedValues'),
    frames: pick('frames'), longtasks: pick('longtasks'), loafBlockingMs: pick('loafBlockingMs'), commits: pick('commits'), fibers: pick('fibers'),
    roots, sampleCostMs: pick('sampleCostMs'), samples: pick('samples') }
}

/**
 * Preview sampler and reference matcher. Reads three full-width rows of the preview canvas (code
 * band, colour bars, grey ramp of the frame-code clip) into one signature after every paint. A
 * WebGPU or 2D preview canvas both work through drawImage. Runs in the page.
 */
export function installPreviewSampler(): void {
  type Sampler = { signatures: Uint8ClampedArray[]; references: Array<{ value: number; sig: Uint8ClampedArray }>; width: number
    read(): Uint8ClampedArray | null; describe(): string; canvas(): HTMLCanvasElement | null; distance(a: Uint8ClampedArray, b: Uint8ClampedArray): number
    match(sig: Uint8ClampedArray): { value: number; distance: number } | null }
  const host = window as unknown as { __previewSampler?: Sampler; __inspectorLatency: { sample: ((t: number) => number) | null } }
  const ROWS = [0.09, 0.46, 0.8]
  const scratch = document.createElement('canvas')
  const context = scratch.getContext('2d', { willReadFrequently: true })!
  const sampler: Sampler = {
    signatures: [], references: [], width: 0,
    read() {
      const canvas = this.canvas()
      if (!canvas || !canvas.width || !canvas.height) return null
      const width = Math.min(canvas.width, 960)
      if (scratch.width !== width || scratch.height !== ROWS.length) { scratch.width = width; scratch.height = ROWS.length }
      context.imageSmoothingEnabled = false
      ROWS.forEach((row, index) => context.drawImage(canvas, 0, Math.floor(canvas.height * row), canvas.width, 1, 0, index, width, 1))
      this.width = width
      return context.getImageData(0, 0, width, ROWS.length).data
    },
    /** The visible preview canvas (other panels or skins may keep hidden ones). */
    canvas() {
      let best: HTMLCanvasElement | null = null, bestArea = 0
      for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-testid="preview-canvas"]')) {
        const rect = canvas.getBoundingClientRect()
        if (rect.width * rect.height > bestArea) { best = canvas; bestArea = rect.width * rect.height }
      }
      return best
    },
    describe() {
      const canvas = this.canvas()
      if (!canvas) return 'no preview canvas'
      const sig = this.read()
      let sum = 0
      if (sig) for (let index = 0; index < sig.length; index += 4) sum += sig[index] + sig[index + 1] + sig[index + 2]
      const kind = canvas.getContext('2d') ? '2d' : 'webgpu'
      return `${document.querySelectorAll('[data-testid="preview-canvas"]').length} canvas(es), ${kind} ${canvas.width}x${canvas.height}, row mean ${sig ? Math.round(sum / (sig.length * 0.75)) : 'n/a'}`
    },
    distance(a, b) {
      if (a.length !== b.length) return Number.POSITIVE_INFINITY
      let sum = 0
      for (let index = 0; index < a.length; index += 4) sum += Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2])
      return sum / (a.length * 0.75)
    },
    /** Nearest reference, refined between its two neighbours by projecting onto the segment. */
    match(sig) {
      const refs = this.references
      if (!refs.length) return null
      let best = 0, bestDistance = Number.POSITIVE_INFINITY
      refs.forEach((ref, index) => { const d = this.distance(sig, ref.sig); if (d < bestDistance) { bestDistance = d; best = index } })
      let value = refs[best].value
      const neighbour = [best - 1, best + 1].filter(index => index >= 0 && index < refs.length)
        .map(index => ({ index, d: this.distance(sig, refs[index].sig) })).toSorted((a, b) => a.d - b.d)[0]
      if (neighbour) {
        const a = refs[best].sig, b = refs[neighbour.index].sig
        let dot = 0, norm = 0
        for (let index = 0; index < a.length; index++) { if (index % 4 === 3) continue; const ab = b[index] - a[index]; dot += (sig[index] - a[index]) * ab; norm += ab * ab }
        const t = norm > 0 ? Math.max(0, Math.min(1, dot / norm)) : 0
        value += t * (refs[neighbour.index].value - refs[best].value)
      }
      return { value, distance: bestDistance }
    },
  }
  host.__previewSampler = sampler
  host.__inspectorLatency.sample = () => {
    const sig = sampler.read()
    if (!sig) return -1
    sampler.signatures.push(sig)
    return sampler.signatures.length - 1
  }
}
