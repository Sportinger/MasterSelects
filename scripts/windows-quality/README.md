# AQ-004 Windows campaign adapter / AQ-009 corpus qualification (AQ-R3)

Additive Node adapter for the existing eight-case beta campaign at private source
`82631b1d2a58cdf33fe8256127adb9053294a9f3`. It does not implement a new browser
framework, install packages, weaken assertions, start shared dev services, upload
evidence or implement release eligibility. Existing beta sources/config are untouched.

## Integration contract

The trusted scheduler supplies an **isolated source and dependency workspace** with
local `node_modules` (junctions/ancestor package resolution are refused), all five
hydrated reference media files at their existing paths, and a source archive receipt.
No clone, install or media copy is performed. The source revision is caller-attested;
the adapter does not consult Git ancestors. Exact input hashes detect subsequent
changes, including added/deleted files in pinned roots. `baseline-corpus.json` is
retained byte-for-byte as historical `aq004-crlf-archive-v1`; it describes the
original CRLF-converted AQ-004 archive, not the Git blobs. Proposed
`baseline-corpus.git-v2.json` pins the exact Git object bytes of the same 38 paths.
The controller must review this AQ-009 reference revision before integration.
Future executable corpus revisions still require independent qualification.

The scheduler must maintain one canonical `stateRoot` for this physical desktop,
authenticate the grant issuer, reserve port 4187 and prevent overlapping grants
across callers/tools. A local claim only serializes adapters using that same root.
JSON grant fields alone are **not authentication**. Keep state/manifest/digest under
controller-owned ACLs; write-once files plus externally retained SHA-256 detect
accidental mutation, not an attacker with write access to both records and digests.

Create a freeze config (paths below are illustrative, not supplied workspaces):

```json
{
  "workspace": "C:\\quality\\isolated-editor",
  "workspaceId": "archive-82631b1-a1",
  "isolated": true,
  "sourceHash": "82631b1d2a58cdf33fe8256127adb9053294a9f3",
  "environment": {
    "browserVersion": "actual installed Chrome version",
    "gpu": "actual physical GPU model",
    "driver": "actual driver version",
    "ffmpegVersion": "actual ffmpeg version",
    "dependencyDigest": "controller-verified dependency artifact digest"
  },
  "manifestFile": "C:\\quality\\state\\manifest-a1.json"
}
```

Run `node scripts/windows-quality/cli.mjs freeze <freeze-config.json>`. This does
not launch the harness. It streams fixture hashes without copying media. Capture
the returned `sha256` in the trusted scheduler before any execution. A manifest
cannot be overwritten; revisions and retries require new paths/IDs.

The authenticated controller must issue the following grant only for an available,
unlocked dedicated Windows desktop. Existing test-owned Chrome termination and
temporary-directory cleanup are part of the campaign and require explicit scope.

```json
{
  "resource": "windows-interactive-desktop",
  "exclusive": true,
  "desktopAvailable": true,
  "allowOwnedBrowserCleanup": true,
  "hostname": "EXACT-WORKER-HOSTNAME",
  "workspace": "C:\\quality\\isolated-editor",
  "manifestSha256": "SHA256-RETURNED-BY-FREEZE",
  "leaseId": "controller-lease-123",
  "issuedBy": "authenticated-controller-identity",
  "notBefore": "CONTROLLER-ISSUED-UTC-TIME",
  "expiresAt": "CONTROLLER-ISSUED-UTC-DEADLINE"
}
```

Run config: `manifestFile`, `manifestSha256`, `grantFile`, `stateRoot` (existing
canonical directory), unique safe `runId`, positive integer `maxRuntimeMs` fitting
within the grant. Invoke `node scripts/windows-quality/cli.mjs run <run-config.json>`.
Only this command launches the existing local Playwright CLI with the unchanged
beta config: no grep, retry, reporter, worker or command override. Port 4187 must
be free; no shared server is reused/restarted. The existing harness creates fresh
profiles/projects and its isolated bridge token. The adapter forwards only basic
OS environment variables, not arbitrary provider credentials or Node overrides.
The caller must provision a sanitized workspace without credential-bearing dotenv
files; Vite's existing dotenv behavior is not replaced by this adapter.

## Evidence, verdict and restart behavior

