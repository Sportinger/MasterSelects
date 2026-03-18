# Domain 5: Effects & Transitions - Consolidated Findings

## Methodology

Two independent reviewers (A and B) audited the same 42 source files and 2 documentation files (`docs/Features/Effects.md`, `docs/Features/effects-system.md`). This consolidation resolves disagreements by verifying against actual source code.

---

## Consensus (both reviewers found)

| # | Finding | Severity | Effort | Affected Doc(s) |
|---|---------|----------|--------|-----------------|
| C1 | **EffectControls.tsx vs EffectsTab.tsx confusion**: `effects-system.md` architecture tree lists `EffectControls.tsx` as the "Generic UI renderer" but the actual production UI is `src/components/panels/properties/EffectsTab.tsx` (with DraggableNumber, batch grouping, keyframe toggles, quality sections). Neither doc mentions `EffectsTab.tsx`. | CRITICAL | SMALL | effects-system.md, Effects.md |
| C2 | **Uniform buffer size "16-32 bytes" omits 0-byte case**: Effects.md line 289 says "16-32 bytes" but Invert uses 0 bytes (no uniform buffer). Three effects use 32 bytes (levels, glow, chroma-key), not two. | LOW | SMALL | Effects.md |
| C3 | **`point` parameter type documented as supported but unimplemented**: `effects-system.md` line 204 lists `point` as a parameter type with "XY controls" UI. Code has only a TODO stub in `EffectControls.tsx` (`<span>Point control (TODO)</span>`). `EffectsTab.tsx` does not handle `point` at all. No effects use this type. | LOW | SMALL | effects-system.md |
| C4 | **Default values missing from parameter tables**: Neither doc consistently provides default values for effect parameters. All 30 effects have defaults defined in code but the docs show only name and range for most. | HIGH | MEDIUM | Effects.md, effects-system.md |
| C5 | **Duplicate documentation creates drift risk**: Both `Effects.md` and `effects-system.md` contain overlapping effect inventories, parameter lists, and pipeline descriptions. Maintenance burden with no clear delineation of audience. | MEDIUM | LARGE | Effects.md, effects-system.md |
| C6 | **`slide` and `zoom` transition categories defined in code but undocumented**: `TransitionCategory` in `src/transitions/types.ts` includes `'slide' | 'zoom'` but docs only mention dissolve and wipe. | LOW | SMALL | Effects.md |
| C7 | **`ClipTransition` interface undocumented**: Runtime transition instance type (id, type, duration, linkedClipId) defined in `src/transitions/types.ts` lines 37-46 is not mentioned in either doc. | MEDIUM | SMALL | Effects.md, effects-system.md |
| C8 | **No changes since 2026-03-08**: Both reviewers confirmed zero commits to `src/effects/` or `src/transitions/` since the documentation baseline. No missing features. | -- | -- | -- |
| C9 | **All 30 effects correctly documented**: Both reviewers verified the complete effect inventory matches across code and docs. Count, IDs, and categories are accurate. | -- | -- | -- |

---

## Reviewer A Unique Findings

| # | Finding | Severity | Effort | Verified? |
|---|---------|----------|--------|-----------|
| A1 | **Quality section UI described in Effects.md is implemented in EffectsTab.tsx, not EffectControls.tsx**: Effects.md lines 187-214 describe collapsible quality UI, reset button, noMaxLimit behavior. This lives in `EffectsTab.tsx`. A developer following the docs would look in the wrong file. | HIGH | SMALL | YES -- verified `EffectsTab.tsx` has quality section logic; `EffectControls.tsx` does not. Subsumed under C1 but adds specificity about the quality UI description. |
| A2 | **`rgb-split` default (0.01) and other specific defaults not documented**: Explicit per-effect default audit provided (all 30 effects). | HIGH | MEDIUM | YES -- this is a detailed version of C4. Reviewer A provided the full default value list from code. |

---

## Reviewer B Unique Findings

