# Modularization Audit — Multilane Execution Plan

**Source of findings:** `docs/modularization-audit.md`
**Created:** 2026-07-31
**Execution model:** lease-based continuous dispatch, up to 10 concurrent worker lanes + 1 integration lane (L0)
**Orchestrator:** L0 Master Orchestrator — owns gates, leases, shared seams, and refill

---

## Purpose

Convert the nine findings of the modularization audit into an executable packet catalog that a swarm of up to 10 workers can drain in parallel without write collisions, with the orchestrator refilling lanes continuously as packets complete.

The plan is **not** wave-locked. Waves are a fallback mental model only; the real dispatch rule is:

> A packet runs as soon as (a) its dependency gates are satisfied and (b) its write set is disjoint from every in-flight packet's write set.

That is what keeps 10 lanes busy instead of idling at wave barriers.

## Non-Goals

- No behaviour changes. Every packet in this plan is structure-only; if a packet needs a behaviour change to land, it stops and escalates to L0.
- No new features, no dependency upgrades, no formatting sweeps.
- Do **not** split any file merely because it is large. The audit found file size is healthy (median 134 LOC). Splitting is out of scope.
- Do not touch `src/services/render/workerPresentingRenderHostPort.ts`, `workerRenderHostRuntimeHandlers.ts`, or other large dispatch surfaces. They are long for a legitimate reason.

---

## Baseline (measured 2026-07-31)

| Metric | Value |
|---|---:|
| `src/` files / LOC | 3,201 / 606,771 |
| Largest module-init cycle | **260 files** |
| Cycle load cost (any member) | **1,284 modules / 251k LOC** |
| Prod-reachable files / LOC | 2,854 / 563,814 |
| Evidence harnesses in prod | 54 files / 19,963 LOC / 75 KB gzip |
| Genuinely dead files | 52 files / 6,598 LOC |
| Barrel-import edges to rewire | **129 edges across 115 files** |

Every gate below is measured against these numbers by `scripts/check-import-cycles.mjs` (built in packet `MA-000`).

---

## Gate Model

| Gate | Meaning | Closed by |
|---|---|---|
| `MA0_BASELINE_CAPTURED` | Cycle/reachability checker is executable and baseline is recorded | MA-000 |
| `MA0_DEAD_CODE_REMOVED` | 52 unreferenced files deleted; build still green | MA-001 |
| `MA0_STOREREF_AVAILABLE` | `storeRef.ts` exists for the 3 stores and barrels register into it | MA-002 |
| `MA1_CYCLE_COLLAPSED` | Largest init cycle ≤ 12 files | MA-100…MA-109 |
| `MA1_CYCLE_GUARD_ARMED` | `import/no-cycle` is an ESLint **error** with an explicit allowlist | MA-400 |
| `MA2_PROD_SURFACE_CLEAN` | No evidence/golden-fixture module reachable from `src/main.tsx` | MA-200 |
| `MA3_SUBTREES_SELF_CONTAINED` | Zero child→parent type imports in the 5 registered clusters | MA-300…MA-304 |
| `MA4_LAYOUT_NORMALIZED` | Transitions/effects flattened, shims retired, architecture ledgers relocated, `tests/unit/` mirrored | MA-210, 211, 230, 240, 410 |
| `MA5_AUDIT_CLOSED` | Full chain green; audit metrics re-measured and `docs/modularization-audit.md` updated with after-numbers | MA-500 |

---

## Lane Model

| Lane | Role | Concurrency |
|---|---|---|
| **L0 Integration & Gates** | Orchestrator. Owns shared seams, gate evaluation, lease table, refill, conflict adjudication, final chain runs. Never runs a rewire packet itself. | 1, always resident |
| **W1–W10 Workers** | Drain packets from the ready queue. Stateless — a worker is whatever packet it currently holds. | up to 10 |

Workers are **not** bound to a subsystem. A worker that finishes `MA-104` may next receive `MA-301`. Lane identity lives in the *packet*, not the worker.

### L0-only shared seams

These files may **only** be written by L0, never by a worker. A packet that needs one of these declares it and L0 applies the edit at integration time.

