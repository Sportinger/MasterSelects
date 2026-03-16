# Structural Review B: Developer Experience

**Reviewer focus:** Can a new developer clone this repo and get productive from documentation alone?

**Date:** 2026-03-16
**Files reviewed:** CLAUDE.md, README.md, docs/Features/README.md, docs/Features/FEATURES.md, package.json, GPU-Engine.md, Timeline.md, AI-Integration.md, Effects.md, UI-Panels.md, Debugging.md, effects-system.md, plus docs/plans/ and docs/refactor/ directory listings.

---

## Onboarding Assessment

### Can a new developer get running?

**Yes, barely.** The bare minimum is present: `npm install && npm run dev` appears in both README.md and CLAUDE.md. A developer who already knows React/TypeScript/Vite will get the dev server running in under 2 minutes. But the experience immediately deteriorates once they want to understand, navigate, or contribute to the codebase.

### The journey from clone to contribution

1. **Clone -> Build -> Run:** Clear. 2 minutes.
2. **Understand what this project is:** Scattered. README.md is a polished marketing page. CLAUDE.md is an AI instruction file. docs/Features/README.md is an exhaustive feature catalog. None of them are written for a new developer who just joined the team.
3. **Find where things live:** Partially covered. CLAUDE.md section 3 has the best directory tree, but it is inside a file named for AI assistants, not humans. README.md has a collapsible project structure but it is abbreviated. docs/Features/README.md has an architecture diagram but it is buried after 500 lines of feature tables.
4. **Understand how the pieces fit together:** Not covered. There is no "data flows from X to Y" document. The render pipeline (CLAUDE.md section 8) is the closest thing, but it only covers the GPU path, not the React -> Store -> Engine -> GPU full loop.
5. **Make their first change:** Only one "how-to" guide exists (adding a new effect, in effects-system.md). No guides for adding a panel, adding a store slice, adding a keyboard shortcut, adding a test, or any other common task.

**Verdict:** A senior developer familiar with React and WebGPU could become productive in a day by reading code. A mid-level developer would struggle for 2-3 days. A junior developer would be lost.

---

## Missing Guides

### Critical "How-To" content that does not exist

| Task | Where a dev would look | What they find |
|------|----------------------|----------------|
| **Add a new GPU effect** | effects-system.md | Full worked example with shader + TS + registration. This is the gold standard for how-to docs. |
| **Add a new panel** | Nowhere | Nothing. Developer must reverse-engineer from existing panels + dockStore. |
| **Add a new store slice** | CLAUDE.md section 4 has the pattern | Only the Zustand slice skeleton. No guide on how to wire it into the combined store, add tests, or connect to UI. |
| **Add a keyboard shortcut** | Keyboard-Shortcuts.md | Lists all 89 shortcuts but gives zero information on how to add one. |
| **Add a new test** | Nowhere | No testing guide. Tests exist in `tests/unit/` but there is no documentation on testing patterns, mocking strategies, or how the Zustand test setup works. |
| **Debug a rendering issue** | Debugging.md + GPU-Engine.md troubleshooting | Decent coverage for logging. Missing: how to use the browser GPU profiler, how to inspect shader uniforms, how to diagnose blank frames. |
| **Work with the Native Helper** | Native-Helper.md + tools/native-helper/README.md | Covers setup, but no guide on how to add a new native command or extend the WebSocket protocol. |
| **Understand the export pipeline** | Export.md + GPU-Engine.md Export section | Feature-level docs exist. Missing: step-by-step walkthrough of adding a new export codec or format. |

### Impact

The single existing how-to guide (effects-system.md) demonstrates how powerful these guides are -- it is the only feature where a developer could implement something new without reading source code. Every other feature requires code archaeology.

---

## CLAUDE.md Effectiveness

### What it does well

1. **Build commands** (section 2): Complete, accurate, and the single most useful block for getting started.
2. **Critical patterns** (section 4): The HMR singleton, stale closure fix, and video ready state patterns are genuinely important and well-explained. These prevent real bugs.
3. **Architecture tree** (section 3): The best directory overview in the entire documentation.
4. **Debugging** (section 5): Logger usage is clear and copy-pasteable.
5. **Key files table** (section 6): Excellent for AI orientation. Saves significant file-search time.
6. **Render pipeline** (section 8): The ASCII art call chain is genuinely helpful for understanding the rendering flow.

### What misleads or confuses

1. **Section 9 (React/Next.js Best Practices):** This is the most problematic section. MasterSelects is a Vite + React SPA, not a Next.js application. The section includes:
   - `next.config.js` examples that cannot be used in this project
   - `next/dynamic` imports instead of React.lazy
   - Server-Side Rendering patterns (RSC, React.cache) that are completely irrelevant to a client-side SPA
   - Suspense boundaries for data streaming, which does not apply here
   - References to "Vercel Engineering" as the source, which creates false authority for inapplicable patterns

   **Recommendation:** Remove section 9 entirely or replace it with Vite/SPA-specific best practices. Keep only the universally applicable patterns (functional setState, lazy initialization, toSorted).

