# Playwright headed UI suite

This package is the real-browser layer above Vitest and the bridge-driven
verification runners. Feature actions under test must be performed through
Playwright locators, mouse, pointer, keyboard, file chooser, or download APIs.
The Dev Bridge may arrange deterministic state and inspect results, but must not
replace the UI action being verified.

## Local commands

```text
npm run test:e2e:ui
npm run test:e2e:headed
npm run test:e2e:smoke
npm run test:e2e:module -- --grep @module:masks
npm run test:e2e:canary
npm run test:e2e:nightly
npm run test:e2e:built
npm run test:e2e:release
npm run test:e2e:report
```

- `ui` opens Playwright UI mode for authoring and debugging.
- `headed` runs the selected suite in visible installed Chrome.
- `smoke` runs `@smoke` and Foundation journeys.
- `module` accepts a module tag through `--grep`.
- `canary` and `release` derive their module filters from
  `config/moduleGates.ts`; `release` includes only `required` modules.
- `built` creates the deploy artifact and checks it without the Dev Bridge.
  It creates a project through the current chooser using real browser storage
  (native file pickers disabled), then checks Preview transport and Export.
  The Windows beta journey separately covers native folder selection.
- `release` runs the full repository build/type gate, the built smoke, then the
  required headed Dev Bridge journeys.
- `report` opens the latest HTML report without rerunning tests.
- `nightly` runs only the long journeys under `nightly/` (see below).

Google Chrome Stable must be installed. The suite uses a fresh Playwright
BrowserContext and never a personal Chrome profile. Tests run serially with one
worker because media, GPU, audio, bridge, and filesystem state are not yet
qualified for parallel execution.

The default bootstrap uses the visible Choose project dialog to create a unique
project in that context's browser storage. Native file pickers are disabled only
for this portable entry flow; the Windows beta profile keeps its native folder
selection. Any autosave writes stay in the disposable context's test project.

## Nightly journeys

Long journeys (large exports, hour-long sources) live under `nightly/`. They are
excluded from every other run through `testIgnore`, including the Fassandra
auto-repair acceptance, which resets `grep` but keeps `testIgnore`; a `skip`
would fail that acceptance. Include them with `npm run test:e2e:nightly` or
`MASTERSELECTS_E2E_NIGHTLY=1`. Nightly journeys keep large sources and exported
files in the OS temp folder, delete exports after their checks and attach a JSON
summary instead: a test host returns at most 512 MB of evidence per run.

## Module and test tags

Every journey carries its canonical `@module:*` tag. Add `@smoke` only to the
short release-confidence path. Gate promotion happens only in
`config/moduleGates.ts`:

- `draft`: explicitly runnable by module only;
- `canary`: reported separately and non-blocking in release automation;
- `required`: blocking, zero-retry release coverage.

Do not mark a module `canary` or `required` before its deterministic test and
failure evidence exist.

## Runtime controls

The default server is Vite on `http://127.0.0.1:4173`. These optional variables
change the local runtime without editing the config:

| Variable | Meaning |
| --- | --- |
| `MASTERSELECTS_E2E_BASE_URL` | Override the page and readiness URL |
| `MASTERSELECTS_E2E_HOST` / `MASTERSELECTS_E2E_PORT` | Change the managed Vite server |
| `MASTERSELECTS_E2E_REUSE_SERVER=1` | Reuse a server already listening at the URL |
| `MASTERSELECTS_E2E_SKIP_WEB_SERVER=1` | Do not start a server |
| `MASTERSELECTS_E2E_BROWSER_CHANNEL` | Override installed browser channel |
| `MASTERSELECTS_E2E_HEADLESS=1` | Diagnostic headless run; release runs stay headed |
| `MASTERSELECTS_E2E_GATE=all|canary|required` | Explicit gate filter override |
| `MASTERSELECTS_E2E_REVIEW=1` | Pause a supported headed journey after its reference project is visibly ready |

Artifacts are written to `test-results/playwright/` and `playwright-report/`.
Failed tests retain trace, screenshot, and video evidence.

The Foundation profile tolerates one narrowly matched browser error: a refused
connection to the optional Native Helper at `ws://127.0.0.1:9876`. The owned
allowance lives in `assertions/consoleAssertions.ts`; every other console error
and every uncaught page error fails the Golden Smoke. Platform tests must start
the helper and do not inherit this exception when they verify that integration.
The managed Vite server does not start the local API: keep the API at
`127.0.0.1:8788` available for account and analytics requests. A missing API
produces console errors and correctly fails the final diagnostics assertion.

The managed E2E dev server keeps the source snapshot it booted with. Filesystem
changes do not trigger HMR or full-page reloads during a journey, while the
targeted Dev Bridge websocket remains active. This prevents unrelated workspace
agents from invalidating an in-progress headed test.

