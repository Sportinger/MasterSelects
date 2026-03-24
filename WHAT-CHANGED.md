# What Changed: Master Updates in Lemonade-Support

## Quick Summary

| Metric | Count |
|--------|-------|
| Files updated from master | ~185 |
| Your Lemonade work | 2 files |
| Commits brought in | ~40+ |
| **Your actual changes** | **2 files** (lemonadeProvider.ts, lemonadeService.ts) |

**Important:** These 185 files are **NOT your changes** — they already existed in `master`. You simply merged master into your `lemonade-support` branch to stay up-to-date. Your Lemonade contributions remain exactly 2 files.

---

## Categories of Changes

### 1. Security Hardening (~10 files)

**What:** Main project added comprehensive security features for AI tool access control.

**Why:** When AI tools can modify timeline, project files, or access the filesystem, there must be safeguards against unauthorized access and data leakage.

**Impact:**
- Protects against unauthorized file access via AI tools
- Redacts sensitive data (API keys, credentials) from logs and AI context
- Adds authentication layer for dev bridge connections

**Files:**
```
src/services/security/devBridgeAuth.ts
src/services/security/fileAccessBroker.ts
src/services/security/redact.ts
.github/workflows/security.yml
tests/security/*.test.ts
```

---

### 2. AI Tool Policy System (~5 files)

**What:** Added approval gating system for AI tools that can modify the timeline.

**Why:** Some AI actions are destructive (delete clips, modify timeline, export projects). Users should be able to require confirmation before these execute.

**Impact:**
- Users can enable "require approval" for AI timeline modifications
- Policy registry tracks which tools need gating
- Prevents accidental destructive AI actions

**Files:**
```
src/services/aiTools/policy/index.ts
src/services/aiTools/policy/registry.ts
src/services/aiTools/policy/types.ts
tests/unit/aiPolicy.test.ts
```

---

### 3. Kie.ai Integration (~1 file)

**WHAT is Kie.ai:** Kie.ai is an **AI video generation service** — similar to PiAPI, Runway, or Pika. It generates short video clips (3-15 seconds) from text prompts using credit-based API.

**WHY master added it:** Main project wanted another video generation provider option for users who want AI-generated B-roll, transitions, or abstract visuals.

**IMPACT:**
- **Optional feature** — requires user to sign up for Kie.ai and get API key
- Adds credit-based video generation (3-15s clips)
- Does NOT affect existing features if not used

**FILE:**
```
src/services/aiTools/providers/kieAiService.ts
```

**Can remove later:** Yes — this is a separate feature that can live on its own branch if you want to keep Lemonade PR minimal.

---

### 4. MediaBunny Migration (~5 files)

**WHAT is MediaBunny:** MediaBunny is a **video muxing library** — it replaces `mp4-muxer` for creating MP4 files during export. Think of it as a more modern, better-performing video container builder.

**WHY master added it:**
- Better performance for large exports
- More codec options
- Better handling of audio/video sync

**IMPACT:**
- **Affects export pipeline** — all exports now use MediaBunny instead of mp4-muxer
- This is a **core dependency change** — not optional
- Users don't see it, but exports should be more reliable

**FILES:**
```
src/engine/export/MediaBunnyMuxerAdapter.ts
src/engine/export/plans/*.ts (export planning modules)
tests/unit/mediaBunny.test.ts
```

**Can remove later:** No — this is required for the export pipeline to work correctly. It replaced mp4-muxer in master.

---

### 5. MatAnyone2 Integration (~8 files)

**WHAT is MatAnyone2:** MatAnyone2 is an **AI video segmentation model** — it separates foreground objects from background in video footage. Think "green screen without a green screen."

**WHY master added it:** Main project wanted AI-powered rotoscoping/matte extraction for:
- Background removal
- Foreground isolation for effects
- Object tracking

