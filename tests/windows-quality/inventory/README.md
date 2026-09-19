# Inventory qualification tooling

Run from the workspace root; Python uses only the standard library and Node uses
only built-in modules. No installs, browser, provider calls or build are needed.

```powershell
python tests/windows-quality/inventory/validate_inventory.py --manifest tests/playwright/campaigns/windows-inventory.v1.json --source-root C:/Users/admin/Documents/MasterSelects/output/adaptive-quality/AQ-005/workspace
python tests/windows-quality/inventory/validate_inventory.py --manifest tests/playwright/campaigns/windows-inventory.v2.json --source-root . --git-repo C:/Users/admin/Documents/MasterSelects
python tests/windows-quality/inventory/qualify_inventory.py
node --test tests/windows-quality/inventory/layout.test.mjs
```

The qualification runner retains the existing 22 checks. Its optional
`--git-repo`, `--original-source-root`, and `--source-root` flags select read-only
inputs; defaults select the original repository, retained AQ-005 archive and this
workspace. Manifests are always loaded from `tests/playwright/campaigns` relative
to this tooling installation, independent of the current working directory.
Generated evidence and disposable fixtures live in this directory's ignored
`evidence/`; Python bytecode is ignored in `__pycache__/`. The Node test briefly
creates an exclusively owned Python fixture under campaigns, proves that the
actual unchanged `verifyCorpus` rejects it, removes it in `finally`, and proves
acceptance again. Run this bounded mutation test without concurrent corpus checks.

Only the two immutable JSON manifests belong under `tests/playwright/campaigns`.
Do not place scripts, README files, historical validator copies, qualification
output or bytecode there. Neither `campaign.mjs` nor either baseline reference is
changed. The missing snapshot `playwright.beta.config.ts` was restored from exact
pinned Git bytes for qualification; integration must retain that baseline file.

Historical AQ-005 source and AQ-010 evidence stay read-only in their original
`output/adaptive-quality/AQ-005/workspace` and `AQ-010/workspace` snapshots in the
original repository. Fresh AQ-014 evidence never overwrites those records.
Static validity is not Windows/editor runtime evidence or release eligibility.