```
package.json
eslint.config.js
tsconfig*.json
vite.config.ts
vitest.config.ts
src/architecture/laneWriteManifest.ts
src/architecture/gateRegistry.ts
src/architecture/highConflictOwnership.ts
tests/unit/completeArchitectureRegistry.test.ts
docs/plans/modularization-audit-multilane-execution-plan.md
docs/modularization-audit.md
```

### Registration requirement

`src/stores/timeline/**`, `src/stores/mediaStore/**`, `src/stores/historyStore/**`, `src/components/timeline/**`, `src/components/preview/**`, `src/components/export/**` and `src/services/aiTools/**` are already declared high-conflict in `src/architecture/highConflictOwnership.ts`, enforced by `tests/unit/completeArchitectureRegistry.test.ts`.

**Before any Tier-1 packet dispatches**, L0 must register these lanes in `src/architecture/laneWriteManifest.ts` with their write sets and exit gates, or the architecture test will fail the first worker that touches a store. This is part of `MA-000`.

---

## Orchestration Protocol

### Packet states

```
blocked -> ready -> in-flight -> verifying -> done
                        \-> failed -> ready (retry, max 2) -> escalated
```

### The refill loop (L0 runs this continuously)

```
loop:
  1. for each packet in `blocked`:
       if all dependsOn gates are satisfied -> move to `ready`

  2. while in-flight count < 10 and `ready` is non-empty:
       pick highest-priority packet P from `ready` where
           writeSet(P) ∩ writeSet(Q) = ∅  for every in-flight Q
       if no such P exists -> break        # lease-starved, wait for a completion
       acquire lease(P); dispatch P to a free worker; mark in-flight

  3. on worker completion of P:
       run verify(P)
       if green -> release lease(P); mark done; re-evaluate gates; goto 1 IMMEDIATELY
       if red   -> release lease(P); mark failed with diagnostics; goto 1

  4. if in-flight == 0 and ready == 0 and blocked != 0 -> deadlock; escalate
```

**Refill is event-driven, not wave-driven.** Step 3 jumps straight back to step 1 on every single completion. Never wait for a group of packets to finish before dispatching the next one.

### Priority order for step 2

1. Packets that close a gate other packets depend on (`MA-000`, `MA-002`) — these unblock the queue
2. Packets with the largest write set (dispatch early; they are the hardest to schedule later)
3. Packets on the critical path to `MA1_CYCLE_COLLAPSED`
4. Everything else, lowest file-count first

### Lease rules

- A lease is a set of **glob patterns**. Two packets conflict if any pattern pair overlaps.
- `src/stores/timeline/*.ts` (root only) and `src/stores/timeline/clip/**` are **disjoint** — the root-level glob does not descend. This is what makes MA-100/101/102 concurrent; preserve that distinction exactly.
- A worker that discovers it must edit a file outside its lease **stops and reports**. It does not widen its own lease. L0 either extends the lease (if free) or re-plans the packet.
- Deleting a file requires the lease on that file *and* on every file that imports it.

### Verification tiers

Per the project's standing rule — do not run the full chain after every change.

| When | Command |
|---|---|
| Per packet (worker, mandatory) | `node scripts/check-import-cycles.mjs --assert` + the packet's named targeted test |
| Per gate closure (L0) | `npm run test:unit` |
| Before any commit (L0) | `npm run build` — must be zero errors, no exceptions |
| At `MA5_AUDIT_CLOSED` (L0) | `npm run build && npm run lint && npm run test` |

---

## Packet Catalog

Priority `P0` = unblocks others, `P1` = critical path, `P2` = independent, `P3` = cleanup.

### Tier 0 — Foundation