| # | Finding | Severity | Effort | Verified? |
|---|---------|----------|--------|-----------|
| B1 | **Stale file path in Effects.md line 332**: Source attribution references `src/components/panels/EffectsPanel.tsx` which does NOT exist. Correct path is `src/components/panels/properties/EffectsTab.tsx`. | CRITICAL | SMALL | YES -- confirmed via `Glob` search: no file named `EffectsPanel.tsx` exists anywhere under `src/components/panels/`. |
| B2 | **`color` parameter type documented but never used**: `effects-system.md` line 203 lists `color` as a supported parameter type. `EffectControls.tsx` has a working implementation (color input), but `EffectsTab.tsx` does not handle it. No effect uses this type (Chroma Key uses `select` instead). | LOW | SMALL | YES -- confirmed: no effect definition uses `type: 'color'`. |
| B3 | **Audio effect filtering undocumented**: `EffectsPipeline.applyEffects()` (line 178) silently filters out effects with type prefix `audio-`. Neither doc mentions this behavior. | MEDIUM | SMALL | YES -- confirmed code: `effects.filter(e => e.enabled && !e.type.startsWith('audio-'))`. No mention in either doc. |
| B4 | **`INLINE_EFFECT_IDS` not mentioned in effects-system.md**: Effects.md (lines 230-235) correctly documents inline effects, but `effects-system.md` (the developer-facing doc) does not mention this optimization at all. | MEDIUM | SMALL | YES -- confirmed via grep: no match for "INLINE" in effects-system.md. |
| B5 | **`EffectInstance` interface undocumented**: Defined in `EffectsPipeline.ts` line 15 (id, type, name, enabled, params). Neither doc describes this runtime representation attached to clips. | LOW | SMALL | YES -- confirmed: interface exists in code, absent from both docs. |
| B6 | **Animatable flag not explicitly documented per-parameter**: Docs note `animatable: true` enables keyframes but don't specify which parameters across all effects are non-animatable. From code: quality params and `speed` (grain, scanlines) are `animatable: false`. | LOW | SMALL | YES -- confirmed: 8 params across 7 effects have `animatable: false`. All are either `quality: true` or named `speed`. |
| B7 | **Transition min/max duration missing from Effects.md**: Effects.md only states "Default Duration: 0.5s" for crossfade. The min (0.1s) and max (5.0s) bounds are only in effects-system.md. | LOW | SMALL | YES -- confirmed: Effects.md line 300 shows only default, no min/max column. |
| B8 | **Chroma-key uses 32 bytes (3 effects at 32, not 2)**: Reviewer A's inventory listed only levels and glow as 32-byte effects. Chroma-key also uses 32 bytes. | LOW | SMALL | YES -- confirmed: `uniformSize: 32` in `src/effects/keying/chroma-key/index.ts` line 13. |

---

## Conflicts Resolved

### Conflict 1: Critical finding identification
- **Reviewer A** flagged C1 (EffectControls.tsx vs EffectsTab.tsx confusion) as the sole CRITICAL item.
- **Reviewer B** flagged B1 (stale file path `EffectsPanel.tsx`) as the sole CRITICAL item.
- **Resolution**: Both are CRITICAL. B1 is a broken reference (file does not exist at all), which is objectively more severe since it sends developers to a dead end. C1 is a misleading reference (file exists but is not the production component). Both require immediate fixes.

### Conflict 2: Uniform size - which effects use 32 bytes?
- **Reviewer A** stated: "Levels and Glow use 32 bytes" (omitted chroma-key).
- **Reviewer B** stated: "levels (8 floats), glow (8 floats), chroma-key (8 floats)" for 32 bytes.
- **Resolution**: Reviewer B is correct. Code verification confirms all three effects have `uniformSize: 32`. Reviewer A's inventory table correctly listed chroma-key's uniform size as 32 bytes but the prose description only mentioned two.

