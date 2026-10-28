/**
 * Page-side store counters and preview calibration for the inspector latency journey. Loaded
 * through `page.evaluate` (dynamic imports of the dev server's modules, as other journeys inspect
 * state). The counters only observe: the stage() wrapper returns the original result unchanged.
 *
 * Counters per gesture:
 * - drag samples: calls of updateClipTransform / updateClipEffect / addKeyframe (the store actions
 *   every rAF-coalesced sample reaches through setPropertyValue), with their duration;
 * - TimelineGesturePreview.stage(): accepted (true) and rejected (with the reason it returns);
 * - repository revisions created (distinct revision ids the coordinator reports; system revisions such as
 *   source verification are counted apart, they are not undo steps);
 * - composition-mirror writes (mediaStore `compositions` replaced), split at pointer release.
 */

export interface StoreProbeSnapshot {
  samples: number
  actionMs: number[]
  stageAccepted: number
  stageRejected: number
  rejectReasons: string[]
  revisions: number
  revisionLabels: string[]
  /** Revisions with a system source (e.g. "Verify media source"): not undo steps, not counted in `revisions`. */
  systemRevisions: number
  mirrorWritesDuringDrag: number
  mirrorWritesAfterRelease: number
  revisionId: string | null
}

export interface CalibrationResult {
  references: number
  spacing: number
  displayRange: [number, number]
  storeScale: number
  errors: string[]
}

export interface PreviewFrameMatch { paint: number; changed: boolean; value: number | null; distance: number }

/** Installs the counters once per page. */
export async function installStoreProbe(): Promise<void> {
  type Probe = { reset(): void; snapshot(release: number): StoreProbeSnapshot }
  const host = window as unknown as { __storeProbe?: Probe }
  if (host.__storeProbe) return
  const load = (path: string) => import(/* @vite-ignore */ path)
  const { useTimelineStore } = await load('/src/stores/timeline/index.ts')
  const { useMediaStore } = await load('/src/stores/mediaStore/index.ts')
  const { TimelineGesturePreview } = await load('/src/services/project/repository/transaction/TimelineGesturePreview.ts')
  const runtime = await load('/src/services/project/repository/transaction/editorMutationRuntime.ts')
  const { isSystemRevisionSource } = await load('/src/services/project/repository/transaction/historyNavigationPlan.ts')
  const state = { samples: 0, actionMs: [] as number[], stageAccepted: 0, stageRejected: 0, rejectReasons: [] as string[],
    revisionIds: new Set<string>(), revisionLabels: [] as string[], systemRevisions: 0, mirrorWrites: [] as number[], startRevision: null as string | null }
  const originalStage = TimelineGesturePreview.prototype.stage
  TimelineGesturePreview.prototype.stage = function (...args: unknown[]) {
    const result = originalStage.apply(this, args)
    if (result === true) state.stageAccepted++
    else { state.stageRejected++; if (state.rejectReasons.length < 5) state.rejectReasons.push(String((result as { reason?: string })?.reason ?? result)) }
    return result
  }
  const wrapActions = () => {
    const current = useTimelineStore.getState() as Record<string, unknown>
    for (const key of ['updateClipTransform', 'updateClipEffect', 'addKeyframe']) {
      const action = current[key] as ((...args: unknown[]) => unknown) & { __latencyProbe?: boolean }
      if (typeof action !== 'function' || action.__latencyProbe) continue
      const wrapped = function (this: unknown, ...args: unknown[]) {
        const started = performance.now()
        try { return action.apply(this, args) } finally { state.samples++; state.actionMs.push(performance.now() - started) }
      } as typeof action
      wrapped.__latencyProbe = true
      current[key] = wrapped
    }
  }
  wrapActions()
  useMediaStore.subscribe((next: { compositions: unknown }, previous: { compositions: unknown }) => {
    if (next.compositions !== previous.compositions) state.mirrorWrites.push(performance.now())
  })
  let unsubscribeCoordinator: (() => void) | null = null
  const watchCoordinator = () => {
    unsubscribeCoordinator?.()
    const coordinator = runtime.getEditorRepositorySession()?.coordinator
    unsubscribeCoordinator = coordinator?.subscribe((status: { revisionId: string | null }) => {
      if (status.revisionId && status.revisionId !== state.startRevision && !state.revisionIds.has(status.revisionId)) {
        state.revisionIds.add(status.revisionId)
        // Private map, read for the diagnosis only: which action wrote the revision.
        const local = (coordinator as unknown as { localRevisions?: Map<string, { label?: string; source?: string }> }).localRevisions?.get(status.revisionId)
        // System revisions (source verification, repairs) are not undo steps and may land at any time.
        if (isSystemRevisionSource(local?.source)) state.systemRevisions++
        else state.revisionLabels.push(`${local?.label ?? '?'} (${local?.source ?? '?'})`)
      }
    }) ?? null
    return coordinator
  }
  host.__storeProbe = {
    reset() {
      wrapActions()
      const coordinator = watchCoordinator()
      Object.assign(state, { samples: 0, actionMs: [], stageAccepted: 0, stageRejected: 0, rejectReasons: [], mirrorWrites: [],
        revisionIds: new Set<string>(), revisionLabels: [], systemRevisions: 0, startRevision: coordinator?.getStatus().revisionId ?? null })
    },
    snapshot(release: number) {
      const coordinator = runtime.getEditorRepositorySession()?.coordinator
      return { samples: state.samples, actionMs: [...state.actionMs], stageAccepted: state.stageAccepted, stageRejected: state.stageRejected,
        rejectReasons: [...state.rejectReasons], revisions: state.revisionLabels.length, revisionLabels: [...state.revisionLabels], systemRevisions: state.systemRevisions,
        mirrorWritesDuringDrag: state.mirrorWrites.filter(t => !release || t < release).length,
        mirrorWritesAfterRelease: release ? state.mirrorWrites.filter(t => t >= release).length : 0,
        revisionId: coordinator?.getStatus().revisionId ?? null }
    },
  }
}

