# Structural Review A: Information Architecture

**Reviewer:** Structural Reviewer A
**Date:** 2026-03-16
**Scope:** Overall documentation organization, hierarchy, redundancy, and restructuring proposals

---

## Current Structure Assessment

### Inventory

The project has **67 markdown files** across 8 directories:

```
Root level (2 docs):
  CLAUDE.md              (499 lines) - AI assistant instructions
  README.md              (285 lines) - Public-facing project intro

docs/Features/ (24 docs):
  README.md              (659 lines) - Doc index + feature catalog + architecture + version history
  FEATURES.md            (481 lines) - German-language feature handbook (duplicate of README.md)
  AI-Integration.md      (571 lines) - AI chat, SAM2, transcription, tools
  Audio.md               (652 lines) - EQ, master clock, varispeed, multicam sync
  Debugging.md           (402 lines) - Logger service reference
  Effects.md             (332 lines) - Transforms, blend modes, GPU effects
  effects-system.md      (258 lines) - Plugin architecture, auto-registration
  Export.md              (449 lines) - Export modes, settings, FFmpeg
  FFMPEG_WASM_BUILD_PLAN.md (944 lines) - FFmpeg WASM build plan (planning doc)
  GPU-Engine.md          (695 lines) - WebGPU architecture, render pipeline
  Keyboard-Shortcuts.md  (241 lines) - Shortcut reference
  Keyframes.md           (271 lines) - Animation system
  Masks.md               (253 lines) - Vector masks, GPU feathering
  Media-Panel.md         (526 lines) - Import, folders, compositions
  Multicam-AI.md         (362 lines) - AI multicam editing
  Native-Helper.md       (236 lines) - Rust companion app
  Preview.md             (717 lines) - Preview, playback, output manager
  Project-Persistence.md (509 lines) - Local storage, autosave
  Proxy-System.md        (211 lines) - Proxy generation
  SharedDecoderArchitecture.md (237 lines) - Design proposal (NOT IMPLEMENTED)
  Text-Clips.md          (189 lines) - Text overlays
  Timeline.md            (668 lines) - Multi-track editing
  UI-Panels.md           (683 lines) - Dock system, panels, MIDI
  YouTube.md             (137 lines) - Download panel

docs/ other (3 docs):
  REACT-BEST-PRACTICES.md (2,934 lines) - React/Next.js patterns (Vercel Engineering)
  architecture/codeplan.md (1,689 lines) - FFmpeg WASM implementation plan
  godO.md                (268 lines) - Full codebase refactoring plan

docs/plans/ (12 docs):
  Various planning documents (108-2,659 lines each)

docs/refactor/ (7 docs + 2 in COMPLETED/):
  Various refactoring plans (111-2,434 lines each)

docs/audit/phase1/ (10 docs):
  Code audit results from parallel reviewers

docs/research/html-video-nle/ (10 docs):
  Deep research on HTML video NLE challenges
```

### Strengths

1. **Feature docs are granular and well-scoped.** Most individual feature docs (Masks.md, Keyframes.md, Text-Clips.md, etc.) are focused on a single feature and sized appropriately (200-700 lines).
2. **Cross-references exist.** Many feature docs have "Related Documents" sections at the bottom linking to sibling docs.
3. **ToC structure within docs is good.** Most feature docs have a clear Table of Contents at the top.
4. **CLAUDE.md is effective as an AI onboarding doc.** It provides workflow rules, critical patterns, and architecture overview in a scannable format.

### Weaknesses

1. **No clear doc hierarchy.** There are three competing "entry points" (README.md, CLAUDE.md, docs/Features/README.md) with no clear hierarchy between them.
2. **Massive redundancy** between docs/Features/README.md, FEATURES.md, and the feature catalog scattered in README.md.
3. **Planning docs mixed with reference docs.** `FFMPEG_WASM_BUILD_PLAN.md` and `SharedDecoderArchitecture.md` sit alongside feature reference docs in `docs/Features/`.
4. **Version numbers are stale everywhere** except `src/version.ts`. README.md badge says 1.3.4, docs/Features/README.md says 1.2.11, FEATURES.md says 1.2.11.
5. **Inconsistent navigation.** 9 out of 23 feature docs (39%) lack "Back to Index" links and "Related Documents" sections.
6. **Language inconsistency.** CLAUDE.md is entirely German, FEATURES.md is German, but all other docs are English. Multicam-AI.md is mixed German/English.
7. **CLAUDE.md section 9 contains Next.js patterns** (SSR, RSC, Suspense, `next/dynamic`) that are irrelevant to this Vite + SPA project. It references a 2,934-line REACT-BEST-PRACTICES.md that is predominantly about Next.js server patterns.
8. **Data contradictions across docs.** AI tool count is listed as "33" in README.md index and FEATURES.md, but "76" in AI-Integration.md and root README.md.