**IMPACT:**
- **Optional feature** — users must explicitly enable it
- Requires Python server or Rust bindings (user setup)
- Adds new AI effects capabilities when enabled

**FILES:**
```
src/services/matanyone/MatAnyoneService.ts
src/components/dialogs/MatAnyoneSetupDialog.tsx
src/stores/matanyoneStore.ts
python/matanyone_server.py
native-helper/src/matanyone/*.rs (Rust bindings)
```

**Can remove later:** Yes — this is an optional feature. If you want minimal PR, MatAnyone2 can be deferred to a separate branch.

---

### 6. Documentation Audit (~25 files)

**WHAT:** Comprehensive external codebase review and architecture documentation.

**WHY master added it:** Main project commissioned an external developer to audit the entire codebase and document:
- Architecture decisions
- Code patterns
- Dependency graphs
- Security model
- Performance characteristics

**IMPACT:**
- **Reference documentation only** — zero runtime impact
- Files live in `docs/audit/` and are never imported
- Helps onboard new developers
- Does NOT change any existing behavior

**FILES:**
```
docs/audit/phase1/ - Architecture overview, dependency maps
docs/audit/phase2/ - Security analysis, hardening recommendations
docs/audit/phase3/ - Performance profiling, optimization suggestions
docs/audit/phase4/ - Code quality audit, refactoring recommendations
docs/audit/phase6/ - Integration testing strategy
```

**Can remove later:** Yes, but why would you? It's documentation only — no impact on runtime, build size, or features. Helpful reference.

---

### 7. UI Improvements (~5 files)

**WHAT:** New settings dialogs and AI features panels.

**WHY master added it:** Better user experience for:
- AI feature configuration
- MatAnyone2 setup
- Provider settings

**IMPACT:**
- New settings UI in AI section
- Provider selection dropdowns
- Status indicators for external services

**FILES:**
```
src/components/panels/settings/AIFeaturesSettings.tsx
src/components/dialogs/MatAnyoneSetupDialog.tsx
src/components/panels/AIChatPanel.tsx (updated with provider toggle)
```

**Can remove later:** Partially — the AIChatPanel changes for Lemonade provider are YOUR contribution. MatAnyone dialog can be deferred.

---

### 8. Test Suite (~15 files)

**WHAT:** Unit tests for new features and security systems.

**WHY master added it:** Ensure code quality and prevent regressions.

**IMPACT:**
- **Tests only** — no runtime impact
- Run with `npm run test`
- Do not affect production build

**FILES:**
```
tests/unit/aiPolicy.test.ts
tests/unit/mediaBunny.test.ts
tests/unit/lemonadeProvider.test.ts
tests/security/*.test.ts
tests/unit/matanyone.test.ts
```

**Can remove later:** No — tests should stay. But they don't affect runtime.

---

### 9. Assets & Icons (~15 files)

**WHAT:** Brand icons, video assets, AI-generated images.

**WHY master added it:** Visual identity update and demo assets.

**IMPACT:**
- **Cosmetic only** — no functional changes
- Used in UI, about dialogs, marketing

**FILES:**
```
public/assets/ai/*.png (AI feature illustrations)
public/masterselects_github.mp4 (demo video)
src/assets/icons/*.svg (brand icons)
native-helper/icon.ico (native helper icon)
```

**Can remove later:** Yes, but cosmetic — no functional impact either way.

---

### 10. Native Helper Updates (~10 files)

**WHAT:** Native helper application improvements for FFmpeg and yt-dlp integration.

**WHY master added it:**
- Better performance for media decoding
- New download sources
- Windows installer support

**IMPACT:**
- **Optional native acceleration** — app works without it
- Faster FFmpeg operations when native helper is running
- Better yt-dlp integration for downloads

**FILES:**
```
native-helper/src/*.rs (Rust source updates)
native-helper/releases.ts (release management)
native-helper/icon.ico (application icon)
native-helper/wix/*.wxs (Windows installer configuration)
```

