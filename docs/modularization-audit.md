# Modularization Audit — MasterSelects `src/`

**Date:** 2026-07-31
**Scope:** `src/` (3,201 TS/TSX files, 606,771 LOC), with cross-checks against `tests/`, `functions/`, `workers/`, `scripts/`.
**Method:** Full static import graph built from source. Value imports, `import type`, and dynamic `import()` were resolved and counted **separately**, because they have different runtime consequences. Cycles computed with Tarjan SCC over static value edges only (the edges that actually run at module init).

---

## Verdict

**The modularization is good. It is not over-engineered, and it is not "dumb splitting."**

The headline number that matters: **median file is 134 lines, mean is 190**, and only **12 files exceed 1,000 lines** out of 3,201. For a 600k-LOC video editor with a render engine, an audio engine, an export pipeline, and an AI tool layer, that is a genuinely healthy distribution. Most large codebases this size have dozens of 3,000-line monsters. You have twelve files over 1,000 lines, and the largest is 2,792.

The decomposition is also *semantically* real, not cosmetic. Spot-checking the extracted units (`usePreviewViewGeometry.ts`, the `recording/` split, the `clipPreparation/` split) shows single-purpose modules with explicit typed interfaces — not arbitrary line-count chunking.

**However**, there are four real problems, and one of them is serious. They are not "you split too much." They are all variants of the same root cause: **splitting happened without fixing the dependency direction.** Files were moved apart, but the new pieces kept reaching back to where they came from.

---

## Scorecard

| Dimension | Result | Grade |
|---|---|---|
| File size discipline | median 134 LOC, 12 files >1000 | **A** |
| Directory depth | max 6 levels, 442 dirs, no deep nesting | **A** |
| Decomposition quality (do the pieces make sense?) | single-purpose, typed, coherent | **A−** |
| Dead code | 52 files / 6,598 LOC unreferenced | **B−** |
| Barrel-file hygiene | 215 barrels, several act as cycle hubs | **C** |
| **Dependency direction / cycles** | **one 260-file module-init cycle** | **D** |
| Prod/test-scaffolding separation | 19k LOC of migration harnesses wired into prod registry | **D** |
| Test layout | `tests/unit/` = 757 files, completely flat | **C−** |

---

## Part 1 — What is genuinely working

Stated plainly so the criticism below is read in proportion.

**File size.** The distribution is the strongest signal in the repo:

```
>1000 LOC :   12 files
700-1000  :   39
400-700   :  309
150-400   : 1110   <- the bulk
50-150    : 1083
<50       :  648
```

This is what a deliberately maintained codebase looks like. There is no god-file problem.

**Depth is disciplined.** Maximum nesting is 6 levels, and only 14 files sit that deep (all under `services/aiTools/devBridge/browser/debugActions/`). No `a/b/c/d/e/f/g` archaeology. 442 directories for 3,201 files is roughly 7 files per directory — a good ratio.

**The extracted units are real modules.** Example — `src/components/preview/usePreviewViewGeometry.ts`: a 64-line hook with explicit `UsePreviewViewGeometryOptions` / `PreviewViewGeometry` interfaces, one `useMemo`, no side effects. That is a correct extraction. `Preview.tsx` owning 18 such hooks (4,469 LOC, ~248 LOC average) is idiomatic React decomposition, not fragmentation.

**Cycle-awareness exists.** There are 217 comments referencing circular dependencies and deliberate workarounds (`src/stores/mediaStore/init.ts:3` — "We use a lazy getter to avoid circular dependencies"; `src/services/aiTools/executionState.ts:1` — "separated to avoid circular imports"). The problem below is known to you. It has been *managed*, not *fixed* — but it was not ignored.

**Architecture is enforced by tests.** `src/architecture/gateRegistry.ts` + `tests/unit/completeArchitectureRegistry.test.ts` encode LOC budgets, forbidden names, and import-boundary rules as executable gates. Very few codebases do this at all.

---

## Part 2 — Findings, ranked

