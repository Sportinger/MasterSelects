# ADR-001: Fast V2 Orchestration Is Kernel-Owned

- Status: Accepted
- Date: 2026-08-02
- Applies to: `MasterSelects` and `masterselects-kernel`

## Decision

All provider-facing agent orchestration belongs in the private
`masterselects-kernel` repository. This includes prompts, categories, tool
selection guidance, fast paths, multi-step composition logic, recovery
strategies, and compilers that translate an intent into concrete editor
operations.

The public `MasterSelects` editor may define and implement atomic editor tools.
It owns their parameter schemas, local risk policy, authorization,
confirmation, transaction/undo behavior, deterministic mutation, and bounded
result projection. The editor sends the user's prompt, references, the complete
bounded state of the open timeline (including available analysis/transcript
data), and a pinned flat catalog of allowed atomic tools to the kernel.

The public catalog must not contain private category descriptions, fast-path
names, provider prompts, selection heuristics, or workflow recipes. The private
kernel assigns atomic tools to categories and exposes them progressively to the
provider. A fast path compiles to explicit public operation-plan steps; the
editor validates and executes those steps without deciding the workflow.

Source intelligence is media-owned at the public operation boundary. Transcript,
visual/face analysis, and scene-description artifacts are projected once per
media source in the bounded semantic snapshot; timeline clips reference that
record by stable source identity instead of repeating the full artifacts after
split operations. Clip-local transforms, effects, masks, timing, and overrides
remain clip-owned.

## Rule for future changes

When adding a capability, first decide which kind it is:

1. A genuinely new atomic editor action requires an editor tool definition,
   local handler, policy, public operation compatibility, and coordinated
   catalog-digest update.
2. A new way to combine, choose, sequence, retry, or visually review existing
   actions is a private kernel capability. Do not implement it as a new public
   provider-facing editor fast path.

Existing public compound handlers may remain for compatibility while they are
migrated, but they are not added to progressive discovery and are not precedent
for new architecture.

## Consequences

- Proprietary agent behavior remains private and can evolve independently of
  the editor implementation.
- The editor remains the final security and state-integrity authority.
- Fast initial requests stay small, while the model can browse categories and
  drop down to individual tools when a fast path is insufficient.
- Adding or changing atomic tools is a coordinated two-repository contract
  change because the catalog and public operation contracts are digest-pinned.

## Enforcement

- Browser catalogs are flat, bounded, and digest-pinned.
- Kernel startup and journal restore recompute and verify the catalog digest.
- Kernel category mappings reject uncategorized catalog tools.
- The editor revalidates every requested inner tool against its own catalog,
  risk classification, caller policy, and accepted operation plan.
- The public Cloudflare/D1 proxy mirrors the pinned operation-ID and projected
  result boundary. It may validate and relay operations, but it must not own
  provider prompts, categories, fast-path selection, or orchestration.
- Focused cross-repository tests keep the public and private pins synchronized.

## Related implementation plan

See
[Fast V2 Progressive Editor Tools Plan](../ongoing/Fast-V2-Progressive-Editor-Tools-Plan.md).