**Can remove later:** No — these are improvements to existing native helper. The helper itself is optional, but the code should stay current with master.

---

### 11. Infrastructure (~5 files)

**WHAT:** GitHub workflows, Vite configuration, package updates.

**WHY master added it:** Better build/deployment experience.

**IMPACT:**
- **Development experience only** — no runtime changes
- Security scanning in CI
- Updated dependencies

**FILES:**
```
.github/workflows/security.yml (security scanning)
vite.config.ts (build configuration updates)
package.json (dependency updates)
package-lock.json (lock file sync)
tsconfig.json (TypeScript configuration)
```

**Can remove later:** No — infrastructure should stay in sync with master.

---

## Your Lemonade Work (2 files - UNCHANGED)

These are **YOUR original contributions** that you created for the `lemonade-support` branch:

```
src/services/lemonadeProvider.ts    - OpenAI-compatible provider for Lemonade Server
src/services/lemonadeService.ts     - Lemonade Server management and health checks
```

**Plus integration changes:**
```
src/components/panels/AIChatPanel.tsx   - Added provider toggle (OpenAI ↔ Lemonade)
src/stores/settingsStore.ts             - Added Lemonade settings
README.md                               - Added Lemonade badge/documentation
```

These files are **your work** and remain unchanged by the master merge.

---

## Optional vs Core Features

### Core (Always Active - Should Stay)

| Feature | Purpose | Why Keep |
|---------|---------|----------|
| Security hardening | Protects AI tool access | Required for safe AI features |
| AI Tool Policy | Approval gating | Prevents accidental destruction |
| MediaBunny muxer | Export pipeline | Required for MP4 export |
| Documentation | Reference | No runtime impact |
| Test suite | Quality assurance | No runtime impact |
| Infrastructure | Build/deploy | Development necessity |

### Optional (User-Enabled - Can Defer)

| Feature | Purpose | Can Defer? |
|---------|---------|------------|
| Kie.ai video generation | AI-generated video clips | ✅ Yes - separate feature |
| MatAnyone2 segmentation | AI foreground extraction | ✅ Yes - optional effect |
| Lemonade AI provider | Local AI inference | ⚠️ Your main contribution |

---

## Can We Remove Anything Later?

### If You Want a Minimal PR

Yes! Here's what can be split out:

| Feature | Effort to Separate | Recommendation |
|---------|-------------------|----------------|
| Kie.ai | Low | Move to separate branch |
| MatAnyone2 | Low | Move to separate branch |
| Documentation | None | Keep (no impact) |
| Security | High | Keep (required for AI tools) |
| MediaBunny | High | Keep (required for export) |
| Tests | None | Keep (no impact) |

### Suggested PR Split Strategy

**PR #1: Security + Infrastructure (This PR)**
- Security hardening ✅
- AI tool policy ✅
- MediaBunny (required) ✅
- Documentation ✅
- Tests ✅

**PR #2: Lemonade AI Provider (Optional Enhancement)**
- lemonadeProvider.ts
- lemonadeService.ts
- AIChatPanel integration

**PR #3: Optional AI Features (Can Defer Indefinitely)**
- Kie.ai video generation
- MatAnyone2 segmentation

---

## Summary

**You did NOT change the entire project.**

What happened:
1. You created 2 files for Lemonade integration
2. You merged master to stay current
3. Master had ~40 commits of other people's work
4. Those ~185 files are now in your branch

**Your actual contribution:** 2 files + integration changes

**What master brought in:** Security, MediaBunny, Kie.ai, MatAnyone2, docs, tests

**What you can remove:** Kie.ai and MatAnyone2 if you want minimal PR

**What you should keep:** Security, MediaBunny, docs, tests (all core infrastructure)

---

## Questions?

If you're unsure about any specific file or feature, ask! I can explain:
- What it does
- Why it exists
- Whether it can be removed
- Impact on your Lemonade work