2. **Language mixing:** CLAUDE.md is primarily German, README.md is English, docs/Features/ is English. This creates confusion about the project's primary language. CLAUDE.md headers like "Wichtige Dateien" and "Architektur" slow down non-German-speaking AI assistants and developers.

3. **Workflow section tells AI to `git add .`:** Section 1 instructs `git add . && git commit -m "description" && git push origin staging` after every change. This is dangerous (can commit secrets, build artifacts, node_modules changes) and contradicts best practices. It also tells AI to push after every commit, which may not be desired in all contexts.

4. **Vision section (section 0):** The June 2026 deadline and TouchDesigner vision are project-management concerns, not AI-assistant instructions. They take up prime real estate at the top of the file. An AI assistant reading this file needs build commands and patterns first, vision last.

5. **AI Debug Tools (section 0.1):** Useful but depends on a skill (`/masterselects`) that is specific to Claude Code. Other AI assistants cannot use this.

### What is missing from CLAUDE.md

- **Test commands and patterns:** How to run tests, how to add tests, what the test setup looks like.
- **Common build errors:** What warnings are expected (mp4box, chunk sizes) vs. what indicates a real problem.
- **Store subscription patterns:** How to properly subscribe to Zustand stores (individual selectors vs. destructuring). This is a real performance concern in the codebase.
- **File size limits:** The codebase has files over 1,500 lines. No guidance on when to split or refactor.
- **Effect registration flow:** CLAUDE.md section 6 mentions "Neuen Effect hinzufuegen" with 4 steps, but effects-system.md has the complete guide. CLAUDE.md should link to it.

---

## Documentation Discoverability

### The navigation problem

The documentation has no central entry point that says "start here." A developer who opens the repo sees:

```
README.md          -> Marketing/overview page
CLAUDE.md          -> AI assistant instructions
docs/Features/     -> 20+ feature docs + README.md + FEATURES.md
docs/plans/        -> 12 plan documents
docs/refactor/     -> 7 refactor plans
docs/research/     -> 10 research documents
docs/architecture/ -> 1 file (codeplan.md)
docs/audit/        -> 12 audit documents
```

**Problems:**

1. **Two feature indexes:** docs/Features/README.md (English, detailed with architecture) and docs/Features/FEATURES.md (German, feature handbook). They cover overlapping content with different structures. A developer does not know which to read.

2. **Plans and refactors are unlabeled:** docs/plans/ contains 12 documents. Some are completed, some are abandoned, some are active. There is no status index. A new developer cannot tell which plans are current. The refactor directory has a COMPLETED subfolder (good), but active vs. abandoned plans are mixed together.

3. **No docs/README.md:** The docs/ directory itself has no index file. A developer navigating to `docs/` sees five subdirectories and two loose files with no guidance.

4. **Research docs are orphaned:** docs/research/html-video-nle/ contains 10 deep-dive documents. They are not linked from any other document.

5. **Feature docs are thorough but hard to navigate to:** GPU-Engine.md is 696 lines and extremely well-written. But a developer looking for "how does rendering work" would not think to look in docs/Features/ for an architecture document.

### What is easy to find

- Build commands: In README.md Quick Start section (prominent).
- Feature list: In README.md feature table (prominent).
- Keyboard shortcuts: Linked from README.md.

### What is hard to find

- Architecture overview: Buried in docs/Features/README.md line 382+.
- Debugging guide: Only discoverable if you find docs/Features/Debugging.md.
- How to add an effect: Only in docs/Features/effects-system.md (not linked from README.md or CLAUDE.md).
- Store architecture: Split between CLAUDE.md section 3, docs/Features/README.md, and individual feature docs.
- Test information: Scattered across individual feature doc "Tests" sections. No central testing guide.

---

## Feature Doc Depth Assessment

### Quality grades

| Doc | Depth | Audience fit | Copy-pasteable? | Notes |
|-----|-------|-------------|-----------------|-------|
| **GPU-Engine.md** | Excellent | Engine developer | Yes | Best doc in the set. Complete architecture, troubleshooting, test references. |
| **Timeline.md** | Excellent | Feature developer | Partial | Comprehensive component/hook/store listing. Missing: how to add a new clip type. |
| **Effects.md** | Good | Effect developer | Yes | Parameter tables are useful. Duplicates effects-system.md content. |
| **effects-system.md** | Excellent | Effect developer | Yes | The gold-standard how-to guide. Full worked example. |
| **AI-Integration.md** | Good | AI feature developer | Partial | Complete tool listing. Missing: how to add a new AI tool. |
| **UI-Panels.md** | Good | UI developer | No | Comprehensive panel catalog. Missing: how to add a new panel type. |
| **Debugging.md** | Good | All developers | Yes | Clear console commands. Missing: visual debugging (GPU profiler, render target inspection). |
| **FEATURES.md** | Redundant | End users? | No | German-language duplicate of README.md feature tables. Audience unclear. |

