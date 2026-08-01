# MD3 Replicator Core Evidence

Date: 2026-07-31
Status: code/runtime matrix green; visible GPU evidence pending browser-control availability

## Supported-hardware CPU and buffer evidence

- CPU: AMD Ryzen AI 9 HX 370, 12 cores / 24 logical processors
- GPU: AMD Radeon 890M Graphics, driver 32.0.13062.3005
- OS: Windows 11 Home 10.0.26200 (build 26200)
- Node: v24.16.0
- Scenario: Linear Replicator, 10,000 instances, reference evaluation plus
  renderer-packet packing, two warmups and ten measured samples
- Median: 10.620 ms
- P95 / maximum: 26.335 ms
- Packed instance data: 480,000 bytes (10,000 × 12 float32 values)
- Command:
  `vitest run tests/unit/motionReplicatorPerformanceEvidence.test.ts --reporter verbose`

This measurement proves deterministic CPU evaluation and bounded instance-buffer
packing on the named machine. It does not claim a browser WebGPU presentation
measurement.

## Integration matrix

- 22 MD3 integration suites: 294 tests passed
- Dedicated performance evidence: 1 test passed
- TypeScript project build: passed
- Covered boundaries include Grid/Linear/Radial semantics, UI and AI parity,
  legacy migration, history/clipboard/load quarantine, split cloning,
  composition-scoped frame admission, repeated nested instances, exact export
  frame context, nested cache invalidation, aggregate-budget rejection, and
  main/nested/target/export consumer binding.

## 2026-08-01 integration recheck

- Combined MD3/MD6 foundation packet: 18 files / 133 tests passed.
- The dedicated 10,000-instance reference-evaluate-and-pack case passed again:
  18.139 ms median, 46.655 ms P95/maximum, and 480,000 packed bytes.
- This recheck remains CPU/buffer evidence only. It does not replace the open
  supported-browser WebGPU pixel/presentation proof below.

## Visible evidence — recorded 2026-08-01, gate closed

Captured in the disposable evidence session
`http://motion-md0-md3md6md7close.localhost:5173/?motionDesignEvidenceSession=md3md6md7close`
(bridge session `550e5921`, `projectFileOpen: false`, empty timeline; the open
user project was never touched).

- AI tool sequence: `createMotionShapeClip` (star, `clip-motion-shape-1785575572812-1-t20b0`,
  state revision 0→2) → `updateMotionProperties` (order-validated: setting
  `outerRadius` below the still-current `innerRadius` was rejected fail-closed,
  reordered call succeeded, revision 3→5) → `configureMotionReplicator`
  (grid 40×25, spacing 46×42, `expectedRevision` stale-write protection,
  replicator revision 1→2, state revision 7→9).
- `effectiveReplicator` reported `instanceCount: 1000` with
  `maxInstances: 100000` and the separate persisted `userLimit: 10000` —
  the four distinct limit concepts are live in the tool response.
- Screenshot [`md3/grid-1000-instances-webgpu.jpg`](./md3/grid-1000-instances-webgpu.jpg):
  the 40×25 grid of 1,000 stars rendered in the 1920×1080 preview.
- WebGPU adapter from the live session (`navigator.gpu.requestAdapter()`):
  vendor `amd`, architecture `rdna-3` (Radeon 890M), `maxTextureDimension2D`
  16384, features including `float32-filterable`, `bgra8unorm-storage`,
  `dual-source-blending`.
- The 1920×1080 `preview-canvas` holds a `webgpu` context: `getContext('webgpu')`
  returns it, `getContext('2d')` and `bitmaprenderer` return null. The grid is
  WebGPU-presented, not a software fallback. (Two transient
  `requestAdapter/requestDevice ... timed out after 2000ms` warnings appeared at
  boot; the retry succeeded.)

Together with the 10k CPU reference measurement and the 22-file/294-test
integration matrix above, `MD3_REPLICATOR_CORE_COMPLETE` is closed.