### S1 — One 260-file module-initialization cycle

**This is the most serious structural issue in the repo.**

Excluding `import type` (erased at compile time) and dynamic `import()` (deferred, does not run at init), there remains **one strongly-connected component of 260 files** that all mutually depend on each other at module-load time.

Composition of the cycle:

```
 74  src/stores/timeline
 56  src/services/layerBuilder
 20  src/stores/mediaStore
 16  src/engine/render
 12  src/services/timeline
  7  src/services/audio
  4  src/services/mediaRuntime, services/render, engine/engineCore,
     engine/native3d, services/storyboard, stores/dockStore
```

The hubs — the files everyone inside the cycle depends on:

```
 62  src/stores/mediaStore/index.ts
 46  src/stores/timeline/index.ts
 44  src/services/render/renderHostPort.ts
 21  src/stores/historyStore/index.ts
 21  src/services/layerBuilder/FrameContext.ts
```

**The mechanism, in one concrete example:**

```
src/stores/mediaStore/index.ts
  -> src/stores/mediaStore/slices/fileManageSlice.ts
  -> src/stores/mediaStore/slices/fileManage/timelineClipReload.ts
  -> src/stores/mediaStore/index.ts     <-- back to the barrel
```

And the same shape in the timeline store:

```
src/stores/timeline/index.ts
  -> src/stores/timeline/clipSlice.ts
  -> src/stores/timeline/clip/addClipAction.ts
  -> src/services/mediaArtifacts/mediaSourceArtifacts.ts
  -> src/stores/timeline/index.ts
```

This is the defining anti-pattern of the whole audit. `stores/timeline/index.ts` is 449 lines that statically imports **44 slice creators**. A slice was split out into `clip/addClipAction.ts` — correct instinct — but that leaf needs the store, and the only way to get the store is to import the barrel, which imports all 44 slices. So every leaf transitively depends on every other leaf.

**Why it matters, concretely:**

- **Initialization order becomes luck.** In a cycle, one module observes another as partially initialized. This works until an import order shifts — then you get `undefined is not a function` at startup, with a stack trace pointing at innocent code. This is the classic cause of "works in dev, breaks in prod build" and "breaks only after a refactor that touched nothing related."
- **The splitting bought you nothing here.** 260 files that cannot be loaded independently are, from the linker's and the reasoning-reader's point of view, still one module. You paid the cost of 260 files (navigation, imports, review overhead) without getting the benefit (isolation).
- **It cannot be tested in isolation.** Importing any one of those 260 files pulls in all 260.
- **You are already paying for it.** 298 dynamic `import()` call sites exist in the codebase, and several are explicitly documented as cycle workarounds (`stores/timeline/clip/clipAudioIntelligenceActions.ts:161` — "static import from inside the store graph would be circular"). Lazy imports as a cycle patch convert a load-time crash into a harder-to-trace async timing bug.

**The fix (this is the one thing worth real effort):**

Introduce a store-access module that does **not** re-export slices, and have leaves import that instead of the barrel.

```ts
// src/stores/timeline/storeRef.ts  — imports NOTHING from ./
let store: TimelineStoreApi;
export const setTimelineStore = (s: TimelineStoreApi) => { store = s; };
export const getTimelineStore = () => store;
```

Leaves (`clip/addClipAction.ts`, `slices/fileManage/timelineClipReload.ts`, …) import `storeRef`, never `./index`. `index.ts` calls `setTimelineStore` after `create(...)`. This is a mechanical change — the leaves already call `useTimelineStore.getState()`, so it is a find-and-replace plus one wiring line per store. Doing this for `stores/timeline`, `stores/mediaStore`, and `stores/historyStore` alone should collapse the 260-file SCC by the large majority, because those three barrels account for 129 of the in-cycle in-edges.

Then add a guard so it cannot regress:

```jsonc
// eslint.config.js
"import/no-cycle": ["error", { "maxDepth": 6, "allowUnsafeDynamicCyclicDependency": false }]
```

