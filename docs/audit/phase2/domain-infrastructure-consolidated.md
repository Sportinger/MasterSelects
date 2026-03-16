# Domain 6: Infrastructure & Config - Consolidated Findings

## Verified Metrics (resolved from both reviewers)

| Metric | Reviewer A | Reviewer B | Actual (verified) | Notes |
|--------|-----------|-----------|-------------------|-------|
| APP_VERSION | 1.3.5 | 1.3.5 | **1.3.5** | Both agree, confirmed from `src/version.ts` |
| TypeScript files | 486 | 486 | **486** | Consensus |
| Total LOC (TS/TSX) | 123,613 | 123,613 | **123,616** | Minor rounding; both essentially correct |
| WGSL core shaders | 1,303 | 1,303 | **1,303** | Consensus (`src/shaders/*.wgsl`) |
| WGSL effect shaders | 1,108 | 1,108 | **1,108** | Consensus (`src/effects/**/*.wgsl`) |
| WGSL total | 2,411 | 2,411 | **2,411** | Consensus |
| Production deps | 13 | 13 | **13** | Consensus |
| Dev deps | 19 | 19 | **19** | Consensus |
| npm scripts | 11 | 11 | **11** | Consensus |
| GPU effects | 30 | 30 | **30** | Consensus |
| **AI tools** | **80** | **76** | **76** | **Reviewer B correct.** Reviewer A counted 80 `name:` fields but 4 are nested parameter names inside schemas (masks.ts x2, media.ts x2). Actual tool definitions = 76. |
| **Google Fonts** | **57** | **50** | **50** | **Reviewer B correct.** `POPULAR_FONTS` array has exactly 50 entries. Comment says "Top 50 most popular Google Fonts." Reviewer A likely read the README.md claim (57) instead of the actual code. |
| Panel types | 17 | 17 | **17** | Consensus; verified from `PanelType` union in `src/types/dock.ts` |
| Timeline store slices | 17 | 17 | **17** | Consensus; verified via glob `src/stores/timeline/*Slice*.ts` |
| MediaStore slices | 9 | 9 | **9** | Consensus; verified via glob `src/stores/mediaStore/slices/*.ts` |
| Test files | 44 | 44 | **44** | Consensus |
| Test count | 1,717 | 1,717 | **1,717** | Consensus |
| output.wgsl lines | 83 | 83 | **83** | Consensus |
| package.json version | _(not noted)_ | 1.0.0 | **1.0.0** | Reviewer B unique finding; confirmed stale vs 1.3.5 in version.ts |

---

## Consensus (both reviewers found)

