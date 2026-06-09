# Complete Refactor - P8 Tests And Architecture Gates

Source: split from `docs/ongoing/Complete-refactor.md` on 2026-06-09.

Back to index: [Complete-refactor.md](../Complete-refactor.md).

### Phase 8 - Test Suite Refactor And Architecture Gates

Goal: make tests support the new architecture instead of preserving old god
objects.

Current codebase signals:

- large tests over 1,500 LOC include:
  - `projectMediaPersistence.test.ts`: 3,622
  - `timelineArchitectureRegistry.test.ts`: 3,074
  - `clipSlice.test.ts`: 2,554
  - `timelineEditOperations.test.ts`: 2,312
  - `fileManageSlice.test.ts`: 2,284
  - `serializationNestedRestore.test.ts`: 1,995
  - `layerBuilderService.test.ts`: 1,975
  - `addCompClipNestedRestore.test.ts`: 1,963
  - `layerCollector.test.ts`: 1,920
  - `keyframeSlice.test.ts`: 1,878

Target shape:

- tests move with behavior, not old filenames
- architecture gates cover import direction, runtime-free schemas, LOC budgets,
  retired path classification, and smoke availability
- large tests split by user behavior or contract
- tests that only assert retired implementation details are deleted after
  replacement coverage exists

Gates:

- `P8_TEST_MIGRATION_LEDGER_COMPLETE`
- `P8_LOC_BUDGET_GATE`
- `P8_IMPORT_BOUNDARY_GATE`
- `P8_RUNTIME_FREE_SCHEMA_GATE`
- `P8_RETIRED_PATH_GATE`
- `P8_SMOKE_COVERAGE_GATE`

Checks:

- targeted migrated tests per domain
- architecture gate suite
- full build/lint/test only at normal commit/merge/readiness points

Do not:

- Do not keep tests that assert obsolete god-object internals after a new
  public contract owns the behavior.
- Do not delete large tests only to satisfy LOC budgets; split, port, replace,
  or explicitly retire them with coverage notes.
- Do not mark an architecture gate closed until it is executable or has an
  accepted temporary exception with owner and expiry.