`stateRoot/desktop-claim` is created exclusively before launch. It retains synced,
write-once numbered lifecycle/heartbeat events, supervisor/direct-child identity,
stdout/stderr, run pointer, evidence hash index and `verdict.json`. The existing
harness writes its HTML/JSON/artifacts under `output/windows-beta/aq-<runId>`;
the adapter does not remove them. Receiver outages cannot erase local records
because there is no delivery dependency. A downstream delivery adapter should use
`runId + manifestSha256 + reportSha256` as its idempotency key and append delivery
receipts separately; transport/retry integration is not implemented here.

Passing requires all eight exact case/project identities, exactly one passing
attempt each, expected-pass status, no skips/flaky retries/global errors, matching
aggregate counts and exit 0. Required beta evidence attachments must exist;
file attachments must be nonempty, inside output, and hashable. Original reports
and failed attempts are never rewritten to make a later run green. A passing
campaign is neither full inventory completion nor release authorization.

Invoke `node scripts/windows-quality/cli.mjs recover <config.json>` with `stateRoot`
after restart. It re-reads durable state and probes persisted PIDs read-only.
Live PIDs remain **identity unverified** (PID reuse is possible); permission errors,
foreign hosts, absent identity, empty claims and truncated events block launch.
A dead supervisor produces an interrupted recovery record, never an automatic
retry. No process is killed using persisted PID authority.

**Even after pass, timeout or expiry, the claim is retained.** A trusted external
supervisor must prove all owned descendants, Chrome profiles, native input drivers
and port 4187 are quiescent, then archive the entire claim without discarding
evidence before authorizing another attempt. Expiry is not permission to steal a
desktop with unaccounted-for processes. This adapter records deadlines but does
not terminate the process tree: a child can outlive the recording deadline.
AQ-018 adds an explicit trusted supervisor injection path described in
[SUPERVISOR-CONTRACT.md](./SUPERVISOR-CONTRACT.md). That path delegates launch,
deadline/revocation cleanup and fresh external quiescence verification, with durable
ownership recorded before launch. The existing CLI/default still behaves as above.
The actual Windows Job Object bridge, machine-wide lease-service integration and
controller archival remain required before unattended operation. Even externally
verified recovery never clears the claim or authorizes another launch by itself.

## Qualification boundary

Environment GPU/driver/browser/FFmpeg and dependency digest are pinned **caller
observations**, not independent measurements by this adapter. Node/OS/host are
recorded locally. Runtime hardware/media-provenance attachments are retained but
not semantically compared to every declared environment field; the independent
verifier must do that reconciliation. Dependency contents beyond the pinned CLI,
Playwright package version, Vite launcher and lockfile depend on the caller's
immutable dependency receipt. No arbitrary external binary execution is added to
discover versions. Neither browser/GPU success nor successful production
freeze/run has been demonstrated in this dependency-free snapshot.

Focused checks: `node --test tests/windows-quality/adapter.test.mjs tests/windows-quality/corpus.test.mjs`. They use only
small real files and harmless Node children, retaining evidence under
`tests/windows-quality/evidence` relative to the test module, independently of cwd.
Synthetic reports/artifacts exercise the adapter;
they are not qualification evidence for the editor. No native UI is started.

## AQ-009 provenance correction and independent qualification

The Git readiness.ts SHA-256 is
`97adc43b436c239f0cb84d1d284894ec4d854d8e1cb69b72cc81fc0d14d21258`;
the historical CRLF archive hash is
`9196d1203376bfd9845bb43befe0fea27aba36457086b72dbe903891a35fe2d4`.
All 38 historical hashes were reproduced by reconstructing CRLF **test fixtures**
from exact pinned Git bytes. The proposed reference and compressed fixture were
derived using Buffer-returning `git show <pinned-revision>:<path>` calls, with blob
IDs recorded and the complete tree path set checked using `git ls-tree`.
No candidate source supplied reference bytes. Neither validator normalizes bytes.

`tests/windows-quality/derive-corpus.mjs <original-git-repo> --check` independently
repeats those read-only Git queries and requires byte-identical reference/fixture
outputs. `--write` is a manual offline derivation step for this fixed revision,
never a campaign operation or a means to accept candidate bytes. The retained
gzip fixture makes unit tests self-contained: Git access, packages, media, and a
working tree matching the historical campaign are not prerequisites. Tests verify
the fixture SHA-256, each SHA-256 and Git blob ID, all 38 historical hashes, and
the unchanged path set. `.gitattributes` preserves both reference files exactly.

New manifests use campaign `existing-windows-beta-eight-v2`, plan `AQ-R3`, and an
explicit `corpus` receipt containing `git-object-v2`, the reference file SHA-256,
and later metadata hashes. Reference bytes must match the verifier's fixed digest.
Run verification rejects old/missing/tampered identities, modified source, and
changed metadata. Historical manifests/evidence remain historical; they must not
be relabeled or rewritten. A newly reviewed freeze is required for a new run.

