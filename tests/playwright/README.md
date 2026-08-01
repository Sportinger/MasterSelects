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
- `release` runs the full repository build/type gate, the built smoke, then the
  required headed Dev Bridge journeys.
- `report` opens the latest HTML report without rerunning tests.

Google Chrome Stable must be installed. The suite uses a fresh Playwright
BrowserContext and never a personal Chrome profile. Tests run serially with one
worker because media, GPU, audio, bridge, and filesystem state are not yet
qualified for parallel execution.

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

The managed E2E dev server keeps the source snapshot it booted with. Filesystem
changes do not trigger HMR or full-page reloads during a journey, while the
targeted Dev Bridge websocket remains active. This prevents unrelated workspace
agents from invalidating an in-progress headed test.

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
file broker and hydrates the captured project into memory. The toolbar therefore
intentionally says `No Project Open`: no autosave target exists and neither the
checked template nor the temporary evidence copy can be modified by the editor.
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