| # | Finding | Severity | Effort | Affected Doc(s) |
|---|---------|----------|--------|-----------------|
| C1 | **Version badge stale in README.md**: shows 1.3.4, actual is 1.3.5 | CRITICAL | SMALL | README.md |
| C2 | **Version header severely stale in docs/Features/README.md**: says 1.2.11, actual is 1.3.5 | CRITICAL | SMALL | docs/Features/README.md |
| C3 | **Version header stale in FEATURES.md**: says 1.2.11, actual is 1.3.5 | CRITICAL | SMALL | docs/Features/FEATURES.md |
| C4 | **TypeScript LOC massively understated in README.md**: claims ~60k, actual is ~124k | CRITICAL | SMALL | README.md |
| C5 | **AI tool count wrong in docs/Features/README.md**: says 33, actual is 76 (3 locations) | CRITICAL | SMALL | docs/Features/README.md |
| C6 | **AI tool count wrong in FEATURES.md**: says 33, actual is 76 | CRITICAL | SMALL | docs/Features/FEATURES.md |
| C7 | **WGSL line count understated in README.md**: says "2,200+", actual is 2,411 (3 locations) | HIGH | SMALL | README.md |
| C8 | **output.wgsl line count wrong in docs/Features/README.md**: table says 71 lines, actual is 83 | HIGH | SMALL | docs/Features/README.md |
| C9 | **Panel type count wrong**: says 16, actual is 17 | MEDIUM | SMALL | docs/Features/README.md |
| C10 | **Timeline store slices severely understated**: CLAUDE.md lists 7, docs/Features/README.md shows 7, actual is 17 | HIGH | MEDIUM | CLAUDE.md, docs/Features/README.md |
| C11 | **MediaStore slices understated**: CLAUDE.md lists 6, actual is 9 (missing multiLayerSlice, projectSlice, selectionSlice) | HIGH | SMALL | CLAUDE.md |
| C12 | **Effects categories incomplete in CLAUDE.md**: lists 5 but `src/effects/` also has `generate/`, `time/`, `transition/`, `_shared/` | MEDIUM | SMALL | CLAUDE.md |
| C13 | **Missing `src/assets/` and `src/test/` from architecture tree** | LOW | SMALL | CLAUDE.md |
| C14 | **Missing npm scripts in CLAUDE.md**: `test:ui` and `test:coverage` not documented (11 actual vs 9 listed) | MEDIUM | SMALL | CLAUDE.md |
| C15 | **Section 9 of CLAUDE.md references Next.js patterns**: project uses Vite+React SPA, not Next.js. Includes `next/dynamic`, `React.cache()`, RSC boundaries, `next.config.js` | MEDIUM | MEDIUM | CLAUDE.md |
| C16 | **Test count stale in docs/Features/README.md**: says ~1,659 tests / 35 files, actual is 1,717 / 44 files | MEDIUM | SMALL | docs/Features/README.md |
| C17 | **Version history in docs/Features/README.md stops at 1.2.11**: missing all subsequent versions up to 1.3.5 | HIGH | LARGE | docs/Features/README.md |
| C18 | **Version drift is systemic across all 4 docs**: no automation keeps versions in sync | HIGH | MEDIUM | All docs |
| C19 | **Redundancy leads to inconsistency**: same metrics repeated in different docs with different values | MEDIUM | LARGE | All docs |
| C20 | **Missing `src/changelog-data.json` from architecture tree**: 5,063-line file imported by version.ts | LOW | SMALL | CLAUDE.md |

---

## Reviewer A Unique Findings

| # | Finding | Severity | Effort | Verified? |
|---|---------|----------|--------|-----------|
| A1 | **Engine root-level files omitted from CLAUDE.md tree**: `ParallelDecodeManager.ts`, `WebCodecsExportMode.ts`, `WebCodecsPlayer.ts`, `featureFlags.ts`, `webCodecsTypes.ts`, `index.ts` are not listed (only `WebGPUEngine.ts` mentioned in Section 6) | MEDIUM | SMALL | YES - these files exist at `src/engine/` root level |
| A2 | **Missing from tree: `src/effects/types.ts` and `src/effects/EffectControls.tsx`** | LOW | SMALL | YES - files exist |
| A3 | **Missing from tree: `src/stores/timeline/clip/` subdirectory and `src/stores/timeline/helpers/`** | LOW | SMALL | YES - directories exist |
| A4 | **Missing hooks from CLAUDE.md**: `useClipPanelSync.ts`, `useContextMenuPosition.ts`, `useThumbnailCache.ts` | LOW | SMALL | YES - files exist |
| A5 | **Missing `src/components/index.ts` barrel export from tree** | LOW | SMALL | YES |
| A6 | **German/English language inconsistency across 4 docs**: CLAUDE.md and FEATURES.md in German, README.md and docs/Features/README.md in English | LOW | LARGE | YES - confirmed by inspection |
| A7 | **Effect shader line count stale in docs/Features/README.md**: table says ~954, actual is 1,108 | HIGH | SMALL | YES - verified `wc -l` of all `src/effects/**/*.wgsl` = 1,108 |
| A8 | **`test:ui` and `test:coverage` listed in README.md but not in CLAUDE.md**: inconsistency between the two docs | MEDIUM | SMALL | YES - README.md lists them, CLAUDE.md does not |

---

## Reviewer B Unique Findings

