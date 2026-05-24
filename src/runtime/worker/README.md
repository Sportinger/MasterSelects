# Worker Runtime Slice

`WorkerRuntimeHost` is the testable core. It owns job state, handler dispatch,
progress/log/diagnostic emission, cancellation, and transferable output lists.
It does not import stores, render services, or project state.

`src/workers/runtimeHost.worker.ts` is only the browser adapter. It attaches the
host to `self` and wires `postMessage`/`message` to the shared protocol. Vitest
runs in `jsdom`, so unit tests exercise the host core with the same handler
functions and real `ArrayBuffer` payloads instead of depending on browser Worker
availability.

Provider workers can either import `attachRuntimeWorkerHost` and pass their own
handler registrations, or use `RuntimeJobClient` against `runtimeHost.worker.ts`
for the built-in probe handlers:

- `runtime.echo`
- `runtime.hash.sha256`
- `runtime.csv.inspect`

Future integration points are capability checks before enqueue, provider
manifest discovery, and artifact-store writes after completion.