---

### S1 — 19,000 LOC of migration-evidence harnesses wired into the production tool registry

`src/services/aiTools/` contains 190 files / 54,220 LOC. **45 of the 58 top-level files** are migration scaffolding from the completed "worker-first" render migration:

```
workerFirstBakeGoldenFixture.ts        workerFirstBakeShadowParity.ts
workerFirstExportGoldenFixture.ts      workerFirstExportShadowParity.ts
workerFirstNestedCompsGoldenFixture.ts workerFirstNestedCompsShadowParity.ts
workerFirstMultiVideoGoldenFixture.ts  workerFirstMultiVideoShadowParity.ts
workerFirstRamCacheGoldenFixture.ts    workerFirstRamCacheShadowParity.ts
... 11 GoldenFixture/ShadowParity pairs, plus
workerFirstProofHarness.ts, workerFirstW5Gates.ts, workerFirstW5EvidenceSuite.ts,
workerFirstPlatformEvidenceMatrix.ts, motionDesignMd0Evidence.ts, visiblePixelProof.ts
```

Counting the matching files under `devBridge/` and `handlers/`, this is **55 files / 19,989 LOC**.

**52 of those files (19,134 LOC) are statically reachable from `src/main.tsx`.** The puller is `src/services/aiTools/handlers/index.ts` — a 693-line barrel with 61 static imports, of which 33 point directly at evidence harnesses. Because it is a handler *registry* (side-effectful registration), the bundler cannot safely drop them. Grepping the built output confirms partial survival: `GoldenFixture` appears 39 times and `ShadowParity` 45 times in `dist/`.

Some of these are individually large: `motionDesignMd0Evidence.ts` (957 LOC), `devBridge/.../motionDesignMd2Evidence.ts` (882 LOC), `workerFirstRuntimeExportPlaybackSmoke.ts` (827 LOC).

**Why it matters:** this is QA scaffolding for a migration that is finished, living permanently in the shipped application and in the 6.2 MB main chunk.

Note that this is a *bundle and clarity* problem, not a cycle problem — see Part 5. Gating these files changes the init cycle by exactly zero files. The two S1 findings are independent; neither fixes the other.

**The fix:** these are dev-bridge verification surfaces, not product features. Move them to `tests/` or behind a build-time flag, and make `handlers/index.ts` register them conditionally:

```ts
if (import.meta.env.DEV) { /* register evidence handlers */ }
```

Vite will then statically eliminate the whole subtree from production. This is the highest value-per-hour change available: it removes ~19k LOC from the production graph and simultaneously shrinks the cycle.

---

### S2 — Child modules import their parent's types (14 instances)

A recurring pattern where a god file was split into a subdirectory, but the extracted children import type definitions **back from the parent**:

```
src/engine/render/layerCollector/{directVideo,htmlVideo,staticSource,webCodecs,
    htmlVideoFrameCache,webCodecsProviderFrame}Collectors.ts  ->  ../LayerCollector.ts
src/engine/export/clipPreparation/{cleanup,fastMode,mediaElements,
    parallelMode,preciseMode}.ts                              ->  ../ClipPreparation.ts
src/engine/native3d/passes/meshPass/{materials,primitiveGeometry,
    transforms}.ts                                            ->  ../MeshPass.ts
```

Plus 26 further type-only back-edges, notably `src/stores/mediaStore/slices/*/` → `../{composition,fileImport,fileManage}Slice.ts` (12 instances) and `src/services/audio/recording/*` → `../AudioRecordingService.ts` (10 instances, several using `ReturnType<AudioRecordingService['getSnapshot']>`).

**These are harmless at runtime** — `import type` is erased, so they create no initialization cycle. But they mean the split is not complete: the shared contract still lives in the file the children were extracted *from*, so the parent remains the source of truth and the children can never be understood or reused without it.

