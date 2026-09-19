# AQ-018 / AQ-R3: trusted campaign owned-process bridge

The qualified Windows Job Object supervisor and its concrete campaign adapter
live in the private Social sibling repository, under
`deploy/fassandra/repair/windows-campaign-supervisor.mjs`. Root independently
qualified and integrated the native 65-test and bridge 27-test selections; see
that repository's `WINDOWS-CAMPAIGN-BRIDGE.md` for exact scope and evidence.
No sibling implementation is duplicated here. Controller assembly and the actual
desktop campaign remain outstanding. This interface is
process cleanup for the fixed trusted beta campaign, **not isolation authorization
for arbitrary model-generated repairs**. Node tests below simulate the service;
they do not qualify Windows containment, native cleanup or a desktop campaign.

## Injection and ownership

The trusted controller imports `runCampaign(config, { trustedSupervisor, signal })`
and `recover(stateRoot, { trustedSupervisor })`. The adapter is an in-memory object
with `protocol: 'windows-campaign-owned-process-v1'` and four asynchronous methods.
No module path, executable override or adapter is loaded from run JSON. The CLI
continues using the old recorder, retaining its claim without process-tree cleanup.
An explicitly malformed injected adapter rejects instead of falling back to spawn.

`recordProcess` remains a low-level recorder/test seam, not an untrusted execution
endpoint. The campaign entry point still pins the original Playwright command,
corpus, manifest, output path, environment allowlist and grant validation.

Before any service call, a synced `supervision-intent` contains `binding`:

```text
protocol, ownershipId (fresh UUID), hostname, runId, manifestSha256,
workspace, leaseId, issuedBy, deadlineAt (absolute UTC, at most grant expiry)
```

The service returns `identity = { binding, serviceInstanceId, jobId }`. These are
opaque service incarnation / durable Job Object ownership identifiers, never a PID
or authority inferred from a PID. The recorder checks exact binding equality and
syncs `supervision-prepared` with that identity **before** invoking launch.
The service must durably index the intent ownership ID, including across recorder
crashes and service restarts. Missing state is unknown, never proof of absence.
Instance replacement must retain a verifiable old-ownership record, not silently
rebind it to a new Job Object.

## Required adapter methods

1. `prepare({ binding }) -> identity`. Authenticate the service and controller;
   consult the authoritative exclusive lease ledger for this exact host, run,
   manifest, workspace, issuer and cleanup scope. Reserve/register the owned job
   durably without starting the campaign. Independently enforce `deadlineAt`,
   lease revocation/expiry and controller-loss policy. A recorder timer, local JSON
   or AbortSignal is not the independent enforcement mechanism.
2. `launch({ binding, identity, command }) -> { completion: Promise<{exitCode, signal?}> }`.
   `command` contains executable, args, cwd, sanitized env, stdoutFile, stderrFile,
   `windowsHide: true`, `shell: false`. Open logs exclusively; do not overwrite.
   Atomically bind process creation to the registered Job Object **before code can
   run or spawn children**, using the existing qualified implementation. Enforce
   no breakaway/unowned descendants. Recheck the lease and absolute deadline at
   launch; one launch per ownership ID, with idempotent retry semantics. Do not
   forward arbitrary credentials. Completion is root exit only, not quiescence.
3. `stop({ binding, identity, reason }) -> acknowledgement`. Idempotently seal the
   ownership against all subsequent launches, including already-in-flight RPCs,
   and stop only its actually owned processes via the existing Job Object owner.
   Identity may be null if prepare failed/timed out: resolve via durable ownership
   ID or tombstone that ID so late prepare/launch cannot run. Never select a process
   by PID alone. Called on deadline, revoked/changed/unreadable grant, signal,
   persistence/adapter error, and root exit (to account for lingering descendants).
   An acknowledgement is **not** cleanup proof. The worker never kills a process.
4. `verifyQuiescence({ binding, identity, challenge }) -> receipt`. Read-only fresh
   authenticated external observation; null identity requires durable lookup by
   ownership ID, including the prepare/receipt crash window. Return exactly matching
   `binding`, `identity`, echoed `challenge`, nonempty `verificationId`, current
   `observedAt` (same Windows host clock, during request), and literal booleans:
   `launchSealed`, `ownedProcessesAbsent`, `ownedResourcesQuiescent`, all true.
   Verify the entire owned Job Object is empty and launch-fenced, plus owned Chrome
   profiles, native input drivers and port 4187 are quiescent. Attach/link the
   service's durable audit evidence to verificationId. Never infer these properties
   from root exit, missing PID, stale receipt, expired lease or missing service state.

The trusted adapter must authenticate the IPC/service receipt and protect its
state/transport; these JS shape checks and challenges are not cryptographic proof.
Run/report/model content must never supply the adapter or verification response.
The service must enforce explicit owned-browser cleanup authority and leave user
browsers/tabs/windows untouched. This task does not authorize a native cleanup run.

## Failure and reconciliation

RPCs are bounded (default 5 seconds); the absolute recorder deadline includes
prepare/launch time. A timed-out RPC is not cancellation: independent service
deadline enforcement and stop fencing are mandatory. Grant polling runs during
execution (default 1 second), validates the original grant rules and requires the
whole parsed grant to remain exactly equal; changed/revoked/unreadable grants
interrupt. `signal` adds prompt controller revocation. The external service must
observe revocation itself even when the recorder is dead or stalled.

The result retains interrupted status even if later cleanup succeeds. Exit zero
with missing/invalid quiescence becomes interrupted. Successful quiescence is
recorded in the terminal event and campaign outcome without altering report/corpus
rules. Unavailable service, journal failure or invalid evidence keeps ownership
uncertain and the claim held. Recovery performs fresh external verification only;
it does not stop anything. Prior terminal receipts alone are never accepted.

Even verified recovery returns `mayLaunch: false` with
`status: 'quiescent-awaiting-controller'` and `reconciliationReady: true`. No claim
is removed, archived, reset or retried here. The external controller still needs
an authenticated, serialized reconciliation transaction: fence the old recorder
and all pending work, retain/archive the entire claim and evidence, reconcile the
machine-wide lease, and issue a distinct fresh grant/run before another launch.
Quiescence alone does not prove a live recorder has stopped writing evidence.

## Qualification still required outside this task

Wire these four methods to the existing qualified supervisor, reconcile its actual
identity/lease/IPC schemas, and independently review the bridge. Demonstrate native
atomic assignment, descendant cleanup, no breakaway, deadline/revocation despite
recorder death, late RPC fencing, lost service/restart identity recovery, stale
receipt rejection, and preservation of unrelated user processes/browser windows.
Then qualify controller archival and fresh grant serialization. Only a separately
authorized available-desktop run can establish Windows/browser/GPU campaign evidence.
