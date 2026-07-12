# Ongoing Plans

`docs/ongoing/` is only for active or deliberately open planning context. Move
completed implementation plans to `docs/completed/` and leave a short status
note here when a plan still has unresolved gates or intentionally deferred work.

## Active Or Open

| File | Status | Why It Stays Here |
|---|---|---|
| [Browser-Local-Background-Removal-Plan.md](./Browser-Local-Background-Removal-Plan.md) | Planning | Browser-local background removal is still open. |
| [Screen-Capture-Panel-Plan.md](./Screen-Capture-Panel-Plan.md) | Manual validation pending | P1-P9 implementation and local build/lint/test gates are green; real picker/audio/crop, 10-minute memory, interrupted-tab recovery, pushed Security Checks, and final archive remain open. |
| [Native-Helper-Codec-Service.md](./Native-Helper-Codec-Service.md) | Draft plan | Native helper codec commands are not implemented server-side yet. |
| [Transition-Nested-Composition-Architecture.md](./Transition-Nested-Composition-Architecture.md) | Runtime smoke pending | Transition rendering is now statically rebuilt as hidden nested compositions; Bridge/export smoke checks still need approval. |

## Recently Archived

| File | New Location | Reason |
|---|---|---|
| `Kie-AI-Generation-Chatbox-Expansion.md` | [../completed/plans/Kie-AI-Generation-Chatbox-Expansion.md](../completed/plans/Kie-AI-Generation-Chatbox-Expansion.md) | Archived after docs triage; not active ongoing work. |
| `Kie-AI-Magic-Wand-Research-Ledger.md` | [../completed/plans/Kie-AI-Magic-Wand-Research-Ledger.md](../completed/plans/Kie-AI-Magic-Wand-Research-Ledger.md) | Archived after docs triage; source ledger is historical context. |
| `Pixel-Particle-Disintegration-Fade-plan.md` | [../completed/plans/Pixel-Particle-Disintegration-Fade-plan.md](../completed/plans/Pixel-Particle-Disintegration-Fade-plan.md) | V1 is implemented and verified; remaining notes are archive context. |
| `Playback.md` | [../completed/plans/Playback.md](../completed/plans/Playback.md) | Archived with worker-first playback planning context. |
| `Transition-suite-plan.md` | [../completed/plans/Transition-suite-plan.md](../completed/plans/Transition-suite-plan.md) | First-pass transition suite was merged and is now historical context. |
| `Transition-suite-extra-plan.md` | [../completed/plans/Transition-suite-extra-plan.md](../completed/plans/Transition-suite-extra-plan.md) | Archived after docs triage; deferred candidates are not active unless reopened. |
| `Worker-First-Playback-Renderer.md` | [../completed/plans/Worker-First-Playback-Renderer.md](../completed/plans/Worker-First-Playback-Renderer.md) | Archived after docs triage; worker-first renderer workstream is not active ongoing work. |
| `Worker-First-Playback-Renderer-checklist.md` | [../completed/plans/Worker-First-Playback-Renderer-checklist.md](../completed/plans/Worker-First-Playback-Renderer-checklist.md) | Archived with worker-first playback planning context. |
| `Worker-First-Playback-Renderer-handoff.md` | [../completed/plans/Worker-First-Playback-Renderer-handoff.md](../completed/plans/Worker-First-Playback-Renderer-handoff.md) | Archived with worker-first playback planning context. |
| `Worker-WebGPU-Playback-Presentation.md` | [../completed/plans/Worker-WebGPU-Playback-Presentation.md](../completed/plans/Worker-WebGPU-Playback-Presentation.md) | Archived with worker-first playback planning context. |

## Cleanup Rule

Before moving a file out of this directory, verify the implementation or closing
decision in code/docs and add an archive status banner in the destination file.