**The fix:** move the shared types down into a sibling `types.ts` (`layerCollector/types.ts`, `clipPreparation/types.ts`, `recording/sessionTypes.ts` — which already exists and is the right model). Both parent and children then import from the leaf. Cheap, mechanical, and it makes each subdirectory self-contained.

---

### S2 — 52 genuinely dead files (6,598 LOC)

Verified by full-graph reachability, after excluding false positives: 12 worker entrypoints referenced via `new Worker(new URL(...))` and 14 test files discovered by vitest glob. What remains is genuinely unreferenced:

| LOC | File | Note |
|---:|---|---|
| 730 | `src/components/panels/ClipPropertiesPanel.tsx` | superseded panel |
| 535 | `src/services/aiTools/handlers/gaussian.ts` | + `definitions/gaussian.ts` (86), `engine/gaussian/index.ts` (45), `stores/timeline/clip/addGaussianAvatarClip.ts` (86), `engine/render/dispatcher/legacyGaussianReference.ts` (353) |
| 486 | `src/components/export/FFmpegExportSection.tsx` | replaced export path |
| 450 | `src/components/panels/properties/TranscriptTab.tsx` | |
| 387 | `src/components/timeline/hooks/useTrackPropertyCurveEditTransactions.ts` | |
| 334 | `src/services/audioExtractor.ts` | |
| 507 | `legal/{chinese,french,japanese,korean,portuguese,spanish}.tsx` | **written but never wired** — `LegalDialog.tsx` imports only `english` + `german` |
| … | 39 more, incl. 3 unused settings panels and 12 empty/stub barrels | |

Two things stand out. The **Gaussian-splat feature is dead across five files and ~1,105 LOC** — a whole feature branch left in place. And the **six legal translations (507 LOC) were authored but never connected**; either wire them up in `LegalDialog.tsx` or delete them, but leaving translated legal text unreachable in the repo is the worst of both.

`git rm` these. They are 100% safe to delete — nothing imports them, statically or dynamically.

---

### S3 — `tests/unit/` is a flat directory of 757 files

The single sharpest inconsistency in the repo. `src/` is carefully organized into 442 directories, and the tests for it are one flat pile:

```
757  tests/unit          <- flat, no subdirectories
 61  tests/unit/audio    <- the one exception; proof the pattern works
 21  tests/stores/timeline
 12  tests/property
```

Someone did organize `tests/unit/audio/` and stopped. Mirroring `src/`'s top-level structure (`tests/unit/{stores,services,components,engine}/`) is a pure `git mv` operation with no code changes, and it makes "where is the test for this file" answerable instead of a search.

---

### S3 — 74 directories that each contain exactly one small file

`src/transitions/` has 74 subdirectories — `wipeLeft/`, `zoomIn/`, `swirl/`, `paintSplatter/`, … — and **each contains exactly one `index.ts`**, averaging 53 LOC. Content is a small declarative object:

```ts
// src/transitions/wipeLeft/index.ts   (23 lines)
export const wipeLeft: TransitionDefinition = {
  id: 'wipe-left', name: 'Wipe Left', category: 'wipe',
  defaultDuration: 2, minDuration: 0.1, maxDuration: 5.0,
  recipe: [{ kind: 'mask', target: 'incoming', mask: 'wipe', direction: 'left' }],
};
```

The same shape appears in `src/effects/` (`blur/box/`, `blur/gaussian/`, `stylize/*/`). Of 442 directories, **157 hold exactly one file**, and the transitions/effects tree is most of that.

This is the one place the answer to "is this unnecessary?" is **yes** — but it is *cosmetic*, not harmful. `wipeLeft/index.ts` should be `wipeLeft.ts`. It costs a directory node and a longer path per transition and buys nothing, since none of them ever grew a second file. It is also entirely consistent and entirely harmless, so it is worth exactly one `git mv` sweep and zero further thought. Do not prioritize this over the S1 items.

---

### S3 — Duplicated architecture-governance ledgers

