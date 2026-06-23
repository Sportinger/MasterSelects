# Ongoing Plans

`docs/ongoing/` is only for active or deliberately open planning context. Move
completed implementation plans to `docs/completed/` and leave a short status
note here when a plan still has unresolved gates or intentionally deferred work.

## Active Or Open

| File | Status | Why It Stays Here |
|---|---|---|
| [Native-Helper-Codec-Service.md](./Native-Helper-Codec-Service.md) | Draft plan | Native helper codec commands are not implemented server-side yet. |
| [Kie-AI-Generation-Chatbox-Expansion.md](./Kie-AI-Generation-Chatbox-Expansion.md) | Active implementation | Tracks Kie.ai service expansion, Suno tuning control fix, and model-specific prompt-refiner profiles for FlashBoard. |
| [Kie-AI-Magic-Wand-Research-Ledger.md](./Kie-AI-Magic-Wand-Research-Ledger.md) | Active source ledger | Source-backed June 2026 model guidance for FlashBoard prompt-refiner profiles. |
| [Pixel-Particle-Disintegration-Fade-plan.md](./Pixel-Particle-Disintegration-Fade-plan.md) | Draft plan | The pixel-particle fade effect is future work and has an unchecked acceptance checklist. |
| [Worker-First-Playback-Renderer.md](./Worker-First-Playback-Renderer.md) | Active architecture plan | Foundations and evidence tooling are merged, but Mac Safari/Firefox platform packages and later worker-renderer gates remain open. |
| [Worker-First-Playback-Renderer-checklist.md](./Worker-First-Playback-Renderer-checklist.md) | Active checklist | Tracks merged packets plus remaining platform and debt gates. |
| [Worker-First-Playback-Renderer-handoff.md](./Worker-First-Playback-Renderer-handoff.md) | Active handoff | Current execution handoff for the worker-first workstream. |
| [Worker-WebGPU-Playback-Presentation.md](./Worker-WebGPU-Playback-Presentation.md) | Active focused plan | Direct strict `worker-gpu-only` WebGPU playback presentation plan, including parallel Codex packet waves and no CPU/software fallback route. |
| [Playback.md](./Playback.md) | Supporting investigation note | Kept as context for the worker-first renderer until those remaining gates close. |
| [Transition-suite-extra-plan.md](./Transition-suite-extra-plan.md) | Mostly implemented with deferred candidates | Current transition suite is implemented; deliberately planned items such as Datamosh, Smooth Cut/Flow, AI/neural transitions, Liquid Melt, and true panel/mesh effects remain unimplemented. |

## Recently Archived

| File | New Location | Reason |
|---|---|---|
| `Transition-suite-plan.md` | [../completed/plans/Transition-suite-plan.md](../completed/plans/Transition-suite-plan.md) | First-pass transition suite was merged and is now historical context. |

## Cleanup Rule

Before moving a file out of this directory, verify the implementation or closing
decision in code/docs and add an archive status banner in the destination file.
