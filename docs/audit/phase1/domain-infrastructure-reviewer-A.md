# Domain 6: Infrastructure & Config - Reviewer A Findings

## Summary
- Files audited: 25+ (package.json, vite.config.ts, tsconfig.json, src/version.ts, src/App.tsx, src/main.tsx, src/types/*, all 4 doc files, plus directory listings)
- Docs reviewed: 4 (CLAUDE.md, README.md, docs/Features/README.md, docs/Features/FEATURES.md)
- Critical gaps found: 5
- Inaccuracies found: 18
- Missing features: 3

## Actual Metrics (verified from code)
- Current version: **1.3.5** (in `src/version.ts`)
- TypeScript files: **486**
- Total LOC: **123,613**
- WGSL lines (shaders dir): **1,303**
- WGSL lines (effect shaders): **1,108** (including 154 in `_shared/common.wgsl`)
- WGSL lines total: **2,411**
- Production dependencies: **13**
- Dev dependencies: **19**
- npm scripts: **11**
- GPU effects: **30** (across 5 active categories + 3 empty placeholder categories)
- AI tools: **80**
- Panel types: **17**
- Google Fonts: **57**
- Timeline store slices: **17**
- MediaStore slices: **9**
- Test files: **44**
- Total tests: **1,717**

---

## Gap Analysis

### Inaccurate Claims in CLAUDE.md

#### Section 3: Architecture Tree
1. **Effects categories incomplete.** States `~30 GPU Effects (color/, blur/, distort/, stylize/, keying/)` but the actual `src/effects/` directory also contains `generate/`, `time/`, `transition/`, and `_shared/` directories. The first three are empty placeholders, but they exist and are not documented.
2. **Timeline store slices understated.** Lists `track, clip, keyframe, mask, playback, selection, transition, ...` (7 named). The actual count is **17** slice files: the listed ones plus `aiActionFeedbackSlice`, `clipEffectSlice`, `clipboardSlice`, `downloadClipSlice`, `linkedGroupSlice`, `markerSlice`, `proxyCacheSlice`, `ramPreviewSlice`, `solidClipSlice`, `textClipSlice`. The trailing `...` is too vague for an architecture reference.
3. **MediaStore slices incomplete.** Lists `fileImport, fileManage, folder, proxy, composition, slot, ...` (6 named). Actual count is **9**: missing `multiLayerSlice`, `projectSlice`, `selectionSlice`.
4. **Missing `src/test/` directory.** Contains `ParallelDecodeTest.tsx` -- not listed in the architecture tree.
5. **Missing `src/assets/` directory.** Contains `react.svg` -- not listed.
6. **Engine root-level files omitted.** The tree shows only subdirectories, but `src/engine/` also has root-level files: `ParallelDecodeManager.ts`, `WebCodecsExportMode.ts`, `WebCodecsPlayer.ts`, `WebGPUEngine.ts`, `featureFlags.ts`, `webCodecsTypes.ts`, `index.ts`. Only `WebGPUEngine.ts` is referenced in section 6.

#### Section 2: Quick Reference
7. **Missing scripts.** Lists 9 scripts but `package.json` has **11**. Missing from docs: `test:ui` and `test:coverage`.

#### Section 9: React/Next.js Best Practices
8. **Misleading section title.** Section is titled "React/Next.js Best Practices" but MasterSelects does **not use Next.js** -- it is a Vite + React SPA. The section contains Next.js-specific patterns (`dynamic from 'next/dynamic'`, `next.config.js`, React Server Components, `React.cache()`) that do not apply to this project. While noted as general React best practices, the Next.js framing is confusing in the context of a pure Vite project.

### Inaccurate Claims in README.md

1. **Version badge is stale.** Badge shows `version-1.3.4` but actual version in `src/version.ts` is `1.3.5`.
2. **WGSL line count understated.** Claims "2,200+" and "~2,200 lines of WGSL" in three places. Actual total is **2,411** lines. The "2,200" figure appears to only count `src/shaders/` (1,303 lines) and undercount the effect WGSL shaders (additional 1,108 lines).
3. **AI tool count stale.** Claims **76** AI tools in multiple places (badge, body text, project structure comment). Actual count is **80** tools across 15 definition files.
4. **LOC claim understated.** States "~60k lines of TypeScript." Actual is **123,613 lines** -- more than double the claim.
5. **`test:ui` and `test:coverage` scripts listed in Development section** but NOT in CLAUDE.md -- this is an inconsistency between the two docs rather than an error in README itself.

### Inaccurate Claims in docs/Features/README.md

1. **Version is stale.** Header says "Version 1.2.11 | March 2026" but actual version is **1.3.5**. This is 16 patch versions behind.
2. **AI tool count stale.** Claims "33 AI tools" and "33 intelligent editing tools via OpenAI function calling." Actual count is **80** tools. This is severely outdated (likely the original count before major expansions).
3. **Google Fonts count stale.** Claims "50 Google Fonts" in three places. Actual count from `googleFontsService.ts` is **57**.
4. **output.wgsl line count wrong.** WGSL breakdown table claims output.wgsl has 71 lines. Actual is **83 lines**.
5. **Test count stale.** States "~1,659 tests across 35 test files." Actual is **1,717 tests across 44 test files**.
6. **Panel type count wrong.** Claims "16 Panel Types" but actual `PanelType` union in `src/types/dock.ts` has **17** types (both `youtube` and `download` exist as separate panels).
7. **Timeline store slice count wrong.** Zustand Store Architecture section shows 7 slices for timelineStore. Actual count is **17** slice files.
8. **Version history stops at 1.2.11.** Missing all versions from 1.2.12 through 1.3.5 (at least 16 releases not documented).
9. **WGSL total approximation.** States "~2,400" which is close to actual 2,411 -- acceptable but the per-file breakdown has the output.wgsl error.

### Inaccurate Claims in docs/Features/FEATURES.md

1. **Version is stale.** Header says "Version 1.2.11" but actual is **1.3.5**.
2. **Google Fonts count stale.** Claims "50 Google Fonts." Actual is **57**.
3. **AI tool count stale.** Section 11 states "33 AI Tools." Actual is **80**.

### Missing from Architecture Tree (CLAUDE.md section 3)

| Missing Item | Location | Notes |
|---|---|---|
| `src/assets/` | Root src dir | Contains react.svg |
| `src/test/` | Root src dir | Contains ParallelDecodeTest.tsx |
| `src/changelog-data.json` | Root src dir | Changelog data used by version.ts |
| `src/effects/generate/` | Effects categories | Empty placeholder |
| `src/effects/time/` | Effects categories | Empty placeholder |
| `src/effects/transition/` | Effects categories | Empty placeholder |
| `src/effects/_shared/` | Effects | Contains common.wgsl (154 lines) |
| `src/effects/types.ts` | Effects | Effect type definitions |
| `src/effects/EffectControls.tsx` | Effects | Effect UI controls component |
| `src/engine/ParallelDecodeManager.ts` | Engine root | Parallel decode management |
| `src/engine/WebCodecsExportMode.ts` | Engine root | Export mode logic |
| `src/engine/WebCodecsPlayer.ts` | Engine root | WebCodecs playback |
| `src/engine/featureFlags.ts` | Engine root | Feature flag system |
| `src/engine/webCodecsTypes.ts` | Engine root | WebCodecs type definitions |
| `src/stores/mediaStore/slices/` | MediaStore | Actual slice directory structure |
| `src/stores/timeline/clip/` | Timeline store | Clip subdirectory |
| `src/stores/timeline/helpers/` | Timeline store | Helper utilities |
| 10 additional timeline slices | Timeline store | See detailed list above |
| 3 additional mediaStore slices | MediaStore | multiLayerSlice, projectSlice, selectionSlice |
| `src/hooks/useClipPanelSync.ts` | Hooks | Not mentioned |
| `src/hooks/useContextMenuPosition.ts` | Hooks | Not mentioned |
| `src/hooks/useThumbnailCache.ts` | Hooks | Not mentioned |
| `src/components/index.ts` | Components | Root barrel export |

### Stale References

| Document | Reference | Claimed | Actual |
|---|---|---|---|
| README.md | Version badge | 1.3.4 | 1.3.5 |
| README.md | WGSL lines | 2,200+ | 2,411 |
| README.md | AI tools | 76 | 80 |
| README.md | TypeScript LOC | ~60k | ~124k |
| docs/Features/README.md | Version header | 1.2.11 | 1.3.5 |
| docs/Features/README.md | AI tools | 33 | 80 |
| docs/Features/README.md | Google Fonts | 50 | 57 |
| docs/Features/README.md | output.wgsl lines | 71 | 83 |
| docs/Features/README.md | Test count | ~1,659 / 35 files | 1,717 / 44 files |
| docs/Features/README.md | Panel types | 16 | 17 |
| docs/Features/README.md | Timeline slices | 7 | 17 |
| docs/Features/README.md | Version history | stops at 1.2.11 | 1.3.5 |
| docs/Features/FEATURES.md | Version header | 1.2.11 | 1.3.5 |
| docs/Features/FEATURES.md | AI tools | 33 | 80 |
| docs/Features/FEATURES.md | Google Fonts | 50 | 57 |

### Documentation Quality Issues

1. **Version drift is systemic.** Three of four docs have stale version numbers. `docs/Features/README.md` and `FEATURES.md` are 16+ patch versions behind. The README.md badge is only 1 behind. There is no automation to keep versions in sync.

2. **AI tool count is inconsistent across all docs.** README.md says 76, docs/Features/README.md says 33, FEATURES.md says 33. The actual count is 80. Three different numbers for the same metric.

3. **LOC claim is dramatically wrong.** README.md claims ~60k lines but actual is ~124k. This likely was accurate months ago and was never updated. The codebase has roughly doubled.

4. **Redundancy between docs.** The same information (effect list, AI tool count, panel types, tech stack) is repeated across all four docs in slightly different forms, leading to inconsistency as the project evolves. There is no single source of truth.

5. **CLAUDE.md section 9 is misleading.** A large portion of CLAUDE.md is dedicated to React/Next.js best practices that reference Next.js-specific APIs (`dynamic from 'next/dynamic'`, React Server Components, `React.cache()`, `next.config.js`). This project uses Vite, not Next.js. While the general React patterns are useful, the Next.js-specific examples could mislead an AI assistant into suggesting inappropriate patterns.

6. **docs/Features/README.md version history is incomplete.** Stops at 1.2.11 (the last documented version), missing at least 16 subsequent releases. This makes the version history unreliable as a changelog reference.

7. **German/English language mix.** CLAUDE.md is in German, README.md is in English, docs/Features/README.md is in English, FEATURES.md is in German. The four docs lack a consistent language policy.

---

## Recommended Changes

### Priority 1 (Critical -- numbers are wrong)
1. **Update version references everywhere.** `README.md` badge to 1.3.5, `docs/Features/README.md` header to 1.3.5, `docs/Features/FEATURES.md` header to 1.3.5.
2. **Fix LOC claim in README.md.** Change "~60k lines" to "~120k lines" (or remove the specific number to avoid future staleness).
3. **Fix AI tool count everywhere.** Update to 80: README.md (4 occurrences of "76"), docs/Features/README.md (2 occurrences of "33"), FEATURES.md (1 occurrence of "33").
4. **Fix Google Fonts count.** Update 50 to 57 in docs/Features/README.md (3 places) and FEATURES.md (1 place). README.md already says 57.

### Priority 2 (High -- architecture docs are stale)
5. **Update WGSL line counts.** README.md: change "2,200+" to "2,400+". docs/Features/README.md: fix output.wgsl from 71 to 83 lines.
6. **Update timeline store slice count** in docs/Features/README.md Zustand section from 7 to at least the major slices, or note "17 slice files."
7. **Update panel type count** from 16 to 17 in docs/Features/README.md and FEATURES.md.
8. **Update test count** from "~1,659 tests across 35 files" to "~1,717 tests across 44 files" in docs/Features/README.md.
9. **Backfill version history** in docs/Features/README.md from 1.2.12 to 1.3.5.

### Priority 3 (Medium -- architecture tree gaps)
10. **Update CLAUDE.md section 3 architecture tree.** Add missing directories (test/, assets/, effects subcategories, engine root files) and expand the timeline/mediaStore slice lists.
11. **Add missing npm scripts** `test:ui` and `test:coverage` to CLAUDE.md section 2.
12. **Revise CLAUDE.md section 9** to remove or clearly caveat Next.js-specific patterns that do not apply to this Vite project.

### Priority 4 (Low -- documentation quality)
13. **Consider automation** for version sync (e.g., a script that updates version references in docs when `src/version.ts` changes).
14. **Reduce redundancy** by centralizing metrics (effect count, AI tool count, etc.) in one authoritative location and referencing it from other docs.
15. **Standardize language policy** across documentation files.