---

## Redundancy Analysis

### Critical Redundancies

#### 1. Three-way feature catalog overlap

| Content | docs/Features/README.md | FEATURES.md | README.md (root) |
|---------|------------------------|-------------|-------------------|
| Feature table/checklist | Full (lines 98-378) | Full (lines 9-481) | Abbreviated (lines 83-106) |
| Architecture diagram | Yes (lines 382-418) | No | No |
| Tech stack | Yes (lines 44-56) | Yes (lines 465-481) | Yes (lines 167-176) |
| Version history | Yes (lines 620-650) | No | No |
| Quick start guide | Yes (lines 469-512) | No | Yes (lines 115-127) |
| Keyboard shortcuts | Yes (lines 515-537) | No | Yes (lines 179-193) |
| Troubleshooting | Yes (lines 550-559) | No | No |

**FEATURES.md is 95% redundant with docs/Features/README.md.** They contain the same feature catalog, with FEATURES.md in German and README.md in English. FEATURES.md adds no unique information not already in README.md or the individual feature docs.

#### 2. Architecture tree duplication

The `src/` directory tree appears in:
- CLAUDE.md section 3 (lines 117-169) -- annotated, compact
- README.md "Project Structure" collapsible (lines 222-265) -- annotated, compact
- docs/Features/README.md "Architecture" section (lines 382-444) -- box diagram + store breakdown

All three serve different audiences (AI assistants, GitHub visitors, doc readers), but the duplication means they drift apart. The CLAUDE.md version is the most detailed; the README.md version is nearly identical; the docs/Features/README.md version is a complementary box diagram.

#### 3. Effects.md vs effects-system.md

- **Effects.md** (332 lines): User-facing -- transforms, blend modes, GPU effects list, effect keyframes, transitions
- **effects-system.md** (258 lines): Developer-facing -- plugin architecture, auto-registration, how to add effects, pipeline internals

These are **not redundant** but are **confusingly named.** A developer looking for "how effects work" could land on either. The README.md index lists them in separate sections (Feature vs Technical), which is correct, but the filenames do not signal their different audiences.

#### 4. FFMPEG_WASM_BUILD_PLAN.md and architecture/codeplan.md

Both are about FFmpeg WASM. `FFMPEG_WASM_BUILD_PLAN.md` (944 lines) covers codec selection and build config. `architecture/codeplan.md` (1,689 lines) covers the implementation code plan. These are planning documents that live in `docs/Features/` alongside reference docs, which is structurally confusing.

#### 5. Version history in docs/Features/README.md vs src/version.ts

The version history in README.md (lines 620-650) is stale at 1.2.11. The authoritative changelog lives in `src/version.ts`. This is a maintenance burden that will always drift.

---

## Hierarchy Issues

### Current navigation paths

```
User arrives at GitHub repo
  -> README.md (root) -- good entry point
     -> "Documentation" link -> docs/Features/README.md
        -> Individual feature docs (19 docs with back-links)
        -> 4 docs (Technical) without back-links
     -> docs/Features/FEATURES.md (dead end, no back-link, German)

AI assistant reads CLAUDE.md
  -> Section 3 architecture overview
  -> Section 6 important files table
  -> "Ausführliche Dokumentation: docs/Features/README.md"
  -> docs/Features/README.md (same index)

Developer wants to understand a subsystem
  -> Which entry point? README.md? CLAUDE.md? docs/Features/README.md?
  -> Plans are scattered across docs/plans/, docs/refactor/, docs/architecture/
```

### Problems

1. **docs/Features/README.md tries to be too many things.** It is simultaneously: (a) a documentation index, (b) a feature catalog with status tables, (c) an architecture reference, (d) a quick start guide, (e) a keyboard reference, (f) a troubleshooting guide, (g) a version history, and (h) a browser requirements page. At 659 lines, it is bloated and hard to maintain.

2. **No landing page for developers.** There is no CONTRIBUTING.md or ARCHITECTURE.md. A developer who wants to understand the system must piece together information from CLAUDE.md (AI-focused), docs/Features/GPU-Engine.md (engine internals), and scattered refactor plans.

