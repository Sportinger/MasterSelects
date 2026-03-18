# Domain 6: Infrastructure & Config - Reviewer B Findings

## Summary
- Files audited: 14 source files + full filesystem scan
- Docs reviewed: 4 (CLAUDE.md, README.md, docs/Features/README.md, docs/Features/FEATURES.md)
- Critical gaps found: 3
- Inaccuracies found: 18
- Missing features: 6

## Verified Metrics

| Metric | Documented | Actual | Source |
|--------|-----------|--------|--------|
| TypeScript/TSX files | _(not stated)_ | 486 | `find src/ -name "*.ts" -o -name "*.tsx"` |
| Lines of TypeScript | ~60k (README.md) | 123,613 | `wc -l` across all TS/TSX |
| WGSL total lines | 2,200 (README.md) / 2,400 (docs/Features/README.md) | 2,411 | All .wgsl files combined |
| WGSL core shaders | 1,303 lines | 1,303 | `src/shaders/*.wgsl` |
| WGSL effect shaders | ~954 (docs/Features/README.md) | 1,108 | `src/effects/**/*.wgsl` |
| Production dependencies | 13 (README.md) | 13 | package.json |
| Dev dependencies | _(not stated)_ | 19 | package.json |
| npm scripts | 9 in CLAUDE.md | 11 actual | package.json |
| GPU effects | 30 (all docs) | 30 | `src/effects/` individual dirs |
| Blend modes | 37 (all docs) | 37 | `src/types/index.ts` BlendMode type |
| AI tools | 76 (README.md) / 33 (docs/Features/README.md, FEATURES.md) | 76 | aiTools/definitions/ |
| Google Fonts | 57 (README.md) / 50 (docs/Features/README.md, FEATURES.md) | 50 | `src/services/googleFontsService.ts` |
| Panel types | 16 (docs/Features/README.md) | 17 | `src/types/dock.ts` PanelType |
| Timeline slices | 7 (docs/Features/README.md) | 17 | `src/stores/timeline/*Slice.ts` |
| MediaStore slices | ~6 implied (CLAUDE.md) | 9 | `src/stores/mediaStore/slices/` |
| Test files | 35 (docs/Features/README.md) | 44 | `tests/` directory |
| Test count | ~1,659 (docs/Features/README.md) | 1,717 (1,711 pass + 6 fail) | `vitest run` |
| APP_VERSION | 1.3.4 (README badge) / 1.2.11 (docs/Features/) | 1.3.5 | `src/version.ts` |
| Keyboard shortcuts | 89 (README.md) | _(not independently verified)_ | docs/Features/Keyboard-Shortcuts.md |
| Vite version | 7.2 (README, docs/Features) | ^7.2.4 | package.json |
| React version | 19 (README) | ^19.2.0 | package.json |
| TypeScript version | _(not stated)_ | ~5.9.3 | package.json |

## Gap Analysis

### Inaccurate Claims in CLAUDE.md

**Section 2 (Quick Reference):**
1. **Missing scripts**: CLAUDE.md lists 9 scripts but package.json has 11. `test:ui` and `test:coverage` are not documented in CLAUDE.md (though they appear in README.md).

**Section 3 (Architecture Tree):**
2. **Effects categories incomplete**: CLAUDE.md lists `color/, blur/, distort/, stylize/, keying/` but the actual `src/effects/` also contains `generate/`, `time/`, `transition/`, and `_shared/`. The generate, time, and transition directories are empty stubs (comments say "Effects will be added here"), but `_shared/common.wgsl` has 154 lines and is functionally important.
3. **Timeline store slices understated**: CLAUDE.md says `track, clip, keyframe, mask, playback, selection, transition, ...` (7 named + ellipsis). Actual count is 17 slice files including `aiActionFeedbackSlice`, `clipEffectSlice`, `clipboardSlice`, `downloadClipSlice`, `linkedGroupSlice`, `markerSlice`, `proxyCacheSlice`, `ramPreviewSlice`, `solidClipSlice`, `textClipSlice` which are not mentioned.
4. **MediaStore slices understated**: CLAUDE.md says `fileImport, fileManage, folder, proxy, composition, slot, ...` (6 named). Actual is 9 slices: also includes `multiLayerSlice`, `selectionSlice`, `projectSlice`.
5. **Missing `src/assets/` directory**: The tree omits `src/assets/` (contains react.svg) and `src/test/` directory (contains ParallelDecodeTest.tsx).
6. **Missing `src/changelog-data.json`**: The `version.ts` imports from `./changelog-data.json` (5,063 lines), a critical file not shown in the tree.
7. **Effects Pipeline location**: CLAUDE.md tree shows `effects/ -> EffectsPipeline.ts` as if it lives inside `src/effects/`. The file `src/effects/EffectsPipeline.ts` does exist there, which is correct.

