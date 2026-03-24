# What Was Merged: Master → Lemonade-Support

**Date:** 2026-03-20
**Merge:** `master` → `lemonade-support`
**Purpose:** Bring security, AI, and infrastructure updates from main project into your Lemonade integration branch

---

## The Bottom Line

You have **only 2 files** that are YOUR original Lemonade work. Everything else already existed in `master` — I didn't create anything new, just merged what was already there.

---

## 1. From Master (Main Project)

These files were NOT created during this merge. They already existed in `master` and were brought into your branch.

### Security Features
| File | Purpose |
|------|---------|
| `.github/workflows/security.yml` | GitHub Actions security scanning workflow |
| `docs/Features/Security.md` | Security feature documentation |
| `docs/plans/Security-Hardening-Orchestrator-Prompt.md` | Security hardening prompt template |
| `docs/plans/Security-Hardening-Plan.md` | Security improvement roadmap |
| `src/services/security/devBridgeAuth.ts` | Dev server authentication for AI bridge |
| `src/services/security/fileAccessBroker.ts` | Controls local file access permissions |
| `src/services/security/redact.ts` | Sensitive data redaction for logs/AI calls |
| `tests/security/devBridgeRoutes.test.ts` | Tests for dev bridge security |
| `tests/security/localFileAccess.test.ts` | Tests for file access controls |
| `tests/unit/logRedaction.test.ts` | Tests for log redaction |

### AI Tool Policy
| File | Purpose |
|------|---------|
| `src/services/aiTools/policy/index.ts` | AI tool policy module entry point |
| `src/services/aiTools/policy/registry.ts` | AI tool permission registry |
| `src/services/aiTools/policy/types.ts` | AI policy TypeScript types |
| `tests/unit/aiToolPolicy.test.ts` | Tests for AI policy enforcement |
| `tests/unit/redact.test.ts` | Tests for data redaction |

### Project & Media Infrastructure
| File | Purpose |
|------|---------|
| `src/services/project/mediaSourceResolver.ts` | Resolves media file sources for projects |
| `src/services/kieAiService.ts` | Kie.ai integration service |
| `docs/FOSSA-Attribution.html` | FOSSA license attribution report |
| `tests/unit/addVideoClip.test.ts` | Tests for video clip addition |
| `tests/unit/exportLayerBuilder.test.ts` | Tests for export layer building |
| `tests/unit/importPipeline.test.ts` | Tests for media import pipeline |
| `tests/unit/projectMediaPersistence.test.ts` | Tests for media persistence in projects |
| `tests/unit/thumbnailCacheService.test.ts` | Tests for thumbnail caching |

### MediaBunny Migration
| File | Purpose |
|------|---------|
| `docs/plans/MediaBunny-Deferred-Work.md` | MediaBunny follow-up tasks |
| `docs/plans/MediaBunny-Migration-Orchestrator-Prompt.md` | Migration orchestration prompt |
| `docs/plans/MediaBunny-Migration-Plan.md` | MediaBunny migration strategy |
| `src/engine/export/MediaBunnyMuxerAdapter.ts` | MediaBunny muxer integration |
| `tests/unit/mediaBunnyAdapter.test.ts` | Tests for MediaBunny adapter |

### MatAnyone (AI Segmentation)
| File | Purpose |
|------|---------|
| `src/components/common/MatAnyoneSetupDialog.tsx` | MatAnyone setup UI dialog |
| `src/components/common/settings/AIFeaturesSettings.tsx` | AI features settings panel |
| `src/services/matanyone/MatAnyoneService.ts` | MatAnyone segmentation service |
| `src/services/matanyone/index.ts` | MatAnyone module entry point |
| `src/stores/matanyoneStore.ts` | MatAnyone state management |
| `tools/native-helper/python/matanyone2_server.py` | Python server for MatAnyone2 |
| `tools/native-helper/src/matanyone/*.rs` | Rust bindings for MatAnyone (7 files) |

### Documentation Audit
| File | Purpose |
|------|---------|
| `docs/audit/phase1/*.md` | Initial codebase review (12 files) |
| `docs/audit/phase2/*.md` | Consolidated architecture docs (6 files) |
| `docs/audit/phase3/*.md` | Structure reviews (2 files) |
| `docs/audit/phase4/master-plan.md` | Project master plan |
| `docs/audit/phase6/*.md` | Verification docs (2 files) |

### Native Helper
| File | Purpose |
|------|---------|
| `src/services/nativeHelper/releases.ts` | Native helper release management |
| `tools/native-helper/assets/icon.ico` | Native helper application icon |
| `tools/native-helper/.wix/...` | WiX installer extension (Windows) |

### Assets & Misc
| File | Purpose |
|------|---------|
| `AI images/nb2_ms_icon_*.png` | MasterSelects icons (6 files) |
| `AI images/nb2_ms_icon_*_meta.txt` | Icon metadata (6 files) |
| `docs/images/video-poster.jpg` | Video poster/thumbnail image |
| `public/masterselects_github.mp4` | GitHub intro video |
| `tests/unit/version.test.ts` | Version info tests |
| `tests/unit/renderScheduler.test.ts` | Render scheduler tests |
| `tmp_cut_*.json` | Temporary cut data (2 files) |
| `tmp_cut_6_04.png` | Temporary cut preview image |
| `tmp_preview_capture.png` | Temporary preview capture |

---

## 2. From Your Lemonade Branch (YOUR Work)

These are the **ONLY 2 files** you originally created for Lemonade integration:

| File | Purpose |
|------|---------|
| `src/services/lemonadeProvider.ts` | Lemonade API provider - handles connection to Lemonade backend |
| `src/services/lemonadeService.ts` | Lemonade service - main integration logic for Lemonade features |

---

## Summary

| Category | File Count |
|----------|------------|
| From Master (existing project files) | ~70 files |
| From Your Lemonade Branch | **2 files** |
| **Total** | **~72 files** |

**Key Takeaway:** The merge brought ~70 existing files from `master` into your branch. Your actual Lemonade work is just the 2 service files above. Nothing was "created" during the merge — everything was copied from one branch to another.