### Depth calibration

The feature docs are generally too detailed for onboarding (a new dev does not need 696 lines about the GPU engine on day 1) but not actionable enough for contribution (they describe what exists but not how to extend it). They are excellent reference documentation but poor tutorial documentation.

---

## Proposed Improvements

### New Docs to Create

#### 1. `GETTING-STARTED.md` (root level)

**Rationale:** The single highest-impact new document. Currently no file bridges "I cloned this repo" to "I understand how to work here."

**Contents:**
- Prerequisites (Node.js version, Chrome with WebGPU, optional Rust for Native Helper)
- Clone, install, run (with expected output)
- Project structure overview (high-level, linking to detailed docs)
- "Your first 30 minutes" reading path
- Common development tasks (run tests, check build, enable debug logging)
- Link to CONTRIBUTING.md for contribution workflow

#### 2. `CONTRIBUTING.md` (root level)

**Rationale:** Standard open-source convention. Currently the contribution workflow is split between CLAUDE.md (branch rules, commit rules) and nowhere (code review process, PR conventions).

**Contents:**
- Branch workflow (staging -> master, PR process)
- Commit conventions (build before commit, what to include)
- Code style (TypeScript strict, Zustand patterns, singleton patterns)
- Testing expectations
- PR template

#### 3. `docs/ARCHITECTURE.md`

**Rationale:** The architecture information exists but is scattered across CLAUDE.md section 3, docs/Features/README.md lines 382-417, and GPU-Engine.md. Consolidating it would be the second-highest-impact improvement.

**Contents:**
- Full data flow: User action -> React component -> Zustand store -> Engine -> GPU -> Canvas
- Layer system: How clips become layers become textures
- Store architecture: Which stores exist, what they own, how they interact
- Service layer: What services exist and when they are initialized
- Rendering pipeline (expanded from CLAUDE.md section 8)

#### 4. `docs/HOW-TO/` directory with task-specific guides

**Rationale:** The effects-system.md how-to is the best document in the entire docs. Replicating this pattern for common tasks would dramatically improve DX.

**Priority guides:**
- `add-new-effect.md` (already exists as effects-system.md, move/link here)
- `add-new-panel.md`
- `add-new-store-slice.md`
- `add-new-keyboard-shortcut.md`
- `add-new-test.md`
- `debug-rendering-issues.md`

### Existing Docs to Restructure

#### 1. CLAUDE.md: Remove or isolate section 9 (Next.js patterns)

**Rationale:** Section 9 contains ~170 lines of Next.js/SSR patterns that do not apply to this Vite SPA. They actively mislead AI assistants into suggesting server components, RSC boundaries, and next/dynamic imports.

**Action:** Delete section 9. Move the 3 universally applicable patterns (functional setState, lazy initialization, toSorted) into section 4 (Critical Patterns).

#### 2. CLAUDE.md: Reorder sections for AI utility

**Rationale:** An AI assistant needs build commands and patterns immediately, not project vision.

**Proposed order:**
1. Quick Reference (current section 2) -- build/run commands first
2. Architecture (current section 3)
3. Critical Patterns (current section 4)
4. Key Files (current section 6)
5. Debugging (current section 5)
6. Render Pipeline (current section 8)
7. Texture Types (current section 7)
8. Workflow (current section 1) -- branch/commit rules
9. AI Debug Tools (current section 0.1)
10. Vision (current section 0) -- project direction, lowest priority for AI

#### 3. docs/Features/FEATURES.md: Deprecate or merge

**Rationale:** FEATURES.md is a German-language feature handbook that duplicates docs/Features/README.md content. Having two feature indexes in the same directory with overlapping content and different languages is confusing.

**Action:** Add a deprecation notice pointing to README.md, or merge unique content into README.md and archive.

#### 4. docs/plans/ and docs/refactor/: Add status index

**Rationale:** 19 plan/refactor documents with no status tracking. A new developer cannot tell which plans are current, completed, or abandoned.

**Action:** Add a `docs/plans/STATUS.md` index with a table showing each plan's status (active, completed, abandoned, superseded) and last-updated date.

### Content Gaps to Fill