#### `MA-000` — Cycle checker, baseline, lane registration · **P0**
- **Depends on:** —
- **Write set:** `scripts/check-import-cycles.mjs` (new), `tests/unit/importCycleBudget.test.ts` (new)
- **L0 seam edits:** `package.json` (add `"check:cycles"`), `src/architecture/laneWriteManifest.ts`, `src/architecture/gateRegistry.ts`, `src/architecture/highConflictOwnership.ts`
- **Do:** productionize the audit analyzer. It must resolve `.ts/.tsx/index.ts`, `@/` and `src/` aliases; classify each edge as **static value / type-only / dynamic**; compute SCCs over **static value edges only**; support `--assert` against a budget file and `--json` for reports. Record the baseline (largest SCC 260, prod-reachable 2,854 files). Register the MA lanes in the architecture manifest.
- **Accept:** `node scripts/check-import-cycles.mjs --json` reports `largestCycle: 260`; `--assert` passes at budget 260; lane registration makes `completeArchitectureRegistry.test.ts` green.
- **Verify:** `npx vitest run tests/unit/importCycleBudget.test.ts tests/unit/completeArchitectureRegistry.test.ts`
- **Closes:** `MA0_BASELINE_CAPTURED`

> The checker must count type-only and dynamic edges separately. The first draft of the audit reported a 1,172-file cycle because it did not — the real static figure is 260. A checker that conflates them will produce false alarms and get switched off.

#### `MA-001` — Dead code sweep · **P0**
- **Depends on:** —
- **Write set:** exactly the 52 paths listed in `docs/modularization-audit.md` §S2, notably:
  `src/components/panels/{ClipPropertiesPanel,PropertiesPanel}.tsx`, `src/components/panels/properties/{CameraTab,TranscriptTab}.tsx`, `src/components/panels/properties/synthSections/SynthSlider.tsx`, `src/components/panels/properties/analysisWorkspace/index.ts`, `src/components/panels/{imageCropperUtils.ts,aiChat/useLemonadeHealth.ts}`, `src/components/export/FFmpegExportSection.tsx`, `src/components/timeline/{PickWhip,VerticalScrollbar}.tsx`, `src/components/timeline/hooks/useTrackPropertyCurveEditTransactions.ts`, `src/components/timeline/utils/timelineTrackSectionState.ts`, `src/components/preview/maskUtils.ts`, `src/components/outputManager/SliceList.tsx`, `src/components/common/settings/{Import,Performance,Previews}Settings.tsx`, `src/components/index.ts`, `src/effects/EffectControls.tsx`, `src/engine/analysis/ScopeAnalyzer.ts`, `src/engine/structuralSharing/SnapshotManager.ts`, `src/engine/{index.ts,managers/index.ts,stats/index.ts,render/index.ts}`, `src/engine/gaussian/index.ts`, `src/engine/render/dispatcher/legacyGaussianReference.ts`, `src/services/{audioExtractor.ts,matanyone/index.ts}`, `src/services/aiTools/{definitions,handlers}/gaussian.ts`, `src/services/agentTimeline/{adapters/shotFramingLegacyAdapter.ts,mapping/index.ts,overview/index.ts,query/index.ts,derivations/qualityAudio/index.ts,runtime/persistence/agentTimelineReadSourceResolver.ts}`, `src/services/flashboard/FlashBoardChatResponseMapping.ts`, `src/shims/nodeModule.ts`, `src/stores/mediaStore/mediaIndex.ts`, `src/stores/timeline/{clip/index.ts,clip/addGaussianAvatarClip.ts,clip/upgradeToNativeDecoder.ts,helpers/index.ts}`, `src/utils/fileLoader.ts`
- **Do:** delete. The Gaussian-splat feature is dead across 5 files / ~1,105 LOC — remove it as one unit. **Excluded from this packet:** the 6 legal translations (see `MA-001L`).
- **Do NOT delete:** the 12 `*.worker.ts` files or 14 `__tests__` files that the raw analysis flagged. They are referenced via `new Worker(new URL(...))` and vitest globs respectively. Confirmed false positives.
- **Accept:** `npm run build` green; `check-import-cycles --json` shows `files: 3149`.
- **Verify:** `npm run build`
- **Closes:** `MA0_DEAD_CODE_REMOVED`

> Runs **before** Tier 1 deliberately: four of these dead files sit inside Tier-1 rewire scopes. Deleting first means nobody rewires a file that is about to disappear.

