# Fast V2 Progressive Editor Tools Plan

Status: locally implemented and accepted; awaiting review/commit (2026-08-02)

## Goal

Fast V2 keeps planning, tool selection, categories, and reusable fast-path
orchestration private in `masterselects-kernel`. The public editor supplies the
current request context and a version-pinned catalog of atomic editor
operations, then validates and executes the kernel's concrete operation plans.

The provider starts with a small, fast tool surface. It can use a private fast
path immediately or browse one editor-tool category and then call the individual
tools revealed for that category. A missing fast path must never prevent the
agent from dropping down to the atomic tools.

## Security and ownership boundary

### Public editor owns

- Prompt transport, visual references, and the complete bounded snapshot of the
  open timeline, including available transcript and analysis data.
- Atomic editor-tool schemas and their local policy/risk classification.
- Contract validation, authorization, confirmation, exclusive mutation leases,
  transaction/undo handling, deterministic execution, and result projection.
- A flat, versioned catalog of allowed atomic tools. The catalog contains no
  private category descriptions, fast-path names, prompts, or orchestration.

### Private kernel owns

- Provider prompts, model routing, and tool-choice logic.
- Category names, descriptions, and the mapping from catalog tools to categories.
- Every fast-path capability and its compiler from intent to concrete public
  operation-plan steps.
- Progressive discovery (`browseEditorToolCategory`) and the provider-visible
  tool surface for the categories already opened during the turn.
- Durable journaling, replay protection, operation ordering, and verification.

### Explicit boundary rule

The editor may contain deterministic mechanics required to perform one atomic
mutation, but a provider-visible fast path must not be defined by or advertised
from the public editor. Existing compound tools can remain for compatibility,
but they are excluded from the progressive atomic catalog. New fast paths are
implemented as private kernel modules and compile to individual public steps.

## Reuse

The implementation reuses:

- Existing editor tool definitions and JSON parameter schemas.
- Existing AI-tool policy registry and caller checks.
- Existing WP1 operation-plan contracts, confirmation flow, transaction lease,
  result projection, and replay protection.
- Existing private range-removal, intercut, editable-hook, and hook-refinement
  capability registrations.
- Existing Fast V2 provider loop and durable journal.

No timeline-engine, renderer, text-editor, motion-editor, or UI rewrite is part
of this work.

## Implementation steps

1. **Publish a flat atomic catalog from the editor**
   - Build it from the canonical editor tool definitions and policy registry.
   - Exclude local/debug tools, external-device helpers, batch/control tools, and
     provider-facing compound fast paths.
   - Include only name, description, JSON parameters, and risk.
   - Canonicalize and pin the catalog with a SHA-256 digest shared by both repos.

2. **Validate the catalog at the kernel boundary**
   - Bound the catalog size, tool count, names, descriptions, and schemas.
   - Recompute the digest at start and restore; reject mismatches fail-closed.
   - Never accept operation authority from catalog contents alone.

3. **Own discovery and fast paths in the kernel**
   - Define the fixed category registry in the private repo.
   - Initially expose registered private fast paths plus
     `browseEditorToolCategory`.
   - After a successful browse call, expose the matching atomic tool schemas on
     the following provider round.
   - Let the provider browse further categories or mix discovered atomic tools
     with private capabilities as needed.

4. **Compile atomic calls into public operation plans**
   - Map read-only, mutating, and destructive catalog tools to separate pinned
     public operation IDs.
   - Include the exact tool request as bounded JSON; the editor independently
     re-parses it and verifies local catalog membership, risk, policy, and caller.
   - Combine compatible atomic calls returned in one provider round into one
     ordered plan so the editor can publish one transaction/undo point.
   - Preserve explicit confirmation for destructive effects.

5. **Keep cancellation end-to-end**
   - `New`, chat stop, abort, timeout, or disconnect aborts the provider request,
     outstanding operation waiters, and kernel turn work without replaying an
     unknown provider round.

6. **Verify only the affected paths**
   - Typecheck the public editor and private kernel.
   - Run focused catalog, contract, dispatcher, provider-loop, and cancellation
     tests; do not run the full test suite.
   - Run the cross-repository WP1 boundary check.
   - Through the localhost bridge, read the timeline first, send a request that
     needs an individual text/motion tool, and verify category discovery,
     operation execution, state change, and one undo point.

## Acceptance criteria

- The browser request contains a digest-valid flat atomic tool catalog and the
  complete bounded snapshot of the open timeline.
- No fast-path name or category definition is sourced from the public catalog.
- The first provider round contains private fast paths and the browse tool, but
  not the entire atomic tool surface.
- Browsing a category makes only that category's allowed atomic tools available.
- An atomic mutation is rejected if its name, risk, policy, catalog digest,
  revision, or operation contract does not match.
- Multiple compatible atomic edits from one round settle as one ordered editor
  transaction and one undo point.
- Existing private fast paths continue to work.
- The focused tests and real bridge scenario pass without committing or
  deploying the changes.

## Local acceptance result

- The public editor published 104 atomic tools in a flat, digest-pinned catalog;
  all 104 are assigned to private kernel categories.
- The coordinated per-provider-round tool-call ceiling is 256 in both repos.
  Payload-size and timeout bounds remain the primary protection for bulk edits.
- The private provider first loaded `text-motion`, then called the individually
  revealed `createMotionShapeClip` and `createTextClip` tools in the same round.
- The kernel compiled those two calls into one `timeline.editor.mutate.v1`
  operation and the editor executed them as one `AI task: createMotionShapeClip
  +1` history entry.
- The live bridge run completed successfully and created both temporary clips;
  the exact test clips were removed afterward and the timeline returned to 29
  clips.
- The public Cloudflare/D1 route was added to the coordinated boundary: it
  validates the same four generic operation IDs and their bounded projections
  before proxying results to the private kernel.
- Focused catalog, dispatcher, transport, policy, service, transaction,
  cancellation, D1-boundary, and cross-repository checks passed. Both repos
  typecheck. The full test suite was intentionally not run.

The atomic call group is one history transaction. The existing asynchronous
composition synchronization can still add a later derived history snapshot
after the provider turn; that is separate from the batch transaction and is not
part of this architecture migration.

## Non-goals

- Moving the timeline engine or rendering implementation into the kernel.
- Sending browser credentials, local file authority, or unbounded binary/frame
  data to the provider.
- Exposing development, QA, playback-simulation, import, or native-helper tools
  through progressive discovery.
- Committing, pushing, or deploying as part of this implementation pass.