`src/architecture/` and `src/timeline/architecture/` are two parallel copies of the same refactor-tracking system — six identically-named files each (`gateRegistry`, `laneWriteManifest`, `adapterDebtLedger`, `retiredPathLedger`, `testMigrationLedger`, `exitCriteriaCoverage`). They are not duplicates in content: one tracks the "complete" refactor, the other the timeline refactor, with parallel type families (`CompleteArchitectureGate` vs `TimelineArchitectureGate`).

`src/timeline/architecture/exitCriteriaCoverage.ts` alone is 36 KB of refactor-phase bookkeeping data expressed as TypeScript.

**Mitigating fact, verified: neither directory is reachable from `src/main.tsx`.** They are consumed only by six test files, so none of this ships. That drops the severity substantially — this is process bookkeeping stored as typed, test-enforced data, which is a defensible (if unusual) choice.

Two observations remain: `src/timeline/` exists *only* to hold this, which is why the repo appears to have four `timeline` roots (`components/`, `services/`, `stores/`, and this one) — moving it to `src/architecture/timeline/` would remove that confusion. And the completed ledgers (many gates marked `satisfied`) are historical records; once a refactor lands, its ledger belongs in `docs/completed/`, not in `src/`.

---

### S3 — Permanent "temporary" back-compat shims

```
src/services/projectFileService.ts   (22 LOC)  "// Backward compatibility shim"
src/services/project/index.ts        (39 LOC)  "// ...for backward compatibility"
src/services/audioManager.ts        (147 LOC)  "// Deprecated audio facade"
```

`projectFileService.ts` is a pure re-export of `./project`, and **30 files still import through it**. The migration it was created to smooth was never completed. Point those 30 imports at `./project` and delete the shim; otherwise both paths stay alive forever and every new file picks one at random.

---

## Part 3 — Things that look alarming but are fine

Worth stating explicitly, because a naive reading of the metrics would flag all of these.

**"1,651 files have exactly one importer — that's 52% of the codebase!"** This is the metric that most "over-modularization detectors" would scream about, and here it is mostly **correct design**. Breaking it down:

- `src/components/preview/Preview.tsx` exclusively owns 18 files — but they average 248 LOC and are single-purpose hooks. Correct.
- `src/components/panels/properties/index.tsx` owns 24 files at ~295 LOC average. Correct.
- `src/stores/timeline/index.ts` owns 34 files at ~300 LOC average. Correct decomposition; the problem there is the *cycle*, not the split.

A file having one consumer is only a smell when the file is also tiny. Only **134 files are both single-consumer and under 25 lines**, and most of those are the transitions/effects barrels already covered. So: no over-fragmentation problem.

**"215 barrel files!"** Only 52 are pure re-export churn, and most are legitimate public interfaces for a module. Barrels are only a problem where they are *cycle hubs* or *eager registries* — which is exactly `stores/timeline/index.ts`, `stores/mediaStore/index.ts`, and `aiTools/handlers/index.ts`, already covered above. The other ~210 are fine.

**"12 files over 1,000 lines!"** For 606k LOC this is excellent. The largest (`workerPresentingRenderHostPort.ts`, 2,792 LOC) is a protocol/message-dispatch surface, which is a legitimate reason for a file to be long and flat — splitting a dispatch table by line count makes it worse, not better. Leave them alone.

**Same filename in many directories** (`contracts.ts` ×6, `payloadAssembly.ts` ×4, `runtime.ts` ×4). This is consistent naming inside a consistent per-domain layout (`services/audio/{beatOnset,frequencyPhase,loudness,spectrogram}/payloadAssembly.ts`). It is a convention, not a collision. Fine.

**Max depth 6.** Fine. Not deep.

---

## Part 4 — Prioritized action list

