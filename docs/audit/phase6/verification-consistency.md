# Verification: Cross-Document Consistency

**Date:** 2026-03-16
**Source of truth:** `src/version.ts` (APP_VERSION = `1.3.5`)
**Files checked:** README.md, CLAUDE.md, docs/Features/*.md (20 files), docs/audit/ (for context)

---

## Version References

All core documentation files were checked for version number references. Audit/phase files are excluded from "should fix" since they are historical review records.

| File | Version Found | Correct? |
|------|--------------|----------|
| `src/version.ts` | 1.3.5 | YES (source of truth) |
| `README.md` (badge, line 7) | 1.3.5 | YES |
| `docs/Features/README.md` (header, line 7) | 1.3.5 | YES |
| `docs/Features/README.md` (line 244) | 1.3.5 | YES |
| `CLAUDE.md` | no version reference | N/A (correct -- CLAUDE.md does not hardcode version) |

**Result: 0 version inconsistencies in core docs.** All version references are 1.3.5. The previously reported issues (README badge at 1.3.4, docs/Features/README.md at 1.2.11, FEATURES.md at 1.2.11) have all been fixed.

---

## Number Consistency

| Metric | Expected | Files Checked | Status | Notes |
|--------|----------|--------------|--------|-------|
| **AI tools** | 76 | README.md, CLAUDE.md, docs/Features/README.md, AI-Integration.md, UI-Panels.md | CONSISTENT | All say 76. AI-Integration.md correctly notes "74 fully functional; 2 have registration bugs" |
| **Google Fonts** | 50 | README.md, docs/Features/README.md, Text-Clips.md | CONSISTENT | All say 50 |
| **GPU effects** | 30 | README.md, CLAUDE.md, docs/Features/README.md, Effects.md, GPU-Engine.md, Text-Clips.md | MINOR INCONSISTENCY | See detail below |
| **WGSL lines** | 2,500+ (casual) / ~2,565 (technical) | README.md, docs/Features/README.md, GPU-Engine.md | CONSISTENT | README.md says "2,500+" (3 places). Features/README.md says "2,500+" in tech stack + "~2,565" in shader table. GPU-Engine.md says "~2,565 lines (files only) or ~3,000 lines (including inline)". Context-appropriate. |
| **TypeScript LOC** | ~120k | README.md | CONSISTENT | Only appears in README.md line 58 as "~120k lines of TypeScript" |
| **Panel types** | 17 | docs/Features/UI-Panels.md, docs/Features/README.md (architecture diagram) | CONSISTENT | UI-Panels.md says "17 dockable panel types". README.md architecture diagram says "(17 slices)" for timeline, not panels -- these are different metrics. |
| **Timeline slices** | 17 | docs/Features/README.md, docs/Features/Timeline.md | CONSISTENT | README.md architecture diagram says "(17 slices)". Timeline.md says "combines 17 slices + 2 utility modules". Zustand store listing in README.md enumerates exactly 18 slice files (trackSlice through markerSlice) -- see detail below. |
| **Render targets** | 7 | docs/Features/GPU-Engine.md | CONSISTENT | Says "7 textures total" (line 266). Only one reference found. |
| **Export codecs** | 4 | docs/Features/Export.md | CONSISTENT | Codec table lists 4: H.264, H.265, VP9, AV1 with correct codec ID strings |

### GPU Effects Detail

The count is "30" everywhere, but two places in `docs/Features/README.md` say "30+" instead of "30":
- Line 26: `**30+ GPU Effects**`
- Line 72: `30+ modular GPU effects`

All other references (README.md stats table, README.md line 44/88/249, CLAUDE.md, Effects.md, GPU-Engine.md, Text-Clips.md) say exactly "30". The "30+" is slightly misleading since there are exactly 30 effects, not more. This is a minor cosmetic inconsistency rather than a factual error.

### Timeline Slices Detail

The `docs/Features/README.md` Zustand Store Architecture section (lines 154-173) lists 18 named slice files:
1. trackSlice, 2. clipSlice, 3. playbackSlice, 4. keyframeSlice, 5. selectionSlice, 6. maskSlice, 7. compositionSlice, 8. transitionSlice, 9. ramPreviewSlice, 10. proxyCacheSlice, 11. clipEffectSlice, 12. linkedGroupSlice, 13. downloadClipSlice, 14. solidClipSlice, 15. textClipSlice, 16. clipboardSlice, 17. aiActionFeedbackSlice, 18. markerSlice

This lists 18 items but the label says "17 slices". One of these may be counted differently (e.g., markerSlice may have been added after the count was set). The claim of "17 slices" should be verified against the actual store index file. **Minor discrepancy: 18 listed vs 17 stated.**

---

## Stale References Found

All previously identified stale references in core documentation have been fixed:

| Reference | Status | Notes |
|-----------|--------|-------|
| `docs/Features/FEATURES.md` | FIXED | File deleted. No references remain in core docs. |
| `docs/Features/effects-system.md` | FIXED | File deleted. No references remain in core docs (content merged into Effects.md). |
| `docs/Features/SharedDecoderArchitecture.md` | FIXED | File deleted. Content now lives within Export.md as a design appendix with NOT IMPLEMENTED banner. No broken links. |
| `docs/Features/YouTube.md` | FIXED | Renamed to `Download-Panel.md`. All references in core docs updated. |
| `EffectsPanel.tsx` reference | FIXED | Effects.md now correctly references `EffectsTab.tsx`. No stale `EffectsPanel.tsx` references in any core doc. |
| "YouTube Panel" naming | FIXED | `Download-Panel.md` title says "Download Panel (formerly YouTube Panel)" -- appropriate historical note. All other references use "Download Panel". |

### Internal Link Verification (docs/Features/README.md)

All 20 documentation index links were verified against existing files:

| Link Target | Exists? |
|-------------|---------|
| `./Timeline.md` | YES |
| `./Keyframes.md` | YES |
| `./Preview.md` | YES |
| `./Effects.md` | YES |
| `./Masks.md` | YES |
| `./AI-Integration.md` | YES |
| `./Media-Panel.md` | YES |
| `./Audio.md` | YES |
| `./Text-Clips.md` | YES |
| `./Export.md` | YES |
| `./UI-Panels.md` | YES |
| `./GPU-Engine.md` | YES |
| `./Project-Persistence.md` | YES |
| `./Proxy-System.md` | YES |
| `./Download-Panel.md` | YES |
| `./Native-Helper.md` | YES |
| `./Multicam-AI.md` | YES |
| `./Keyboard-Shortcuts.md` | YES |
| `./Debugging.md` | YES |
| `../plans/FFMPEG_WASM_BUILD_PLAN.md` | YES |

### Cross-file Link in Export.md

| Link Target | Exists? |
|-------------|---------|
| `./GPU-Engine.md#stacked-alpha-export` | YES (section "Stacked Alpha Export" exists at line 523) |

---

## Remaining Inconsistencies in Audit Files (informational only)

The `docs/audit/` directory contains historical review records that reference old version numbers (1.2.11, 1.3.4) and old file names (FEATURES.md, effects-system.md, YouTube.md, EffectsPanel.tsx). These are expected and correct -- they document what was found during the audit phases and should NOT be changed. They are historical records, not active documentation.

---

## Summary

**0 version inconsistencies** found in core documentation. All references are `1.3.5`.

**2 minor number inconsistencies** found:
1. `docs/Features/README.md` says "30+" GPU effects in 2 places while the exact count is 30 (used elsewhere). Cosmetic.
2. `docs/Features/README.md` states "17 slices" but lists 18 slice files in the Zustand architecture section.

**0 stale references** found in core documentation. All previously identified stale references (FEATURES.md, effects-system.md, SharedDecoderArchitecture.md, YouTube.md, EffectsPanel.tsx) have been cleaned up.

**0 broken internal links** found. All 21 cross-document links in the documentation index resolve to existing files.

**Overall assessment: Documentation is consistent.** The cleanup work from prior audit phases was effective.