| # | Finding | Severity | Effort | Verified? |
|---|---------|----------|--------|-----------|
| B1 | **`package.json` version is 1.0.0 while `version.ts` is 1.3.5**: these should be synchronized or discrepancy noted | MEDIUM | SMALL | YES - `package.json` line 4 says `"version": "1.0.0"` |
| B2 | **Zustand `subscribeWithSelector` middleware undocumented in CLAUDE.md**: used in 9 store files but not mentioned in the Zustand patterns section | MEDIUM | SMALL | YES - found in 9 files: timelineStore, mediaStore, historyStore, settingsStore, dockStore, engineStore, renderTargetStore, sam2Store, multicamStore |
| B3 | **tsconfig project references undocumented**: `tsconfig.json` references `tsconfig.app.json` + `tsconfig.node.json`, relevant for contributors but not mentioned in CLAUDE.md | LOW | SMALL | YES - verified from `tsconfig.json` |
| B4 | **6 test failures present at time of audit**: 3 test files failing with 6 test failures | MEDIUM | MEDIUM | NOT RE-VERIFIED (may be transient or branch-specific) |
| B5 | **Google Fonts count wrong in README.md**: says 57, actual code has 50 | CRITICAL | SMALL | YES - `POPULAR_FONTS` array has exactly 50 entries with comment "Top 50 most popular Google Fonts". README.md line 99 says 57. |
| B6 | **Missing `src/stores/mediaStore/init.ts` and `src/stores/mediaStore/constants.ts` from tree** | LOW | SMALL | YES - files exist |
| B7 | **WGSL shader breakdown table math is inconsistent**: individual line counts do not sum correctly to the stated total | MEDIUM | SMALL | YES - table values (using documented numbers) sum to ~2,399, actual components with real numbers would be different |
| B8 | **EffectsPipeline.ts location verified as correct in CLAUDE.md** (reviewer confirmed a potential concern was actually fine) | _(info)_ | _(none)_ | N/A - not a gap |

---

## Conflicts Resolved

### Conflict 1: AI Tool Count (Reviewer A: 80, Reviewer B: 76)

**Resolution: Reviewer B is correct. Actual count is 76.**

Reviewer A counted all `name:` field occurrences across the 15 definition files and got 80. However, 4 of those are nested parameter property names inside JSON schemas (2 in `masks.ts` for mask name fields, 2 in `media.ts` for folder/composition name fields), not top-level tool definitions. Filtering to only top-level tool `name:` fields that define tool identifiers (string-valued, at proper indentation level) yields exactly 76 tools.

Verification method: `grep -E "^\s+name:\s+'" src/services/aiTools/definitions/*.ts` (excluding index.ts) returns 76 matches.

### Conflict 2: Google Fonts Count (Reviewer A: 57, Reviewer B: 50)

**Resolution: Reviewer B is correct. Actual count is 50.**

The `POPULAR_FONTS` array in `src/services/googleFontsService.ts` contains exactly 50 `FontConfig` entries (20 sans-serif + 10 serif + 10 display + 5 handwriting + 5 monospace). The file comment explicitly states "Top 50 most popular Google Fonts."

Reviewer A appears to have read the README.md claim of 57 and assumed it was correct, then flagged docs/Features as stale for saying 50. In reality, README.md is wrong (says 57), while docs/Features/README.md and FEATURES.md correctly say 50. This is the opposite of what Reviewer A concluded.

**Impact**: README.md needs to be corrected from 57 to 50 (not the other way around).

### Conflict 3: Version Gap Size (Reviewer A: "16 patch versions behind", Reviewer B: "24 patch versions behind")

**Resolution: Cannot be precisely verified.** The docs/Features/README.md version history stops at 1.2.11, and the current version is 1.3.5. The exact number of intermediate releases is not determinable from the codebase alone (the changelog-data.json uses dates, not version numbers). Both reviewers are making estimates. The key fact is: the version history is significantly incomplete and needs backfilling. The gap spans at least from 1.2.12 through 1.3.5.

### Conflict 4: Which doc has the wrong Google Fonts count

**Resolution: README.md is wrong (says 57). docs/Features/README.md and FEATURES.md are correct (say 50).**

Reviewer A said: "Fix Google Fonts count. Update 50 to 57 in docs/Features/README.md and FEATURES.md."
Reviewer B said: "Fix Google Font count in README.md. Change 57 to 50 to match the actual code."

Reviewer B is correct. The code has 50. README.md should be changed from 57 to 50.

### Conflict 5: AI tool count in README.md

Reviewer A said README.md says 76, actual is 80, so README needs updating to 80.
Reviewer B said README.md says 76, actual is 76, so README is correct.

**Resolution: Reviewer B is correct.** README.md says 76, and the actual count is 76. README.md is accurate on this metric. Only docs/Features/README.md (33) and FEATURES.md (33) need updating to 76.

---