3. **Planning docs have no index.** The 12 docs in `docs/plans/` and 9 docs in `docs/refactor/` have no README or index file. A reader must scan filenames to find what they need.

4. **`docs/` top-level is cluttered.** `REACT-BEST-PRACTICES.md` (2,934 lines), `godO.md`, and `architecture/codeplan.md` sit at the top level with no organizing principle.

5. **Audit and research docs are orphaned.** The `docs/audit/` and `docs/research/` directories contain valuable analysis but are never referenced from any index or navigation doc.

---

## Proposed Restructuring

### Guiding Principles

1. **Single source of truth.** Each piece of information should live in exactly one place.
2. **Clear audience separation.** AI assistants, GitHub visitors, and developers have different needs.
3. **Navigation by convention.** Every directory gets a README.md. Every doc links back to its parent.
4. **Planning docs are time-bound artifacts, not reference docs.** They belong in a separate area.

---

### Docs to Delete

| File | Reason |
|------|--------|
| `docs/Features/FEATURES.md` | 95% redundant with docs/Features/README.md. The German translation adds no value since all other docs are English. Any unique content should be merged into the individual feature docs before deletion. |
| Version history in `docs/Features/README.md` (lines 620-650) | Stale, unmaintainable duplicate of `src/version.ts` CHANGELOG. Remove this section entirely; link to `src/version.ts` instead. |

### Docs to Merge

| Target | Sources | Rationale |
|--------|---------|-----------|
| `docs/Features/Effects.md` | Absorb relevant cross-references from `docs/Features/effects-system.md` into a "Developer Internals" section at the bottom | Keep one canonical effects doc with both user and developer sections. Rename `effects-system.md` to a redirect or delete after merge. |
| `docs/Features/Export.md` | Absorb `docs/Features/SharedDecoderArchitecture.md` as a "Future: V2 Architecture" appendix | SharedDecoder is explicitly marked "NOT IMPLEMENTED" -- it is a design appendix to Export, not a standalone feature doc. |

### Docs to Move

| File | From | To | Rationale |
|------|------|----|-----------|
| `docs/Features/FFMPEG_WASM_BUILD_PLAN.md` | `docs/Features/` | `docs/plans/` | This is a planning doc, not a feature reference. |
| `docs/architecture/codeplan.md` | `docs/architecture/` | `docs/plans/` | This is an FFmpeg implementation plan, not architecture reference. Rename to `ffmpeg-wasm-codeplan.md`. |
| `docs/godO.md` | `docs/` | `docs/refactor/` | This is a refactoring plan. Its current location at `docs/` root is arbitrary. |
| `docs/REACT-BEST-PRACTICES.md` | `docs/` | `docs/reference/` | External reference material, not project-specific documentation. |

### Docs to Rename

| Current | Proposed | Rationale |
|---------|----------|-----------|
| `docs/Features/YouTube.md` | `docs/Features/Download-Panel.md` | The file's own title is "Download Panel (formerly YouTube Panel)". The filename is outdated. |
| `docs/Features/effects-system.md` | (merge into Effects.md, then delete) | See merge proposal above. |

### Docs to Split

| File | Proposed Split | Rationale |
|------|---------------|-----------|
| `docs/Features/README.md` (659 lines) | Split into: (1) `docs/Features/README.md` -- pure index/ToC only (~80 lines), (2) Move feature catalog tables into individual feature docs or delete (they duplicate individual docs), (3) Move architecture diagram to `ARCHITECTURE.md`, (4) Move quick start to root README.md or standalone `docs/Getting-Started.md`, (5) Move browser requirements to `docs/Getting-Started.md`, (6) Delete version history section | The current file is a monolith trying to serve 8 purposes. |
| `docs/Features/AI-Integration.md` (571 lines) | Consider extracting SAM2 content into `docs/Features/SAM2-Segmentation.md` if SAM2 grows further. Currently borderline -- 571 lines is manageable, and the ToC is well-structured. **No immediate action needed.** | Monitor only. |

### New Docs to Create

| File | Content | Rationale |
|------|---------|-----------|
| `docs/ARCHITECTURE.md` | High-level architecture (from README.md box diagram + CLAUDE.md section 3 tree + render pipeline from section 8). Single source of truth for architecture. | Currently duplicated in 3 places. Consolidate here and link from CLAUDE.md and README.md. |
| `docs/Getting-Started.md` | Quick start, browser requirements, troubleshooting, Linux Vulkan setup. Absorb content from docs/Features/README.md sections 469-559. | This content does not belong in a documentation index. |
| `docs/plans/README.md` | Index of all planning docs with status (active/completed/abandoned) and one-line descriptions. | 12 planning docs with no index is not navigable. |
| `docs/refactor/README.md` | Index of all refactor plans with status. | 9 refactor docs with no index is not navigable. |