### Conflict 3: Shared shader utility completeness
- **Reviewer A** said the list in effects-system.md is "accurate" and "no issue."
- **Reviewer B** noted the `VertexOutput` struct is not listed explicitly (only mentioned indirectly via "vertexMain").
- **Resolution**: Reviewer B is technically correct but this is trivial. The struct is an implementation detail of the vertex shader, which IS listed. Rated as not actionable.

---

## Prioritized Action Items

### P0 -- CRITICAL (fix immediately)

| # | Action | Source | Effort | File(s) to Edit |
|---|--------|--------|--------|-----------------|
| 1 | Fix stale file path on Effects.md line 332: change `src/components/panels/EffectsPanel.tsx` to `src/components/panels/properties/EffectsTab.tsx` | B1 | SMALL (< 5 min) | `docs/Features/Effects.md` |
| 2 | Update effects-system.md architecture tree: add `EffectsTab.tsx` as the primary production UI, clarify `EffectControls.tsx` is a simplified/generic fallback | C1 | SMALL (< 15 min) | `docs/Features/effects-system.md` |

### P1 -- HIGH (fix soon)

| # | Action | Source | Effort | File(s) to Edit |
|---|--------|--------|--------|-----------------|
| 3 | Add default values column to parameter tables in Effects.md (all 30 effects have defaults in code) | C4, A2 | MEDIUM (1-2 hr) | `docs/Features/Effects.md` |
| 4 | Add default values to effects-system.md parameter listings (currently only quality params have defaults) | C4 | MEDIUM (1 hr) | `docs/Features/effects-system.md` |

### P2 -- MEDIUM (fix when convenient)

| # | Action | Source | Effort | File(s) to Edit |
|---|--------|--------|--------|-----------------|
| 5 | Document audio effect filtering (`audio-` prefix skip) in pipeline section | B3 | SMALL (< 15 min) | `docs/Features/Effects.md`, `docs/Features/effects-system.md` |
| 6 | Add `INLINE_EFFECT_IDS` mention to effects-system.md (already covered in Effects.md) | B4 | SMALL (< 10 min) | `docs/Features/effects-system.md` |
| 7 | Document `ClipTransition` interface in transitions section | C7 | SMALL (< 15 min) | `docs/Features/Effects.md` |
| 8 | Document `EffectInstance` interface (runtime representation on clips) | B5 | SMALL (< 15 min) | `docs/Features/effects-system.md` |
| 9 | Consider consolidating or clearly differentiating the two doc files to reduce drift risk | C5 | LARGE (2+ hr) | Both docs |

### P3 -- LOW (nice to have)

| # | Action | Source | Effort | File(s) to Edit |
|---|--------|--------|--------|-----------------|
| 10 | Fix uniform size description: "16-32 bytes" to "0, 16, or 32 bytes" | C2 | SMALL (< 5 min) | `docs/Features/Effects.md` |
| 11 | Note `point` and `color` parameter types as defined-but-unused | C3, B2 | SMALL (< 10 min) | `docs/Features/effects-system.md` |
| 12 | Document `slide` and `zoom` as defined (empty) transition categories | C6 | SMALL (< 5 min) | `docs/Features/Effects.md` |
| 13 | Add transition min/max duration to Effects.md crossfade table | B7 | SMALL (< 5 min) | `docs/Features/Effects.md` |
| 14 | Document which parameters are non-animatable (quality + speed params) | B6 | SMALL (< 15 min) | `docs/Features/effects-system.md` |
| 15 | Correct 32-byte effects list to include chroma-key alongside levels and glow | B8 | SMALL (< 5 min) | (internal note; docs don't list per-effect sizes) |

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total unique findings | 17 |
| Consensus findings | 9 (including 2 "no issue" confirmations) |
| Reviewer A unique | 2 (both verified, both subsets of consensus items) |
| Reviewer B unique | 8 (all verified) |
| Conflicts resolved | 3 |
| CRITICAL items | 2 |
| HIGH items | 2 |
| MEDIUM items | 5 |
| LOW items | 6 |
| Estimated total effort | ~6-8 hours |
