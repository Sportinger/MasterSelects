# Storyboard Plan Mode — G5 release evidence

Date: 2026-07-30
Decision: **GO for Storyboard G5**

## Release scope

F0, N0, C0, WP 0–12, and G1–G5 are implemented. The released product path
covers:

- provider-neutral, model-authored activity narration paired with authoritative
  runtime events;
- playable and editable storyboard scene cards with project/history
  persistence;
- Plan-mode tool policy that rejects real-media mutation and unapproved paid
  generation;
- animatic preview/export, candidate promotion, versioned briefs, exact
  approval, cancel/retry/restore, evidence, coverage, and duration reasoning;
- durable decisions and exact painted time+track range boundaries;
- three independently materialized options against one unchanged base,
  synchronized comparison, partial/failed readiness, refinement, stale
  detection, scoped commit, exact undo, rebase, and archive;
- built-in/custom templates with migration, mapping, merge/restructure, and a
  mandatory diff before destructive application;
- bounded, allowlisted telemetry, accessibility coverage, reload/stress
  journeys, and semantic AI tools for the complete variant lifecycle.

## Automated verification

| Check | Result |
|---|---|
| `npm run build` | PASS — TypeScript build and Vite production bundle; 10,363 modules transformed |
| `npm run lint` | PASS — 0 errors; 14 pre-existing warnings outside the Storyboard release scope |
| Complete Vitest repository run | PASS — 2,022/2,022 suites and 6,939/6,939 tests |
| Storyboard partition | PASS — 50/50 files and 199/199 tests |
| Original failing architecture boundaries after integration fixes | PASS — 5/5 files and 78/78 tests |
| F0/N0 and gate regression partition | PASS — 10/10 files and 37/37 tests |
| WP10 scoped commit/tool audit | PASS — 86/86 tests; direct tool/gateway contracts 14/14 |
| Generation partition | PASS — 16 files and 72/72 tests |
| Template release audit | PASS — 10/10 adversarial audit tests and 23/23 template tests |

Expected negative-path logs include Plan-mode policy denials, rollback messages,
and missing dummy media in a rollback fixture. They are asserted behavior, not
test failures. Vite also reports the existing bundle chunk-size warning above
6,000 kB; the production build succeeds.

## Browser smoke

The production UI was smoke-tested in the in-app browser against the local app:

- the editor loaded and the welcome/release/tutorial overlays could be closed;
- the Chat panel opened without a browser error;
- exactly one Plan toggle was visible, active, and exposed
  `aria-pressed="true"`;
- exactly one Decision policy control exposed automatic, milestones, and
  every-decision options with milestones selected;
- the three-option control exposed an honest inactive state and descriptive
  title;
- the chat composer exposed its expected placeholder;
- no application console error occurred. Only WebGPU adapter/device timeout
  warnings appeared in the headless browser environment.

## Acceptance mapping

The section 17.1 criteria are covered by the release journeys and partitions:

1. Plan-only creation/revision and mutation rejection: chat policy, kernel Plan,
   core tools, and release journey suites.
2. Versioned source/generated candidates and provenance: candidate store,
   adapter, generation, animatic candidate, and project codec suites.
3. Exact visible paid approval: generation approval/capability/submission
   suites.
4. Reload durability: project integration, activity persistence, generation
   restore, candidate media reload, decision, and variant suites.
5. Enforced time+track scope: range scope, fingerprint, isolation, materialize,
   and commit suites.
6. Three unchanged-base alternatives: variant state/materialization/comparison
   suites.
7. Honest partial/failure readiness: release journey, comparison, generation
   import/retry, and stress suites.
8. Scoped one-step commit and undo: WP10 commit and semantic-tools audits.
9. Stale rejection/rebase: commit, isolation, and semantic-tools audits.
10. Evidence/coverage/duration reasoning: coverage and coverage UI suites.
11. Storyboard/animatic before final video: core render, animatic, preview, and
    export suites.
12. Direct chat remains available outside Plan: chat service, provider
    transport, and F0/N0 regression suites.
13. Model narration plus runtime truth: narration, activity UI/persistence,
    bridge activity, accessibility, and browser smoke checks.

## Kernel Lite boundary

Kernel Lite remains parallel and non-blocking. K0–K3 public implementation,
contracts, replay/cancel/redaction, routing, telemetry, parity, and rollback
tests are technically green. Production canary acceptance is deliberately
**NO-GO** until external evidence proves:

- a real private production origin and reconnectable stream boundary;
- production signed identity into the authoritative D1 ledger;
- real Kie.ai execution with multi-instance encrypted short-TTL session
  storage;
- actual production hosted/BYO/Local routing, telemetry, parity, and latency
  budgets.

Accordingly, product gates G1–G5 are satisfied while K0–K3 remain active.
Detailed infrastructure evidence is in `hosted-agent-k0.md`,
`hosted-agent-k2.md`, and `hosted-agent-k3.md`.