---

### CLAUDE.md Section 9: Next.js Patterns in a Vite Project

**Problem:** Section 9 "React/Next.js Best Practices (Vercel Engineering)" (lines 325-498, 174 lines) contains patterns that are partially or fully inapplicable to this project:

| Pattern | Applicable? | Why |
|---------|------------|-----|
| Promise.all() for parallelism | Yes | General JS pattern |
| Defer await until needed | Yes | General async pattern |
| Strategic Suspense boundaries | Partially | React Suspense works in SPAs but the example uses RSC |
| Avoid barrel file imports | Yes | Bundle size applies to Vite too |
| Dynamic imports | Yes, but uses `next/dynamic` | Should use `React.lazy()` instead |
| React.cache() for deduplication | **No** | Server Components only, not available in Vite SPA |
| Minimize RSC serialization | **No** | No RSC in this project |
| Server-Side Performance section | **No** | No server rendering |
| Functional setState | Yes | General React pattern |
| Lazy state initialization | Yes | General React pattern |
| toSorted() vs sort() | Yes | General JS pattern |

**Recommendation:** Reduce section 9 to only the applicable patterns (~60 lines instead of 174). Remove all Next.js/RSC-specific examples. The reference link to `REACT-BEST-PRACTICES.md` can stay for the full Vercel doc, but CLAUDE.md should only inline patterns that apply to this Vite SPA.

---

## Recommended Doc Tree

```
masterselects/
├── CLAUDE.md                           # AI assistant instructions (keep, but trim section 9)
├── README.md                           # Public GitHub landing page (keep as-is)
│
├── docs/
│   ├── ARCHITECTURE.md                 # NEW: Single source of truth for architecture
│   ├── Getting-Started.md              # NEW: Quick start, browser reqs, troubleshooting
│   │
│   ├── Features/                       # Feature reference docs (user + developer)
│   │   ├── README.md                   # SLIM DOWN: Pure index only (~80 lines)
│   │   ├── AI-Integration.md           # AI chat, SAM2, transcription, tools
│   │   ├── Audio.md                    # EQ, master clock, varispeed
│   │   ├── Debugging.md                # Logger service reference
│   │   ├── Download-Panel.md           # RENAMED from YouTube.md
│   │   ├── Effects.md                  # MERGED: Effects + effects-system.md
│   │   ├── Export.md                   # MERGED: Export + SharedDecoderArchitecture.md
│   │   ├── GPU-Engine.md               # WebGPU architecture
│   │   ├── Keyboard-Shortcuts.md       # Shortcut reference
│   │   ├── Keyframes.md                # Animation system
│   │   ├── Masks.md                    # Vector masks
│   │   ├── Media-Panel.md              # Import, folders
│   │   ├── Multicam-AI.md              # AI multicam editing
│   │   ├── Native-Helper.md            # Rust companion
│   │   ├── Preview.md                  # Preview, playback, output manager
│   │   ├── Project-Persistence.md      # Local storage, autosave
│   │   ├── Proxy-System.md             # Proxy generation
│   │   ├── Text-Clips.md              # Text overlays
│   │   ├── Timeline.md                 # Multi-track editing
│   │   └── UI-Panels.md               # Dock system, panels, MIDI
│   │
│   ├── reference/                      # External/generic reference material
│   │   └── REACT-BEST-PRACTICES.md     # MOVED from docs/
│   │
│   ├── plans/                          # Time-bound planning docs
│   │   ├── README.md                   # NEW: Index with status
│   │   ├── ffmpeg-wasm-build-plan.md   # MOVED from Features/
│   │   ├── ffmpeg-wasm-codeplan.md     # MOVED+RENAMED from architecture/codeplan.md
│   │   ├── ... (existing plan docs)
│   │   └── webvj-mixer-plan.md
│   │
│   ├── refactor/                       # Refactoring plans
│   │   ├── README.md                   # NEW: Index with status
│   │   ├── COMPLETED/
│   │   ├── godO-refactoring-plan.md    # MOVED+RENAMED from docs/godO.md
│   │   └── ... (existing refactor docs)
│   │
│   ├── audit/                          # Code audit results (keep as-is)
│   │   └── phase1/ ... phase6/
│   │
│   ├── research/                       # Deep research (keep as-is)
│   │   └── html-video-nle/
│   │
│   └── images/                         # Screenshots (keep as-is)
│       ├── screenshot-main.png
│       └── screenshot-curves.png
```