The only additional inventory allowance is direct, case-sensitive `.json` files
under `tests/playwright/campaigns/`, with conservative filenames and JSON object
contents. These are later AQ-005 inventory descriptions, not executable tests.
Every previously pinned file, including JSON, retains exact checks. New scripts,
nested files, malformed JSON, and changed harness/config imports are rejected.
The pinned beta config discovers only `beta/**/*.spec.ts`; the unchanged harness
does not load the new campaigns metadata. This is not a general extension ignore
or permission to add executable dependencies. If a future harness consumes these
descriptions, its source change requires a separately reviewed corpus revision.
Full manifest `inputs` still inventory **all** Playwright files, including metadata;
their additions/deletions/changes after freeze invalidate that run. Metadata itself
does not prove AQ-005 inventory coverage or qualify any new scenario.

Qualification preserves all eight case identities, actions, assertions, temporal
negative controls, media hashes, report requirements, and artifact checks. The
old/proposed matrix accepts each validator's declared byte-format fixture and
rejects the opposite format. Both reject identical seeded byte alteration,
addition, deletion, file deletion, and executable addition controls. Additional
tests mutate/delete every pinned file, exercise metadata boundaries, and show the
actual campaign verifier rejects an unqualified corpus with a valid corpus ID.
Unique `qualification-*/matrix.json` evidence records preserve separate runs.
This establishes offline reference integrity and regression detection only;
Windows/browser/GPU campaign execution and trusted-controller promotion remain
pending. It is not product-fix evidence or release authorization.

## Complete Pages artifact qualification

`qualify-pages-artifact.mjs` accepts explicit absolute paths for `--workspace`,
`--runtime`, `--evidence`, `--frontend-reference` and `--dependencies`. The evidence
directory must be new and contained in the supplied workspace. The current
qualification pins the reviewed baseline and Wrangler 4.118.0, compares the actual
frontend report and source/dependency inventories, and compiles Functions twice.
Equal worker, routes and routes-config bytes are required before staging.

`pages-artifact.mjs` seals the exact frontend and compiled worker together with
routes and private configuration sidecars. It checks the input-to-staged mapping
and inventories again after copying. Incomplete attempts are retained without a
success seal; a retry requires a new destination. Verification requires the
independently retained seal hash and repeats both byte and input-mapping checks.
Only `assets/` is public payload; the other sidecars must not be served as assets.
The producer's `expectedBaseline` is an explicit host-selected source revision;
omitting it retains the historical `82631b1d` qualification pin. Verification must
receive the same independently retained revision and seal hash. A package cannot
select its own trusted revision. The existing qualification CLI remains pinned to
its historical reference report. The Functions subprocess uses a fresh temporary
`HOME` as well as Windows profile paths, so Linux sandbox builds need no account
home or inherited credentials.
Schema v2 deliberately rejects older v1 seals and is not automatically accepted
by a release gate. Current packages have 446 payload files for the 441-file
frontend, plus `seal.json`.

Run the filesystem regression controls with
`node --test tests/windows-quality/pages-staging-integrity.test.mjs`. They retain
the exact original adapter as a byte-pinned fixture and exercise identical
original/fixed mutation, addition and deletion checkpoints. These synthetic
controls complement the separate real-artifact qualification; neither authorizes
deployment. Browser, authenticated API, production binding/database compatibility,
recovery and deployment checks remain required.

## Qualified Playwright resource directories

`playwright-directory-map.mjs` derives the three browser-owning case directories
from the pinned Playwright 1.62.1 implementation. It verifies the manifest bytes,
frozen corpus, command, titles, project, run paths and fourteen runtime file pins.
The qualification document has an independently pinned SHA-256. The controller
must retain the mapping receipt digest separately and validate its run binding
before using the exact names in the native resource observer.

Run the seven naming checks with `AQ048_RUNTIME_ROOT` set to the absolute path of
the qualified read-only runtime checkout, then
`node --test tests/windows-quality/playwright-directory-map.test.mjs`.
The actual Playwright runner executes three synthetic Node-only tests to compare
`testInfo.outputDir`; this does not launch Chrome or execute the editor cases.
Both independent and integrated checks passed. A new harness corpus or runtime
requires a separately reviewed qualification; old receipts do not authorize it.
The maintainer generator creates proposed evidence only. Mapping grants no
desktop access, resource deletion authority or deployment eligibility.