/** Reads a property of a clip from the store: `position.x`, `rotation.z` or `effect.<id>.<param>`. Runs in the page. */
export async function readStoreValue({ clipId, property }: { clipId: string; property: string }): Promise<number | null> {
  const { useTimelineStore } = await import(/* @vite-ignore */ '/src/stores/timeline/index.ts' as string)
  const clip = useTimelineStore.getState().clips.find((item: { id: string }) => item.id === clipId)
  if (!clip) return null
  const [head, ...rest] = property.split('.')
  if (head === 'effect') {
    const param = rest.pop()!
    const effect = clip.effects?.find((item: { id: string }) => item.id === rest.join('.'))
    const value = effect?.params?.[param]
    return typeof value === 'number' ? value : null
  }
  const value = clip.transform?.[head]?.[rest[0]]
  return typeof value === 'number' ? value : null
}

/**
 * Renders reference previews for display values across the drag's range: writes each value through
 * the store's setPropertyValue (outside any gesture), waits until the preview changed and holds
 * still, and keeps the preview signature with the value the control then shows. Runs in the page.
 */
export async function calibratePreview({ clipId, property, control, range, count }:
  { clipId: string; property: string; control: Element; range: [number, number]; count: number }): Promise<CalibrationResult> {
  const { useTimelineStore } = await import(/* @vite-ignore */ '/src/stores/timeline/index.ts' as string)
  type Sampler = { references: Array<{ value: number; sig: Uint8ClampedArray }>; read(): Uint8ClampedArray | null
    distance(a: Uint8ClampedArray, b: Uint8ClampedArray): number }
  const sampler = (window as unknown as { __previewSampler: Sampler }).__previewSampler
  const errors: string[] = []
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
  const display = () => Number(control.getAttribute('aria-valuenow'))
  const read = (): number => {
    const clip = useTimelineStore.getState().clips.find((item: { id: string }) => item.id === clipId)
    const [head, ...rest] = property.split('.')
    if (head === 'effect') { const param = rest.pop()!; return clip.effects.find((item: { id: string }) => item.id === rest.join('.')).params[param] }
    return clip.transform[head][rest[0]]
  }
  const write = (value: number) => useTimelineStore.getState().setPropertyValue(clipId, property, value)
  const settle = async () => {
    const before = sampler.read()
    let previous = before, still = 0, changed = false
    for (let index = 0; index < 90; index++) {
      await frame()
      const current = sampler.read()
      if (!current || !previous) { previous = current; continue }
      if (before && sampler.distance(before, current) > 0.5) changed = true
      still = sampler.distance(previous, current) < 0.3 ? still + 1 : 0
      previous = current
      if (still >= 3 && (changed || index >= 12)) return current
    }
    errors.push('preview did not settle')
    return previous
  }
  // The control may show the store value in other units (Position X): measure the scale once.
  const storeStart = read(), displayStart = display()
  write(storeStart + 1)
  await frame(); await frame()
  const storeScale = (display() - displayStart) || 1
  write(storeStart)
  await settle()
  const toStore = (value: number) => storeStart + (value - displayStart) / storeScale
  const references: Array<{ value: number; sig: Uint8ClampedArray }> = []
  for (let index = 0; index < count; index++) {
    const target = range[0] + (range[1] - range[0]) * index / Math.max(1, count - 1)
    write(toStore(target))
    const sig = await settle()
    if (sig) references.push({ value: display(), sig })
  }
  write(storeStart)
  await settle()
  const sorted = references.toSorted((a, b) => a.value - b.value)
  sampler.references = sorted
  const gaps = sorted.slice(1).map((ref, index) => sampler.distance(ref.sig, sorted[index].sig)).toSorted((a, b) => a - b)
  return { references: sorted.length, spacing: gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0, displayRange: range, storeScale, errors }
}

/** Matches every sampled frame of the last capture against the references. Runs in the page. */
export function matchPreviewFrames({ frames, changeThreshold }: { frames: Array<{ paint: number; sigIndex: number }>; changeThreshold: number }): PreviewFrameMatch[] {
  type Sampler = { signatures: Uint8ClampedArray[]; distance(a: Uint8ClampedArray, b: Uint8ClampedArray): number
    match(sig: Uint8ClampedArray): { value: number; distance: number } | null }
  const sampler = (window as unknown as { __previewSampler: Sampler }).__previewSampler
  let previous: Uint8ClampedArray | null = null
  return frames.filter(item => item.sigIndex >= 0).map(item => {
    const sig = sampler.signatures[item.sigIndex]
    // The first sampled frame is the picture before the drag (the baseline), not a change caused by input.
    const changed = previous !== null && sampler.distance(previous, sig) > changeThreshold
    previous = sig
    const match = changed ? sampler.match(sig) : null
    return { paint: item.paint, changed, value: match?.value ?? null, distance: match?.distance ?? 0 }
  })
}
