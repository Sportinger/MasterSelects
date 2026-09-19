# MasterSelects Claude Code Instructions

@AGENTS.md

The pointer-focus hygiene and adjacent-control repair rules in section 9 of
`AGENTS.md` are mandatory for every Claude Code UI change as well.

## Repository destinations

Follow the checkout-specific guards in section 1 of `AGENTS.md`. The shared
private checkout keeps its private origin and automatic private publication.
Explicitly requested public AGPL source snapshots use an isolated checkout
and must not expose private history, internal documents, or kernel code.