## Deterministic cases: the Vorschau-Wahrheit pattern

`foundation/preview-truth.spec.ts` is the reference for how a case proves what
the user sees. Build new cases the same way:

1. **Media that says what it is.** `fixtures/frameCodeMedia.ts` generates clips
   with ffmpeg at test time (cached in `test-results/playwright/frame-code-media/`,
   no binary media in the repository). Every frame carries its number as 16
   black/white blocks with a check nibble, plus six colour bars and a grey ramp.
   The composition matches the clip's size and rate, so one composition frame is
   one source frame and the clip fills the preview.
2. **Pixels, not flags.** No engine "ready" signal proves that a frame reached
   the screen (they all fire before the paint; on Linux the preview is a 2D
   canvas painted asynchronously after a GPU readback). `fixtures/previewProbe.ts`
   screenshots the preview canvas and decodes the frame code
   (`assertions/frameCodeOracle.ts`). A black or flat image, a blend of two frames
   and a misread are invalid, never a wrong number; an inverted image still reads
   its number and says so.
3. **Wait for the right frame, never for time.** `probe.waitForFrame(n, { allowed })`
   reads until frame `n` shows on two consecutive reads. Frames that may show on
   the way are listed explicitly (`allowed`); any other valid frame fails at once,
   because the preview then showed a wrong picture. No `waitForTimeout`.