**Section 6 (Important Files):**
8. All 13 listed file paths verified as existing and accurate. No issues here.

**Section 9 (React/Next.js Best Practices):**
9. **Irrelevant content**: This section discusses Next.js patterns (SSR, RSC boundaries, `next/dynamic`, `React.cache()`, `next.config.js`) that are entirely inapplicable. MasterSelects is a Vite + React SPA with no Next.js at all. While the general patterns (Promise.all, lazy state init, functional setState) are useful, the Next.js-specific examples are misleading.

### Inaccurate Claims in README.md

10. **Version badge stale**: README badge says `1.3.4`, but `src/version.ts` has `1.3.5`. (This is on the staging branch, so may be an intentional pre-release.)
11. **TypeScript LOC inflated or outdated**: README says "~60k lines of TypeScript". Actual count is 123,613 lines. The claim is severely understated.
12. **WGSL lines understated**: README states "2,200+ lines of WGSL" and "~2,200 lines of WGSL" in three places. Actual total is 2,411 lines. The README number is stale (likely predates recent shader additions).
13. **Google Fonts count wrong**: README says "57 Google Fonts" in the feature table. The code (`googleFontsService.ts`) declares exactly 50 fonts. The docs/Features docs correctly say 50.

### Inaccurate Claims in docs/Features/README.md

14. **Version severely stale**: Header says "Version 1.2.11 | March 2026". Actual version is 1.3.5. This is 24 patch versions behind.
15. **AI tool count wrong**: docs/Features/README.md says "33 AI tools" in three places (Key Highlights table, Documentation Index, AI Integration feature table). Actual count is 76. README.md correctly says 76.
16. **Panel type count wrong**: Says "16 Panel Types" but there are actually 17 (includes `youtube` and `download` as separate types, plus all the others).
17. **Timeline store slices severely understated**: Architecture section shows 7 slices. Actual count is 17.
18. **Test count stale**: Says "~1,659 tests across 35 test files". Actual is 1,717 tests across 44 test files.
19. **output.wgsl line count wrong**: WGSL Shader Breakdown table says output.wgsl has 71 lines. Actual is 83 lines.
20. **Effect shader line count wrong**: Table says "30 effect shaders ~954". Actual is 1,108 lines across effect shaders.
21. **Total WGSL inconsistency**: Table total says "~2,400" while tech stack header says "2,400+". Actual is 2,411, so "2,400+" is approximately correct but the table math is wrong (618+326+243+71+33+154+954 = 2,399, but actual components are 618+326+243+83+33+154+1,108 = 2,565 using real numbers -- wait, the total `wc -l` of all WGSL is 2,411). The individual line counts need updating.
22. **Google Fonts count inconsistent**: Text Clips section says "50 Google Fonts" which is correct, but Key Highlights says "50 Google Fonts" too. README.md says 57. The discrepancy is between README.md and docs/Features/.
23. **Version History stops at 1.2.11**: Missing all versions from 1.2.12 through 1.3.5 (approximately 24 versions of release notes missing).

### Inaccurate Claims in docs/Features/FEATURES.md

24. **Version stale**: Says "Version 1.2.11". Actual is 1.3.5.
25. **AI tool count wrong**: Says "33 AI Tools". Actual is 76.
26. **Otherwise largely accurate**: Feature descriptions, effect lists, blend modes, and audio features are all consistent with actual code.

### Missing from Architecture Tree (CLAUDE.md Section 3)

| Missing Directory/File | Actual Location | Description |
|------------------------|-----------------|-------------|
| `src/assets/` | Exists | Static assets (react.svg) |
| `src/test/` | Exists | In-browser test components (ParallelDecodeTest) |
| `src/changelog-data.json` | Exists (5,063 lines) | Raw changelog entries imported by version.ts |
| `src/effects/_shared/` | Exists | Shared WGSL utilities (common.wgsl, 154 lines) |
| `src/effects/generate/` | Exists (empty stub) | Future effect category |
| `src/effects/time/` | Exists (empty stub) | Future effect category |
| `src/effects/transition/` | Exists (empty stub) | Future effect category |
| `src/stores/mediaStore/slices/` | Exists (9 files) | The actual slice files are in a `slices/` subdirectory |
| `src/stores/mediaStore/init.ts` | Exists | Store initialization |
| `src/stores/mediaStore/constants.ts` | Exists | Store constants |
| 10 additional timeline slices | Exist | See timeline slice analysis above |