#### `MA-001L` — Legal translations: wire up or delete · **P3 · NEEDS DECISION**
- **Depends on:** product decision, not a gate
- **Write set:** `src/components/common/legal/{chinese,french,japanese,korean,portuguese,spanish}.tsx`, `src/components/common/LegalDialog.tsx`
- **Question for the owner:** `LegalDialog.tsx` imports only `english` and `german`. The other six (507 LOC of translated imprint/privacy/contact text) are unreachable. Wire them into a language switch, or delete them?
- **Default if no answer by `MA5`:** leave in place and re-flag. Do not silently delete legal text.

#### `MA-002` — `storeRef` foundation · **P0**
- **Depends on:** —  (write set is disjoint from `MA-001`, so these two run concurrently)
- **Write set:** `src/stores/timeline/storeRef.ts` (new), `src/stores/mediaStore/storeRef.ts` (new), `src/stores/historyStore/storeRef.ts` (new), `src/stores/timeline/index.ts`, `src/stores/mediaStore/index.ts`, `src/stores/historyStore/index.ts`
- **Do:** for each store, add a module that **imports nothing from its own package**:

  ```ts
  // src/stores/timeline/storeRef.ts
  import type { TimelineStore } from './types';           // type-only: erased, no runtime edge
  type Api = { getState(): TimelineStore; setState: (...a: never[]) => void; subscribe: (...a: never[]) => () => void };
  let store: Api | undefined;
  export const setTimelineStoreRef = (s: Api) => { store = s; };
  export const getTimelineStore = (): Api => {
    if (!store) throw new Error('timeline store read before initialisation');
    return store;
  };
  ```

  Then at the end of `index.ts`, after `create(...)`: `setTimelineStoreRef(useTimelineStore);`
- **Constraint:** `storeRef.ts` may contain **only** type-only imports. A single value import from `./types` or `./index` reintroduces the cycle and voids the entire Tier 1.
- **Accept:** all three modules exist; `check-import-cycles --json` shows `largestCycle: 260` still (unchanged — nothing is rewired yet) and `storeRef` files each have `staticValueDeps: 0`.
- **Verify:** `node scripts/check-import-cycles.mjs --assert-leaf src/stores/timeline/storeRef.ts src/stores/mediaStore/storeRef.ts src/stores/historyStore/storeRef.ts`
- **Closes:** `MA0_STOREREF_AVAILABLE`

#### `MA-002b` — History API off the barrel · **P0**
- **Depends on:** `MA-002`
- **Write set:** `src/stores/historyStore/historyApi.ts` (new), `src/stores/historyStore/index.ts`
- **Context:** 29 of the 129 barrel edges are not the store hook — they are history API functions: `captureSnapshot` (14), `startBatch` (6), `endBatch` (6), `cancelHistoryBatch`, `recordHistoryEvent`, `serializeHistoryStateForProject`. `index.ts:548-557` merely re-exports them from an already dependency-injected facade:
  ```ts
  // src/stores/historyStore/historyFacade.ts — 33 lines, type-only imports
  export function createHistoryFacade(useHistoryStore: HistoryStoreAccessor) { ... }
  ```
- **Do:** add `historyApi.ts` that builds the facade over `getHistoryStore()` from `storeRef` and exports the six named functions. Tier-1 packets then import from `historyApi`, not from the barrel.
- **Note:** `historyFacade.ts` is the reference implementation of this entire refactor — it already takes the store as a parameter instead of importing it. `MA-002` generalizes a pattern this codebase already proved.
- **Accept:** `historyApi.ts` has zero static value imports from `./index`.

---

### Tier 1 — Barrel rewire (10 concurrent packets, disjoint leases)

**All depend on:** `MA0_STOREREF_AVAILABLE` + `MA0_DEAD_CODE_REMOVED`
**All share the same recipe:**

> In every file in the lease that imports `useTimelineStore` / `useMediaStore` / `useHistoryStore` from `../index`, `..`, `../../stores/timeline`, `../../stores/mediaStore` or `../../stores/historyStore`, replace the import with `getTimelineStore()` / `getMediaStore()` / `getHistoryStore()` from the corresponding `storeRef`.
> `useTimelineStore.getState()` becomes `getTimelineStore().getState()`.
> **React components keep the hook import** — a component that calls `useTimelineStore(selector)` as a hook must not be converted. Only non-component, call-time store access moves to `storeRef`.
> Type-only imports (`import type { TimelineClip } from '../types'`) are left untouched — they are already erased.

