# MasterSelects Claude Code Instructions

@AGENTS.md

The pointer-focus hygiene and adjacent-control repair rules in section 9 of
`AGENTS.md` are mandatory for every Claude Code UI change as well.

## Repository destinations

Follow the repository guards in section 1 of `AGENTS.md`: the only target is
the public `Sportinger/MasterSelects`; the private repository is retired.
Never commit secrets or kernel code. Work on your own `task/<short-name>`
branch in its own worktree, never on `local` or `master` in the main folder
(branch model in section 1 of `AGENTS.md`).

## Nodes and effects: improve them whenever you touch them

Whenever dev work touches nodes, effects, operators, the stick-figure rig, or
the tools agents use to drive them (also while building a project or an
animation with them), leave them better than you found them:

- Fix limitations and bugs at their root in the node, effect, engine, or tool,
  not with workarounds in the project content. The next agent must not hit the
  same problem.
- Check whether the touched node can be more general or more robust, and harden
  related failure modes right away. Typical candidates: parameters that should
  be keyframeable or node-drivable, hard limits that should degrade gracefully,
  GPU state shared between layers or effect instances, and per-call settings
  that only one caller can use.
- Silent failure is a bug. When a node passes through, clamps, or ignores input,
  it must say so in a log, the inspector, or the tool result.
- Cover each improvement with a targeted test and the feature doc in
  `docs/Features/`, and name it in the commit.