### Stale References

1. **docs/Features/README.md Version History** ends at 1.2.11. All releases from 1.2.12 to 1.3.5 are undocumented in that file.
2. **docs/Features/FEATURES.md** references "Version 1.2.11" in its header.
3. **README.md version badge** shows 1.3.4 instead of 1.3.5.
4. **CLAUDE.md section 9** references Next.js patterns that do not apply to this Vite project.

### Documentation Quality Issues

1. **Version drift across 4 files**: `src/version.ts` = 1.3.5, README badge = 1.3.4, docs/Features/README.md = 1.2.11, FEATURES.md = 1.2.11. There is no single source of truth effectively used across docs.
2. **AI tool count bifurcation**: README.md correctly says 76, but both docs/Features/README.md and FEATURES.md say 33 (likely a snapshot from an older version). This creates confusion.
3. **WGSL line counts inconsistent across docs**: README says "2,200+" (three places), docs/Features/README.md says "2,400+" and provides a breakdown table with incorrect individual line counts.
4. **TypeScript LOC massively outdated**: README says "~60k" but actual is ~124k. The codebase has roughly doubled since that claim was written.
5. **Package.json version field stale**: `package.json` has `"version": "1.0.0"` while the actual app version in `version.ts` is `1.3.5`. These should be synchronized or the package.json version should be removed/noted as unused.
6. **Font count inconsistency**: README.md says 57, actual code and docs/Features say 50. README is wrong.
7. **Zustand middleware undocumented**: The codebase uses `subscribeWithSelector` middleware from Zustand, which is not mentioned in CLAUDE.md's Zustand patterns section.
8. **Missing tsconfig details**: CLAUDE.md does not mention the project references pattern (`tsconfig.json` -> `tsconfig.app.json` + `tsconfig.node.json`), which is relevant for contributors.
9. **6 test failures present**: Running `vitest run` shows 3 test files failing with 6 test failures. This suggests either broken tests or a version.ts test that needs updating.

## Recommended Changes

### Critical (version/count accuracy)

1. **Synchronize version numbers**: Update README.md badge, docs/Features/README.md header, and FEATURES.md header to match `src/version.ts` (currently 1.3.5). Consider automating this.
2. **Fix AI tool count in docs/Features/**: Update from 33 to 76 in docs/Features/README.md (3 locations) and FEATURES.md (1 location).
3. **Fix Google Font count in README.md**: Change 57 to 50 to match the actual code.

### High (architecture accuracy)

4. **Update CLAUDE.md architecture tree**: Add `_shared/`, `generate/`, `time/`, `transition/` to effects listing. Add `src/assets/`, `src/test/`, and note `src/changelog-data.json`. Expand timeline slice list to show at least the major additions (marker, clipboard, text, solid, linkedGroup, etc.).
5. **Update mediaStore slice list in CLAUDE.md**: Add `multiLayerSlice`, `selectionSlice`, `projectSlice` and note the `slices/` subdirectory.
6. **Update WGSL line counts**: README.md should say "2,400+" instead of "2,200+". docs/Features/README.md shader breakdown table needs individual file sizes updated (output.wgsl: 71->83, effect shaders: ~954->1,108).
7. **Update TypeScript LOC claim**: README.md says "~60k" but actual is ~124k. Update or remove this claim.
8. **Add missing npm scripts to CLAUDE.md**: Document `test:ui` and `test:coverage`.

### Medium (staleness)

9. **Update docs/Features/README.md Version History**: Add entries for versions 1.2.12 through 1.3.5.
10. **Update test counts in docs/Features/README.md**: Change from "~1,659 tests across 35 test files" to "~1,717 tests across 44 test files".
11. **Update panel type count**: Change from 16 to 17 in docs/Features/README.md.
12. **Fix or remove CLAUDE.md section 9**: Remove Next.js-specific patterns (RSC, `next/dynamic`, `React.cache()`) or clearly label them as general React principles only. Replace with Vite-appropriate equivalents (e.g., `React.lazy()` instead of `next/dynamic`).

### Low (nice to have)

13. **Synchronize `package.json` version**: Either update to match `version.ts` or add a comment explaining the discrepancy.
14. **Document tsconfig project references**: Note the `tsconfig.json` -> `tsconfig.app.json` + `tsconfig.node.json` structure in CLAUDE.md.
15. **Document Zustand middleware usage**: Add `subscribeWithSelector` to the Zustand patterns section.
16. **Fix failing tests**: Investigate the 6 test failures (3 test files) found during the audit run.