**All share the same accept/verify:**
- **Accept:** zero static value imports from the three barrels remain inside the lease; no behaviour change.
- **Verify:** `node scripts/check-import-cycles.mjs --assert-scope <lease-glob>` + `npx vitest run <the packet's named tests>`

| Packet | Prio | Files | Write set (lease) |
|---|---|---:|---|
| `MA-100` | P1 | 22 | `src/stores/timeline/*.ts` **(root level only, non-recursive)** |
| `MA-101` | P1 | 9 | `src/stores/timeline/clip/**`, `src/stores/timeline/keyframes/**`, `src/stores/timeline/serialization/**` |
| `MA-102` | P1 | 9 | `src/stores/timeline/editOperations/**`, `src/stores/timeline/audioEdit/**` |
| `MA-103` | P1 | 15 | `src/services/layerBuilder/**` |
| `MA-104` | P1 | 13 | `src/stores/mediaStore/**` |
| `MA-105` | P1 | 12 | `src/engine/render/**` |
| `MA-106` | P1 | 9 | `src/services/timeline/**`, `src/services/mediaRuntime/**`, `src/services/render/**`, `src/engine/managers/**` |
| `MA-107` | P1 | 9 | `src/services/flashboard/**`, `src/services/properties/**`, `src/services/thumbnailRender/**`, `src/stores/dockStore/**`, `src/stores/sliceStore.ts`, `src/stores/renderTargetStore.ts` |
| `MA-108` | P1 | 11 | `src/services/proxyFrame/**`, `src/services/mediaArtifacts/**`, `src/services/project/**`, `src/services/audio/**`, `src/services/transcription/**`, `src/engine/scene/**` |
| `MA-109` | P1 | 6 | `src/services/performanceMonitor.ts`, `src/services/audioAnalyzer.ts`, `src/services/compositionAudioMixer.ts`, `src/services/slotDeckManager.ts`, `src/services/layerPlaybackManager.ts`, `src/services/compositionRenderer.ts` |

Total: **115 files, 129 import edges.** Every lease is disjoint — all ten can be in flight simultaneously.

**Gate `MA1_CYCLE_COLLAPSED`:** all ten done **and** `check-import-cycles --assert` passes at budget 12.
Expected result: largest cycle **260 → 8**. If the number lands above 12, do not lower the budget — dispatch `MA-305` and find the missed edge.

---

### Tier 2 — Independent, dispatchable from t=0

These depend on **nothing** and collide with **nothing** in Tier 0/1. L0 should dispatch them early to keep all 10 lanes saturated while Tier 1 is blocked on `MA-002`.

#### `MA-200` — Gate evidence harnesses to DEV · **P2**
- **Write set:** `src/services/aiTools/**`, `tests/unit/workerFirst*.test.ts`, `tests/unit/motionDesign*Evidence*.test.ts`
- **Do:** the 54 `workerFirst*` / `*GoldenFixture` / `*ShadowParity` / `*Evidence` / `visiblePixelProof` modules are finished-migration QA scaffolding, currently reachable from `src/main.tsx` via `src/services/aiTools/handlers/index.ts` (693 lines, 61 static imports, 33 of them evidence). Move them under `src/services/aiTools/evidence/` and make registration conditional:
  ```ts
  if (import.meta.env.DEV) { /* register evidence handlers */ }
  ```
  Vite then statically eliminates the subtree from the production build. Also covers the 4 `src/services/motionDesign/evidence/*` modules and the single pullers in `engine/render`, `services/kernelClient`, `components/properties`, `services/storyboard`.
- **Keep working in dev.** These are live dev-bridge surfaces (`npm run worker-first:platform:verify` depends on them). Breaking them is a packet failure.
- **Accept:** `check-import-cycles --json --entry src/main.tsx` shows **0** evidence modules reachable; prod-reachable files 2,798, LOC 543,851.
- **Verify:** `npx vitest run tests/unit/workerFirstW5Gates.test.ts tests/unit/motionDesignMd0Evidence.test.ts` + `npm run worker-first:platform:status`
- **Closes:** `MA2_PROD_SURFACE_CLEAN`
- **Expected:** −56 files, −19,963 LOC, −331 KB minified, **−75 KB gzip**. Cycle impact: **zero** — this packet does not help Tier 1 and Tier 1 does not help it.

