# Complete Refactor - P7 AI Tools Dev Bridge And Smokes

Source: split from `docs/ongoing/Complete-refactor.md` on 2026-06-09.

Back to index: [Complete-refactor.md](../Complete-refactor.md).

### Phase 7 - AI Tools, Dev Bridge, Guided Actions, And Smokes

Goal: keep AI/dev tooling powerful while preventing it from defining product
architecture.

Current codebase signals:

- `src/services/aiTools`: 18,008 LOC.
- `aiTools/index.ts`: 568 LOC.
- `aiTools/handlers/index.ts`: 575 LOC.
- `aiTools/bridge.ts`: 2,995 LOC.
- `timelineCanvasSmoke.ts`: 3,110 LOC.
- `torture.ts`: 46 `getState()` usages.
- AI bridge touches project service, HMR, execution, policy, debug export,
  project patching, and smoke plumbing.

Target shape:

- product AI tool execution
- caller policy/permissions
- guided replay orchestration
- handler registry
- dev bridge transport
- debug/smoke handlers
- browser/HMR bridge diagnostics
- smoke contracts reusable by refactor gates

Concrete targets:

- `aiTools/bridge.ts`: split transport, browser HMR client, request parsing,
  debug handlers, project debug helpers, and status/presence.
- `timelineCanvasSmoke.ts`: split into fixture setup, canvas assertions, user
  action simulation, and reporting.
- `aiTools/index.ts`: execute facade only; handler registry and policy stay
  separate.
- Dev-only code must not import product internals except through approved test
  and bridge contracts.
- Existing bridge handlers such as `getStats`, `getPlaybackTrace`,
  `debugExport`, and timeline canvas smokes become Phase 0 gate commands with
  thresholds before bridge source cleanup starts.

Gates:

- `P7_AI_TOOL_EXECUTION_FACADE`
- `P7_DEV_BRIDGE_QUARANTINED`
- `P7_SMOKE_HANDLERS_SPLIT`
- `P7_PHASE0_SMOKES_STABLE`
- `P7_GUIDED_ACTION_BOUNDARY`
- `P7_POLICY_REGISTRY_STABLE`

Checks:

- AI tool policy tests
- bridge status/list tests
- timeline canvas smoke tests
- guided action compiler/runtime tests
- debugExport bridge smoke

Do not:

- Do not delete bridge or smoke coverage before replacement gates exist.
- Do not let dev-only bridge transport define product architecture contracts.
- Do not broaden product internals to satisfy a bridge handler; add an approved
  test/bridge adapter instead.