1. **Testing guide:** How to write tests, what is mocked, how Zustand stores are tested, how to run specific test files.
2. **Build error guide:** Which warnings are expected (mp4box types, chunk size) vs. which indicate problems. CLAUDE.md mentions "Warnings sind OK" but does not specify which warnings.
3. **Environment setup for Windows:** CLAUDE.md mentions FFMPEG_DIR and LIBCLANG_PATH for the Native Helper but provides no values or paths. The README.md says "see tools/native-helper/README.md" but does not link it for easy navigation.
4. **Store subscription best practices:** How to properly subscribe to Zustand stores in this codebase. This is a real performance concern (noted in OPTIMIZATION-PLAN.md).
5. **AI tool registration:** How to add a new AI tool to the 76-tool registry. The tool list is documented but not the registration process.

---

## Recommended Reading Order

### For a new developer joining the project

```
1. README.md                          (5 min)  What is this? What does it do?
2. CLAUDE.md section 2                (3 min)  How to build and run
3. CLAUDE.md section 3                (5 min)  Where things live (directory tree)
4. CLAUDE.md section 4                (5 min)  Patterns you MUST follow
5. CLAUDE.md section 8                (3 min)  How rendering works (ASCII pipeline)
6. docs/Features/README.md#architecture (5 min)  Layer diagram
7. CLAUDE.md section 5                (3 min)  How to debug
8. docs/Features/Debugging.md         (10 min) Full debugging reference
9. [Your area's feature doc]          (15 min) Deep dive into the subsystem you will work on
10. docs/Features/effects-system.md   (10 min) Best example of how things are built
```

**Total estimated reading time:** ~65 minutes to basic productivity.

**Problem:** This reading order requires jumping between 5+ files and knowing which sections of each file to read. A GETTING-STARTED.md would compress steps 1-7 into a single, linear document.

---

## Quick Wins

Changes with highest DX impact for lowest effort, ordered by priority:

### 1. Remove CLAUDE.md section 9 (Next.js patterns) -- 5 minutes

Delete ~170 lines of inapplicable Next.js/SSR advice. Move 3 universal patterns to section 4. Eliminates the most misleading content in the documentation. Prevents AI assistants from suggesting `next/dynamic`, `React.cache()`, RSC boundaries, and `next.config.js` configurations that cannot work in this Vite SPA.

### 2. Add a "Reading Order" section to README.md -- 10 minutes

After the Quick Start section, add a "New Developer? Start Here" block with numbered links to the recommended reading order above. Solves the "where do I go after running npm run dev" problem.

### 3. Link effects-system.md from CLAUDE.md section 6 -- 2 minutes

Replace the 4-line "Neuen Effect hinzufuegen" stub with a link to the full guide. Currently the best how-to doc in the repo is not discoverable from the main instruction file.

### 4. Add deprecation headers to stale plan docs -- 15 minutes

Add `> **STATUS: [Completed/Abandoned/Superseded]** -- This plan was written in [date] and may not reflect current architecture.` to each plan/refactor doc. Or create a single STATUS.md index. Prevents developers from following outdated plans.

### 5. Translate CLAUDE.md section headers to English -- 10 minutes

Change "Architektur" to "Architecture", "Wichtige Dateien" to "Key Files", etc. Keep German descriptions in the body if desired, but English headers improve scannability for international developers and AI assistants. Or add English translations in parentheses.

### 6. Add expected build warnings to CLAUDE.md -- 5 minutes

After "Warnings sind OK" add a short list: mp4box type warnings, chunk size warnings, and dynamic import warnings are expected. This prevents developers from spending time investigating known warnings.

### 7. Create docs/README.md index -- 10 minutes

A simple file listing the documentation structure with one-line descriptions of each subdirectory. Solves the "I opened docs/ and see 5 directories with no explanation" problem.

---

## Summary Assessment

| Dimension | Grade | Notes |
|-----------|-------|-------|
| **Can you run it?** | A | npm install && npm run dev works, clearly documented |
| **Can you understand it?** | C+ | Architecture info exists but is scattered and requires assembling from 5+ files |
| **Can you find things?** | C | No central index, two competing feature catalogs, orphaned research docs |
| **Can you contribute?** | D+ | Only one how-to guide exists (effects). All other contribution requires reverse-engineering |
| **Does CLAUDE.md help AI?** | B- | Build commands and patterns are excellent. Misleading Next.js section and German language reduce effectiveness |
| **Are common issues documented?** | B | Debugging.md and troubleshooting tables are solid. Missing: build warnings, GPU profiling, test debugging |
| **Is reading order clear?** | F | No reading order exists anywhere. New developer must discover their own path |

**Overall DX grade: C+**

The documentation is comprehensive in raw content but poorly organized for the developer journey. The codebase has excellent reference docs (GPU-Engine.md, effects-system.md, Debugging.md) but no tutorial-style docs that guide a developer from zero to productive. The highest-impact improvements are structural (create GETTING-STARTED.md, remove misleading Next.js section, add navigation) rather than content-creation.