#### `MA-210` — Flatten `src/transitions/` · **P3**
- **Write set:** `src/transitions/**`
- **Do:** 74 directories each contain exactly one `index.ts` averaging 53 LOC. `git mv src/transitions/wipeLeft/index.ts src/transitions/wipeLeft.ts`, ×74, then fix the imports in `src/transitions/index.ts` and `src/transitions/groups.ts`. Pure mechanical move.
- **Accept:** zero single-file directories under `src/transitions/`; `src/transitions/index.ts` resolves all 74.
- **Verify:** `npx vitest run tests/unit/transitionRegistry.test.ts tests/unit/transition3dDefinitions.test.ts`

#### `MA-211` — Flatten single-file dirs in `src/effects/` · **P3**
- **Write set:** `src/effects/**`
- **Do:** same treatment for `blur/box/`, `blur/gaussian/`, `stylize/*/`, `color/*/`, `distort/*/`, `keying/`, `generate/`, `time/`, `transition/`.
- **Verify:** `npx vitest run tests/unit/effectsRegistry.test.ts tests/unit/audioEffectRegistry.test.ts tests/unit/layerEffectStack.test.ts`

#### `MA-240` — Relocate the timeline architecture ledger · **P3**
- **Write set:** `src/timeline/**`, `src/architecture/timeline/**` (new), `tests/unit/timelineArchitectureRegistry.test.ts`
- **Do:** `src/timeline/` exists solely to hold `architecture/`, which makes the repo appear to have four `timeline` roots (`components/`, `services/`, `stores/`, and this). Move `src/timeline/architecture/` → `src/architecture/timeline/` and delete the empty `src/timeline/`. Neither directory ships (test-only), so this is zero-risk. Additionally, move gate entries already marked `satisfied` out of `exitCriteriaCoverage.ts` (36 KB) into `docs/completed/`.
- **L0 seam edits:** `src/architecture/highConflictOwnership.ts` (the `src/timeline/architecture/**` entry must be repointed)
- **Verify:** `npx vitest run tests/unit/timelineArchitectureRegistry.test.ts tests/unit/completeArchitectureRegistry.test.ts`

---

### Tier 3 — After `MA1_CYCLE_COLLAPSED`

#### `MA-300`…`MA-304` — Child→parent type leaks · **P2 · 5 concurrent packets**

Each moves the shared contract **down** out of the parent into a sibling `types.ts`, so the subdirectory stops depending on the file it was extracted from. `src/services/audio/recording/sessionTypes.ts` already does this correctly — use it as the reference shape.

| Packet | Write set | Leak |
|---|---|---|
| `MA-300` | `src/engine/render/layerCollector/**`, `src/engine/render/LayerCollector.ts` | 6 children import types from `../LayerCollector.ts` |
| `MA-301` | `src/engine/export/clipPreparation/**`, `src/engine/export/ClipPreparation.ts` | 5 children import `ClipPreparationModeResult`, `ExportClipState` from the parent |
| `MA-302` | `src/engine/native3d/passes/meshPass/**`, `src/engine/native3d/passes/MeshPass.ts` | 3 children |
| `MA-303` | `src/stores/mediaStore/slices/**` | 12 action modules import types from `../{composition,fileImport,fileManage}Slice.ts` |
| `MA-304` | `src/services/audio/recording/**`, `src/services/audio/AudioRecordingService.ts` | 10 children, several via `ReturnType<AudioRecordingService['getSnapshot']>` |

- **Accept (each):** zero imports from a child to its parent module; `check-import-cycles --json` reports `typeBackEdges: 0` for that scope.
- **Note:** `MA-300` conflicts with `MA-105`; `MA-303` conflicts with `MA-104`; `MA-304` conflicts with `MA-108`. The lease rule handles this automatically — they simply will not dispatch concurrently.
- **Closes (all five):** `MA3_SUBTREES_SELF_CONTAINED`