## Prioritized Action Items

### CRITICAL (numbers are factually wrong, mislead readers/AI assistants)

| # | Action | Effort | Source Finding |
|---|--------|--------|---------------|
| 1 | **Fix version references across all docs**: README.md badge 1.3.4->1.3.5, docs/Features/README.md header 1.2.11->1.3.5, FEATURES.md header 1.2.11->1.3.5 | SMALL | C1, C2, C3 |
| 2 | **Fix TypeScript LOC in README.md**: change "~60k lines" to "~120k lines" or remove to avoid future staleness | SMALL | C4 |
| 3 | **Fix AI tool count in docs/Features/**: update from 33 to 76 in docs/Features/README.md (3 locations) and FEATURES.md (1 location) | SMALL | C5, C6 |
| 4 | **Fix Google Fonts count in README.md**: change 57 to 50 to match actual code | SMALL | B5 |

### HIGH (architecture documentation is stale or misleading)

| # | Action | Effort | Source Finding |
|---|--------|--------|---------------|
| 5 | **Update WGSL line counts**: README.md "2,200+" -> "2,400+" (3 locations). docs/Features/README.md: fix output.wgsl from 71 to 83, effect shaders from ~954 to 1,108 | SMALL | C7, C8, A7 |
| 6 | **Update timeline store slice documentation**: expand the 7-item list to mention all 17 slices in CLAUDE.md and docs/Features/README.md | MEDIUM | C10 |
| 7 | **Update mediaStore slice list in CLAUDE.md**: add multiLayerSlice, projectSlice, selectionSlice | SMALL | C11 |
| 8 | **Backfill version history in docs/Features/README.md**: add entries from 1.2.12 through 1.3.5 | LARGE | C17 |
| 9 | **Update panel type count**: 16 -> 17 in docs/Features/README.md | SMALL | C9 |
| 10 | **Update test counts**: ~1,659/35 -> ~1,717/44 in docs/Features/README.md | SMALL | C16 |
| 11 | **Consider version sync automation**: a script that updates version references in docs when `src/version.ts` changes | MEDIUM | C18 |

### MEDIUM (documentation gaps that could confuse contributors/AI)

| # | Action | Effort | Source Finding |
|---|--------|--------|---------------|
| 12 | **Update CLAUDE.md effects listing**: add `_shared/`, `generate/`, `time/`, `transition/` directories | SMALL | C12 |
| 13 | **Add missing npm scripts to CLAUDE.md**: document `test:ui` and `test:coverage` | SMALL | C14, A8 |
| 14 | **Revise CLAUDE.md Section 9**: remove or clearly caveat Next.js-specific patterns; replace with Vite equivalents (e.g., `React.lazy()` instead of `next/dynamic`) | MEDIUM | C15 |
| 15 | **Synchronize `package.json` version**: update from 1.0.0 to match version.ts, or add comment explaining it's unused | SMALL | B1 |
| 16 | **Document Zustand `subscribeWithSelector` middleware** in CLAUDE.md's Zustand patterns section | SMALL | B2 |
| 17 | **Add engine root-level files to CLAUDE.md tree**: ParallelDecodeManager.ts, WebCodecsPlayer.ts, featureFlags.ts, etc. | SMALL | A1 |
| 18 | **Fix WGSL shader breakdown table math** in docs/Features/README.md so individual values sum correctly | SMALL | B7 |

### LOW (nice to have, minor omissions)

| # | Action | Effort | Source Finding |
|---|--------|--------|---------------|
| 19 | **Add `src/assets/`, `src/test/`, `src/changelog-data.json` to CLAUDE.md tree** | SMALL | C13, C20 |
| 20 | **Document tsconfig project references** in CLAUDE.md | SMALL | B3 |
| 21 | **Add missing mediaStore helper files to tree**: `init.ts`, `constants.ts` | SMALL | B6 |
| 22 | **Add missing hooks, effects helper files, and component barrel export to tree** | SMALL | A2, A3, A4, A5 |
| 23 | **Standardize language across documentation** (currently mixed German/English) | LARGE | A6 |
| 24 | **Reduce metric redundancy across docs**: centralize counts in one authoritative location | LARGE | C19 |
| 25 | **Investigate 6 test failures** found during audit (may be branch-specific) | MEDIUM | B4 |