**Deleted files:**
- `docs/Features/FEATURES.md` (redundant)
- `docs/Features/effects-system.md` (merged into Effects.md)
- `docs/Features/SharedDecoderArchitecture.md` (merged into Export.md)
- `docs/architecture/` directory (contents moved to plans/)

**Net change:** 24 feature docs reduced to 19. 2 new top-level docs added. 2 index files added. Overall file count decreases by 3.

---

## Cross-Reference Improvements

### Consistency fixes needed

1. **Add "Back to Index" links** to these 9 docs that currently lack them:
   - `Debugging.md`, `FFMPEG_WASM_BUILD_PLAN.md` (moving to plans/), `Multicam-AI.md`, `Native-Helper.md`, `SharedDecoderArchitecture.md` (merging into Export.md), `Text-Clips.md`, `YouTube.md` (renaming), `effects-system.md` (merging into Effects.md)

2. **Add "Related Documents" sections** to the same 9 docs listed above.

3. **Standardize arrow character** in "Back to Index" links. Currently mixed between `[<- Back to Index]` and `[<< Back to Index]`. Use `[<- Back to Index](./README.md)` consistently.

4. **Fix data contradictions:**
   - AI tool count: README.md index says "33", AI-Integration.md says "76", FEATURES.md says "33". The correct number appears to be **76** (per root README.md and the aiTools service). Update all references.
   - WGSL line count: README.md says "2,200+", docs/Features/README.md says "~2,400". Standardize.

5. **Add navigation links between related docs:**
   - `GPU-Engine.md` should link to `Effects.md` (effects pipeline) -- already does
   - `Export.md` should link to `GPU-Engine.md` (render pipeline used in export)
   - `Native-Helper.md` should link to `Download-Panel.md` and `Project-Persistence.md`
   - `Multicam-AI.md` should link to `AI-Integration.md` and `Audio.md`

6. **CLAUDE.md architecture section** (section 3) should state: "For the full architecture reference, see `docs/ARCHITECTURE.md`" and keep only a condensed version.

7. **Root README.md** "Documentation" link (line 199) should remain pointing to `docs/Features/README.md`, which will become a clean index.

---

## Priority Order for Implementation

| Priority | Action | Effort | Impact |
|----------|--------|--------|--------|
| 1 | Delete `FEATURES.md` | Low | Eliminates largest redundancy |
| 2 | Slim `docs/Features/README.md` to pure index | Medium | Fixes bloated entry point |
| 3 | Create `docs/ARCHITECTURE.md` | Medium | Single source of truth |
| 4 | Move planning docs out of `docs/Features/` | Low | Fixes structural confusion |
| 5 | Trim CLAUDE.md section 9 | Low | Removes misleading patterns |
| 6 | Rename `YouTube.md` to `Download-Panel.md` | Low | Fixes outdated name |
| 7 | Merge `effects-system.md` into `Effects.md` | Medium | Reduces doc count, clarifies |
| 8 | Merge `SharedDecoderArchitecture.md` into `Export.md` | Medium | Reduces doc count |
| 9 | Create `docs/Getting-Started.md` | Medium | Better onboarding |
| 10 | Fix all cross-reference inconsistencies | Medium | Navigation quality |
| 11 | Add index files to `plans/` and `refactor/` | Low | Discoverability |
| 12 | Fix version number drift | Low | Accuracy (but consider automation) |

---

## Summary

The documentation has grown organically and has solid individual feature docs, but suffers from three structural problems:

1. **Redundancy:** FEATURES.md is entirely redundant. The feature catalog in docs/Features/README.md duplicates individual feature docs. Architecture is described in 3 places.

2. **Mixed concerns:** Planning documents sit alongside feature references. The doc index tries to be an index, a feature catalog, an architecture guide, a quick start guide, and a version history all at once.

3. **Inconsistent navigation:** 39% of feature docs lack back-links. Version numbers are stale. Data contradictions exist across docs (33 vs 76 AI tools).

The proposed restructuring reduces the feature doc count from 24 to 19, creates a proper architecture reference, separates planning docs from reference docs, and establishes clear navigation paths for all three audiences (AI assistants, GitHub visitors, developers).