#### `MA-305` — Residual engine cycles · **P2**
- **Depends on:** `MA1_CYCLE_COLLAPSED`, `MA-300`
- **Write set:** `src/engine/render/**`, `src/engine/engineCore/**`, `src/engine/WebGPUEngine.ts`, `src/services/render/**`, `src/services/mediaRuntime/runtimePlayback.ts`
- **Do:** two small cycles survive Tier 1 — an 8-file and a 6-file cluster spanning `LayerCollector` ↔ `WebGPUEngine` ↔ `renderHostPort` ↔ `runtimePlayback` ↔ `NestedCompRenderer` ↔ `engineResources`. This is a genuine mutual engine↔host relationship, so it needs a design decision, not a mechanical rewire: extract a `RenderHostContract` that both sides depend on, or apply the same `ref` indirection.
- **Accept:** largest cycle ≤ 2, or an explicit written justification for each survivor recorded in the allowlist consumed by `MA-400`.
- **Escalation:** if the fix requires changing render behaviour, stop and hand to L0. Do not improvise in the render path.

#### `MA-230` — Retire back-compat shims · **P3**
- **Depends on:** `MA1_CYCLE_COLLAPSED`
- **Write set:** `src/services/projectFileService.ts`, `src/services/audioManager.ts`, `src/services/project/index.ts`, plus the ~30 files importing through the shim
- **Do:** `src/services/projectFileService.ts` is a 22-line pure re-export of `./project`, still used by 30 files — a migration that was never finished. Repoint all 30 to `./project` and delete the shim. Same treatment for the deprecated `audioManager` facade.
- **Accept:** zero importers of `services/projectFileService`; file deleted.

#### `MA-400` — Arm the cycle guard · **P1**
- **Depends on:** `MA1_CYCLE_COLLAPSED`
- **L0 seam edits:** `eslint.config.js` (L0-only)
- **Do:**
  ```js
  "import/no-cycle": ["error", { maxDepth: 6, allowUnsafeDynamicCyclicDependency: false }]
  ```
  with an explicit, commented allowlist for whatever `MA-305` justified. Also wire `npm run check:cycles` into CI.
- **Accept:** `npm run lint` green; deliberately adding a test cycle makes it fail.
- **Closes:** `MA1_CYCLE_GUARD_ARMED`

> Dispatch this the moment `MA1_CYCLE_COLLAPSED` closes. The 252 freed files will drift back within weeks if nothing enforces the boundary.

#### `MA-410` — Mirror `tests/unit/` onto `src/` · **P3 · EXCLUSIVE GLOBAL LEASE**
- **Depends on:** every other packet `done`
- **Write set:** `tests/**` — **exclusive**. L0 must hold all lanes idle for this packet.
- **Do:** `tests/unit/` is 757 files flat, while `src/` is 442 organized directories. `tests/unit/audio/` (61 files) is already organized and is the proof the pattern works. Mirror `src/`'s top level: `tests/unit/{stores,services,components,engine,transitions}/`. Pure `git mv` plus relative-import fixes.
- **Why last:** almost every other packet adds or edits a test. Running this at any other time guarantees conflicts.
- **Verify:** `npm run test:unit`

---

### Tier 4 — Close-out

#### `MA-500` — Re-measure and close · **P1**
- **Depends on:** all gates
- **L0 only.**
- **Do:** re-run the audit measurements; update `docs/modularization-audit.md` with an after-column against the baseline table; archive satisfied MA gates to `docs/completed/`; set the `check-import-cycles` budget to the achieved value so it becomes a ratchet.
- **Verify:** `npm run build && npm run lint && npm run test` — all green, zero errors.
- **Closes:** `MA5_AUDIT_CLOSED`

---

## Dispatch Schedule (illustrative)

Showing how 10 lanes stay saturated. This is an *expected* trace, not a script — the orchestrator recomputes from the live lease table.