| # | Action | Effort | Payoff |
|---|---|---|---|
| 1 | Gate the 54 `workerFirst*`/evidence/golden-fixture files behind `import.meta.env.DEV` in `aiTools/handlers/index.ts` | half a day | −56 files / −19,963 LOC from prod graph; −75 KB gzip bundle (measured) |
| 2 | Add `storeRef.ts` to `stores/timeline`, `stores/mediaStore`, `stores/historyStore`; repoint leaf imports off the barrels | 1–2 days | init cycle 260 → 8 files; unit-test load cost −26% to −98% (measured) |
| 3 | `git rm` the 52 dead files (6,598 LOC), incl. the dead Gaussian feature; decide wire-up-or-delete on the 6 legal translations | 1 hour | −6.6k LOC |
| 4 | Enable `import/no-cycle` in `eslint.config.js` | 15 min | prevents regression of #2 — do it right after #2 |
| 5 | Move shared types from parents into `layerCollector/types.ts`, `clipPreparation/types.ts`, `meshPass/types.ts` | half a day | makes 14 subdirectories self-contained |
| 6 | Reorganize `tests/unit/` (757 flat files) to mirror `src/` | 2 hours, pure `git mv` | navigability |
| 7 | Retire the 3 back-compat shims; repoint the 30 `projectFileService` importers | 2 hours | one canonical path per module |
| 8 | Flatten `src/transitions/<name>/index.ts` → `src/transitions/<name>.ts` (74×), same for `effects/` | 1 hour, mechanical | −157 pointless directories |
| 9 | Move `src/timeline/architecture/` → `src/architecture/timeline/`; archive satisfied ledgers to `docs/completed/` | 1 hour | removes the phantom 4th `timeline` root |

**If you only do one thing: #2.** It is the only finding in this audit that can actually cause a production bug, and it is the only one whose payoff compounds — see Part 5 for the measured numbers. #1 is worth doing because it is cheap, not because it is urgent.

---

## Part 5 — Measured payoff of actions #1 and #2

Both changes were **simulated against the real import graph** (edges removed, SCC and reachability recomputed), and the bundle figure was **measured with esbuild**, not estimated.

### Action #1 — gate the evidence harnesses to DEV

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| Prod-reachable files | 2,854 | 2,798 | **−56** |
| Prod-reachable LOC | 563,814 | 543,851 | **−19,963** |
| Source bytes in prod graph | 18.85 MB | 18.15 MB | −717 KB |
| **Bundle, minified** | | | **−331 KB** |
| **Bundle, min+gzip** | | | **−75 KB** |
| Bundle, min+brotli | | | −56 KB |
| Largest init cycle | 260 | 260 | **0** |

The 56 files that leave production: 48 from `services/aiTools`, 4 from `services/motionDesign`, and one each from `engine/render`, `services/kernelClient`, `components/properties`, `services/storyboard`.

**Honest read:** ~75 KB gzip off the initial download is real but not dramatic. The bigger win is conceptual — 20k LOC of finished-migration scaffolding stops being something you have to scroll past, reason about, and keep compiling. **It does not help the cycle at all.** My earlier draft implied it would; the simulation says zero. Do #1 because it is cheap and tidies the product surface, not because it fixes anything structural.

### Action #2 — `storeRef` instead of barrel imports

129 import statements get rewired. Result:

| Metric | Before | After |
|---|---:|---:|
| Largest init cycle | **260 files** | **8 files** |
| Files freed from the cycle | | **252** |
| Remaining cycles | 4 (260, 2, 2, 2) | 5 (8, 6, 2, 2, 2) |

**This is the change that matters.** And the payoff is not abstract — here is what it costs *today* to import a single file, versus after:

| File you want to import | Before | After | Δ |
|---|---:|---:|---:|
| `stores/timeline/clip/addClipAction.ts` | 1,284 files / 251k LOC | 863 files / 169k LOC | −33% |
| `stores/timeline/clipSlice.ts` | 1,284 / 251k | 959 / 187k | −26% |
| `stores/timeline/keyframes/keyframeBasicActions.ts` | 1,284 / 251k | 437 / 94k | −63% |
| `stores/timeline/editOperations/applyTimelineEditOperation.ts` | 1,284 / 251k | 654 / 130k | −48% |
| `stores/mediaStore/slices/fileManage/timelineClipReload.ts` | 1,284 / 251k | 143 / 29k | **−89%** |
| `services/layerBuilder/FrameContext.ts` | 1,284 / 251k | 29 / 6k | **−98%** |