4. **Record when things became visible.** Every read is logged; failures print the
   compressed log ("273-9199 ms no preview yet · 9525-10086 ms flat/black ·
   10479 ms frame 0") and the first-frame case attaches it. Budgets are split:
   reload to preview (dev-server boot, generous) and preview to the right frame
   (the editor's own loading, strict).
5. **One case, one test, one shared project.** A worker-scoped fixture prepares
   the project once; each case resets what it depends on and verifies its start
   state through pixels. When the reset cannot reach it (a previous case left the
   preview stuck), it reloads the page and notes `reset-reload` on the case, so
   one defect never turns its neighbours red.
6. **The action under test goes through the UI** (buttons, effect picker,
   export panel); arrangement may use the Dev Bridge (creating the composition,
   importing the clip, selecting a clip on the canvas-drawn timeline).
7. **Effects are measured.** Invert: every colour bar equals 255 minus its value
   before (±4 per channel) and the frame code still reads, inverted.
8. **Exports are decoded outside the browser.** `readVideoFrameCodes` runs ffmpeg
   in Node and `checkFrameSequence` requires exactly frames `from … from+count-1`,
   none missing, doubled or out of order.
9. **Known product defects stay visible.** A case that fails because of a real
   defect is marked `test.fail(true, '<defect>')` with a comment naming it; when
   the fix lands, Playwright reports the case as unexpectedly passing and the
   marker goes.

**Dropping files from outside** (`foundation/drop-import.spec.ts`) is tested in
stages: stage 1 replays the drop inside the page (a `DataTransfer` with a real
`File`), stage 2 sends the drag through Chrome's own pipeline with a real file
path (`Input.dispatchDragEvent` over DevTools, as a file manager would; works
headless). Both drop the frame-code clip at a known time and prove the clip's
start (within one frame) and its frames in the preview. Stage 3, a real Explorer
drag, belongs to the Windows desktop host (`platform.windows-explorer-drop`).
The shared start of a frame-code Sammeltest lives in `fixtures/frameCodeProject.ts`.

On Linux the Playwright Chrome gets ANGLE on Vulkan (WebGPU), XWayland for a
headed window and `--disable-vulkan-surface` headless (`chromeLaunchArgs` in
`config/runtimeProfile.ts`); every platform gets `--force-color-profile=srgb`, so
pixel reads do not depend on the monitor profile. Diagnostic headless runs on a
shared desktop: `MASTERSELECTS_E2E_HEADLESS=1 MASTERSELECTS_E2E_PORT=<free port>
npx playwright test tests/playwright/foundation/preview-truth.spec.ts`. The
clips need `ffmpeg` and `ffprobe` on the test host.

## When a test finds a defect

Growing the suite will keep finding real defects; that is its purpose (the first
five Vorschau-Wahrheit cases found two). Handle each one the same way:

1. **Classify first.** Is it the test (wrong expectation, locator, timing,
   arrangement) or the product? Re-run, read the observation log and the
   failure screenshot, reduce it to the smallest reproduction. Never weaken an
   oracle, widen a tolerance or add a sleep to make a case pass.
2. **A product defect stays visible.** Keep the case and mark it
   `test.fail(true, '<named defect>')` with a dated comment that says what the
   test saw. The shared project keeps going: the per-case reset falls back to a
   reload (noted as `reset-reload`), and in a build phase a failed UI step is
   recorded red and its result built through the Dev Bridge instead, so one
   defect costs only its own case and the rest keeps measuring.
3. **Fix it at the root, in the product.** Not in the test, not in the project
   content (see "Nodes and effects" in `AGENTS.md`). Use your own task branch,
   or hand a larger defect to a sub-agent in its own worktree, with the failing
   case as the reproduction. Before touching shared engine areas (playback,
   seek, render loop, export), tell the other agents working on MasterSelects
   which files you change, so nobody fixes the same thing twice; then add
   targeted unit tests and update the feature doc as `AGENTS.md` requires.
4. **Close the loop.** When the fix lands, Playwright reports the marked case as
   unexpectedly passing: remove the marker, run the spec three times in a row,
   and update the test catalog (state, spec; record a verification only for a
   revision that is merged).

## Phone journeys (/m)

The phone skin served at `/m` has its own config, `playwright.phone.config.ts`
(`npm run test:e2e:phone`), and its journeys live in `tests/playwright/mobile/`.
It reuses the runtime profile (`MASTERSELECTS_E2E_*` host, port, channel,
headless) and the Linux launch flags of the desktop suite, runs one worker and
Chromium only. Two projects: `pixel-7` (412x915, pixel ratio 2.625, mobile user
agent, touch) and `iphone-viewport` (390x844, touch). The second is viewport and
touch emulation in Chromium, not Safari; genuine Safari behaviour stays a
real-device gate.

- `mobile/phoneFixture.ts`: a worker-scoped phone context (device settings come
  from the project's `use` block, warm GPU as in the desktop fixtures) and one
  shared Sammeltest project built once: 20 generated frame-code clips at 360x640,
  30 fps, back to back on the main video track (two long ones, 18 short ones).
  The project is arranged through the Dev Bridge tools `createComposition` and
  `importLocalFiles`, the same existing path as `fixtures/frameCodeProject.ts`;
  the phone has no import UI before M1. Only arrangement and inspection use the
  bridge; the action under test is always touch on the phone UI. The page opens
  plain `/m` (never `?test`, which forces the desktop layout). Each test resets to
  playhead 0, nothing selected, the base timeline (undo, else re-import) and
  frame 0 in the preview (else a page reload, noted as `reset-reload`).
- `mobile/phoneTouch.ts`: real touch through DevTools
  (`Input.dispatchTouchEvent`): `tap`, one-finger `pan` with intermediate moves
  and `pinch` around a midpoint, paced by animation frames, not timers; plus
  `readPreviewFrame` (frame code of the preview through `PreviewProbe`) and a
  long-task / frame-gap recorder.
- `mobile/m0-touch.spec.ts`: the M0 acceptance, one case per test. The scroll
  case reports its numbers (attachment `scroll-performance.json`) and treats the
  50 ms limit as soft on hosts without a GPU; set `MASTERSELECTS_PHONE_PERF=strict`
  to fail on any long task.

- `mobile/m1Fixture.ts` + `mobile/m1-edit.spec.ts`: the M1 "Schneiden" acceptance
  (PLAN.md section 5, 12 cases plus an image/audio import case), the first suite
  that builds its project through the phone UI instead of the bridge. A
  worker-scoped phone context opens plain `/m` on the home. Case 1 creates the
  project through the home (format chip 9:16, name, Create) and checks the
  1080x1920 composition. Clips come in through the media sheet: `setInputFiles` on
  the hidden file inputs (`phone-media-input-visual` / `-audio`), one call per
  pick, so the call order is the pick order; generated frame-code clips (A 4 s,
  B 3 s, a 1 s clip), a PNG and a WAV tone, all 360x640 / 30 fps, cached next to
  the other frame-code media. Every action under test is real touch
  (`phoneTouch.ts`; the long-press reorder holds a counted number of animation
  frames, not a timer). The bridge only inspects (`getTimelineState`,
  `getMediaItems`) and arranges what is not under test (playhead, the export
  case's edit). **Per-test reset:** a UI-built project has no base revision to undo
  to, so each test opens a new empty 1080x1920 composition of the same phone
  project (`createComposition`), playhead 0, nothing selected, no sheet open;
  `ensureEditor` reopens the project from the home if a case left the page there.
  The export cases (8, 9) click Save/Share in the export sheet, capture the
  download (headless Chromium has no file share) and decode it in Node with
  `readVideoFrameCodes` (size and duration via ffprobe); case 9 stubs
  `navigator.share`/`canShare` in the page to see the `File`, then removes the
  stubs to prove the download fallback. Export cases need `ffmpeg`/`ffprobe` and a
  headless Chromium that can encode (H.264 or the VP9 fallback). Run:

- `mobile/m5-assistant.spec.ts`: the assistant sheet opens the chat composer and
  closes again (no live chat run). `mobile/m6-entry.spec.ts`: a phone opening
  `/editor` lands on `/m`, **Full editor** opens and keeps the desktop editor across
  a reload, and the **Mobile** toggle brings the phone editor back. It uses its own
  context (`screen` set to the viewport so the phone check sees a phone screen),
  because it leaves `/m`.

```text
MASTERSELECTS_E2E_HEADLESS=1 MASTERSELECTS_E2E_PORT=5180 \
  npx playwright test -c playwright.phone.config.ts tests/playwright/mobile/m1-edit.spec.ts --project=pixel-7
```

```text
# against a Vite you started yourself (the token file must match the one Vite got)
MASTERSELECTS_E2E_HEADLESS=1 MASTERSELECTS_E2E_PORT=5180 MASTERSELECTS_E2E_SKIP_WEB_SERVER=1 \
  MASTERSELECTS_BRIDGE_TOKEN_FILE=test-results/playwright/.ai-bridge-token-5180 \
  npx playwright test -c playwright.phone.config.ts --project pixel-7
```

Let Playwright start Vite itself by leaving `MASTERSELECTS_E2E_SKIP_WEB_SERVER`
unset. The clips need `ffmpeg` on the test host, like the desktop frame-code cases.

## Reference-project media pack

The larger reference-project sources live in
`fixtures/playwright-reference-project/media/` and are stored through Git LFS,
not under `public/`. Tests request the lazy `referenceMedia` fixture and address
assets by stable roles:

| Fixture property | Media contract |
| --- | --- |
| `dynamicLandscape` | 1080p H.264/AAC motion and transport source |
| `highFrequency60Fps` | 1080p60 H.264/AAC frame and scaling source |
| `portraitVp9` | 1080x1920 VP9/AAC portrait and nested-comp source |
| `longformLandscape` | 1080p H.264/AAC trim, mask, effect, and export source |
| `musicAudio` | long MP3 stereo source for audio journeys; contains embedded cover art |

`fixtures/playwright-reference-project/manifest.json` records original names,
technical metadata, sample timestamps, byte sizes, and SHA-256 checksums. The
fixture validates size and checksum before a test imports an asset, so an LFS
pointer or altered file fails immediately with a `git lfs pull` hint. Adding the
pack does not activate the later keyframe, mask, audio, or export matrices.

## Versioned reference projects

Stable project templates live under
`fixtures/playwright-reference-project/projects/`. They contain symbolic media
roles, composition settings, timeline ranges, and preconfigured feature state.
Tests materialize a fresh in-memory working copy from the template, so the
versioned source is never mutated by a journey.

`masks-rectangle-v1.json` is the first template. It opens a 1920x1080 composition
with the X-Rays source below the striped 60 fps source and a stored four-point
rectangle mask on the foreground clip. With `MASTERSELECTS_E2E_REVIEW=1`, the
focused mask test pauses only after this project, clip selection, mask panel,
playhead, and overlay are visible.

`nested-super-project-v1/` is a sanitized capture of the user-authored “Super
Project”. It retains three 1920x1080 compositions, the 30 fps outer composition,
both 60 fps nested compositions, both nested-clip split boundaries, linked
nested audio, the real-media montage, the rectangle and ellipse masks, animated
mask paths, animated feather, and solid-opacity keyframes. Playwright creates a
unique temporary project directory and hard-links the checked reference media
into its `Raw/` directory (falling back to copies where hard links are not
available). Because the optional Native Helper is not part of the managed E2E
server, the browser then imports those files through the authenticated local
file broker and hydrates the captured project into the isolated browser context.
The startup project's browser-storage root remains the autosave target. Neither
the checked template nor the temporary evidence copy is opened as a writable
project by the editor.
Run it explicitly while the module remains draft:

```text
npm run test:e2e:module -- --grep "saved Super Project fixture"
MASTERSELECTS_E2E_REVIEW=1 npm run test:e2e:module -- --grep "saved Super Project fixture"
```

## Visual reference policy

Visual Goldens are added only when pixels are part of the contract. Transport
shell and accessibility tests stay structural; render, scrub, nested-comp,
transform, mask, and representative export journeys compare selected frames.

- Synthetic color/shape fixtures use near pixel-exact assertions and explicit
  inside/edge/outside sampling for masks and feathering.
- Real-media frames use a narrowly bounded perceptual/image-diff tolerance to
  account for named GPU and codec variance.
- Playback compares a small timestamp set; scrub compares the exact landed
  frame; important exports decode and compare the corresponding output frames.
- A release run never updates references. Golden updates are deliberate,
  reviewed changes made with Playwright's snapshot-update workflow.
- On mismatch, expected, actual, and diff images are retained with trace,
  screenshot, video, console, runtime, timeline, and playback evidence.