```
t0   L0 dispatches:  MA-000  MA-001  MA-002  MA-200  MA-210  MA-211  MA-240
     (7 lanes busy; Tier 1 blocked on MA-002; MA-001L awaiting decision)

t1   MA-002 done -> MA0_STOREREF_AVAILABLE
     MA-001 done -> MA0_DEAD_CODE_REMOVED
     -> Tier 1 becomes ready; L0 refills immediately:
     dispatch MA-100 MA-103 MA-104 MA-105 MA-106  (10 lanes busy)

t2   MA-210 done -> refill MA-101
     MA-211 done -> refill MA-102
     MA-240 done -> refill MA-107

t3   MA-105 done -> refill MA-108 ; MA-300 still blocked (needs MA1)
     MA-104 done -> refill MA-109
     MA-106 done -> refill MA-301   (clipPreparation: no Tier-1 lease overlap)

t4   last Tier-1 packet done -> MA1_CYCLE_COLLAPSED
     -> dispatch MA-400 (guard) + MA-300 MA-302 MA-303 MA-304 MA-305 MA-230

t5   all done -> quiesce all lanes -> MA-410 (exclusive) -> MA-500
```

Critical path: `MA-002 → MA-100 → MA1_CYCLE_COLLAPSED → MA-400 → MA-410 → MA-500`.
`MA-100` (22 files) is the longest Tier-1 packet — dispatch it first when Tier 1 unblocks.

---

## Worker Packet Contract

Every worker receives and must honour this:

1. **You own only your write set.** Touching a file outside it fails the packet. Do not widen it yourself — report and stop.
2. **Structure only.** If a packet cannot land without changing behaviour, stop and escalate. Never "fix" logic opportunistically.
3. **No opportunistic file splitting.** File sizes in this repo are healthy. Splitting is explicitly out of scope.
4. **Run your packet-local verify before reporting done.** Do not run `npm run build` or the full suite — that is L0's job at gate boundaries.
5. **Report:** files touched, import edges rewired, `check-import-cycles` before/after for your scope, and anything you had to skip.
6. **If your verify is red twice, stop.** Do not attempt a third fix; escalate with diagnostics.

---

## Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| A `storeRef` gets a value import and silently rebuilds the cycle | medium | `--assert-leaf` check in `MA-002`; `MA-400` guard catches regressions |
| ~~A worker converts a React hook call site and breaks reactivity~~ | **eliminated — measured** | All 115 files in the Tier-1 set are `.ts`; **zero `.tsx` components**. All 240 call sites are `getState()` (214), `setState()` (18), `subscribe()` (8) — **zero hook calls**. The rule stays in the recipe as a guard, but the exposure does not exist in the current file set. |
| History API symbols (`captureSnapshot` ×14, `startBatch`/`endBatch` ×6 each, +3) are imported from the historyStore barrel, not just the store | low | 29 of the 129 edges. `src/stores/historyStore/historyFacade.ts` already exists and is already dependency-injected — callers repoint to a facade instance built on `storeRef`. See `MA-002b`. |
| `MA-200` breaks the dev bridge / worker-first evidence tooling | medium | `worker-first:platform:status` is in the packet's verify |
| Cycle lands above budget 12 after Tier 1 | medium | `MA-305` exists for exactly this; do not lower the budget to make it pass |
| `tests/` reorg collides with in-flight packets | high if mis-scheduled | `MA-410` requires an exclusive global lease and runs last |
| Architecture registry test fails on the first store write | high if skipped | Lane registration is part of `MA-000`, before any Tier-1 dispatch |
| Deleting dead code removes something reached dynamically | low | Workers and `__tests__` already excluded as verified false positives; `npm run build` gates the packet |

---

## Success Criteria

| Metric | Baseline | Target |
|---|---:|---:|
| Largest module-init cycle | 260 files | **≤ 8** |
| Load cost of `layerBuilder/FrameContext.ts` | 1,284 files / 251k LOC | **29 files / 6k LOC** |
| Load cost of `mediaStore/slices/fileManage/timelineClipReload.ts` | 1,284 / 251k | **143 / 29k** |
| Prod-reachable LOC | 563,814 | **≤ 543,851** |
| Bundle (min+gzip) | — | **−75 KB** |
| Dead files | 52 | **0** |
| Child→parent type imports | 14 (+26 related) | **0** |
| Single-file directories | 157 | **≤ 10** |
| `tests/unit/` flat files | 757 | **0** |
| Cycle guard in CI | none | **`import/no-cycle: error`** |