Note the *before* column: it is **identical for every file** — 1,284 modules, 251,000 LOC. That is the cycle in one number. Importing any one of these 260 files loads **40% of the entire codebase**, regardless of how small the file is. `FrameContext.ts` is a context object; today it drags in a quarter-million lines.

### Test-suite impact — measured, and smaller than it looks

An earlier draft of this audit claimed the cycle was "a direct test-suite tax" that would be clearly visible in vitest wall-clock. **That was measured and it is largely wrong.** The corrected finding:

Across all 830 test files, module-LOC executed drops **84.8M → 65.8M (−22.4%)**. But the saving is concentrated in the wrong place:

| Per-file saving | Test files |
|---|---:|
| 0% | **572** |
| 1–25% | 176 |
| 25–50% | 5 |
| 50–75% | 20 |
| >75% | 57 |

**The heaviest tests save nothing.** `capturePanelRegistration.test.tsx` (1,991 modules), `flashboardChatService.test.ts` (1,660), `kernelClient.test.ts` (1,653) all import the store *barrel*, and the barrel legitimately needs its 44 slices before and after. Breaking the cycle removes the back-edges, not the barrel's own closure.

And wall-clock is not proportional to module count anyway. Two 12-file batches, measured twice each:

| Batch | Modules/file | Unique modules | Wall clock |
|---|---:|---:|---:|
| A — storyboard tests | ~1,295 | 1,326 | **4.1s / 4.6s** |
| B — mixed light tests | ~150 | 457 | **10.6s / 12.4s** |

The *light* batch is reproducibly ~2.7× slower. Per-module transform cost varies far more than module count does, and vitest amortizes transforms across files with overlapping graphs.

From a 60-file sample (23.7s wall, extrapolating to ~5.5 min for the suite), the cumulative cost splits: import 70%, jsdom environment 25%, setup 4%, **actual test bodies 1.3%**. The environment cost (~1.9s per file × 830 files) is fixed and untouched by any of this.

**Realistic expectation: ~10% off suite wall-clock (range 5–15%).** Worth having, not a reason to do the work. The reasons to do the work are correctness and the dev loop — see below.

### What #2 does *not* fix

An 8-file and a 6-file cycle remain, entirely inside the render engine:

```
engine/render/{LayerCollector, NestedCompRenderer, layerCollector/webCodecsCollector}
engine/{WebGPUEngine, engineCore/engineResources}
services/render/{renderHostPort, mainFallbackRenderHostPort}
services/mediaRuntime/runtimePlayback
```

This is a genuinely mutual engine↔host relationship, independent of the stores. Two small cycles are tractable and reviewable in a way that one 260-file cycle is not — fix them later, or leave them and let `import/no-cycle` grandfather them in with an explicit allowlist so no *new* ones appear.

### Recommended order

Do **#2 first**, then #1. #2 is the change with structural payoff; #1 is cheap cleanup that can follow at any time. Do action #4 (`import/no-cycle`) immediately after #2, while the graph is clean — otherwise the 252 freed files will slowly drift back.

---

## Closing

The instinct that produced this structure was right, and the execution is above average — the file sizes, the depth discipline, and the quality of individual extracted modules are all genuinely good, and the architecture-gate tests are better than most teams manage.

The gap is that **decomposition was treated as a file-splitting exercise rather than a dependency-direction exercise.** Splitting `X.ts` into `x/a.ts`, `x/b.ts`, `x/c.ts` only pays off if `a`, `b`, `c` stop depending on `X`. In the stores that did not happen — the leaves still reach back through the barrel — so 260 files that look modular are still one unit at load time. Fixing the direction is a mechanical change, not a redesign, and it converts the modularization you already paid for into the isolation you were trying to buy.
