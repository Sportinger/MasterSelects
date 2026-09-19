# Windows beta harness

This is an in-progress first user journey, not a qualified full-editor test suite.
Native folder creation, Chrome permission handling, import/edit/mask/undo and
export verification passed unattended on Windows/RTX hardware: campaign `run-28`,
2026-09-07, eight tests passed in 1.8 minutes, including clean editor diagnostics.

Run on an unlocked Windows desktop with installed Chrome, FFmpeg on PATH, the
reference media pack, and `npm run dev:full` running:

```powershell
npm run test:e2e:beta
npm run test:e2e:beta -- --grep '@cleanup'
```

Each campaign gets a dated directory under `output/windows-beta`. An explicit
`MS_BETA_OUTPUT` must name a fresh child directory of that root. The normal
Playwright configuration excludes these desktop tests.

The editing cases prepare an empty composition through the bridge, then import,
drag, trim, mask, undo/redo, scrub, and export through browser controls. Creating
and selecting the project folder uses Windows mouse/keyboard input; Chrome's
folder permission is scoped to the dedicated profile, origin, and folder name.
Media import currently uses the browser file-input API. Real footage is normalized
into short clips, and generated red/blue clips carry a different seven-bit counter
in every frame, plus separate 440/880 Hz audio tones.

## Readiness and export verification

Steps wait for observable conditions with bounded deadlines and evidence of the
last observed state: engine/project ready, imports completed with valid metadata,
clip sources loaded, linked audio waveforms ready, and stable preview pixels.
Before masking, preview pixels also match an independently decoded source image;
a stable blank placeholder is insufficient. Unrelated AI analysis is not awaited.

The current three-second, 640x360, 30 fps H.264/AAC MP4 cases verify:

- The browser's suggested download name is exactly `windows-beta.mp4`, before
  saving the artifact under a test-controlled path.
- Container, codecs, dimensions, duration, audio payload, and 90 encoded packets.
- Independent FFmpeg decoding of all 90 frames, with actual presentation timestamps
  at 1/30-second intervals. Decoding does not synthesize additional frames.
- For patterns, exact source-frame counters on both layers at every active frame,
  mask/background colors and the foreground's trimmed end. Missing, repeated,
  reordered, black or stale frames fail. Sub-frame offsets use FAST's declared
  nearest-presentation-timestamp sampling; no per-frame +/-1 tolerance is allowed.
- Preview/export pixel agreement, non-silent audio, and both expected pattern tones.
- Actual playback of the exported local file in a separate foreground Chrome tab:
  wait for `canplaythrough`, click Play, require completion, zero browser-reported
  dropped frames and zero rebuffer events, and bound observed frame gaps/duration.

`temporalOracle.spec.ts` deliberately injects duplicates, missing/reordered frames,
invalid timestamps and black output to verify rejection. Identical real-footage
frames alone are not classified as errors: legitimate holds exist. Exact temporal
content checks currently apply to the known generated fixtures only.

Run 26 verified both export artifacts with 90 presented frames, zero drops and zero
rebuffer events. The pattern exposed a real FAST decoder bug: a buffered neighbor
could be returned before the requested sample arrived. The corrected path waits for
the exact sample and fails instead of silently substituting a hold frame.

This is coverage of the declared fixture/machine/profile, not certification of all
codecs, export modes, high resolutions, long projects or every playback device.

The first campaigns also exposed a preview startup race: Chrome reported enough
media data before a playing element had produced its first frame. GPU import now
waits for that frame instead of attempting to import an absent backing resource.
Earlier failed campaign evidence remains available; reports are not rewritten.

## Automatic cleanup

The user explicitly authorized closing test-created windows and deleting test
folders after every run. This overrides the general workspace instruction to
leave browser windows open for these owned test resources only.

- A `browser.json` manifest records the dedicated Chrome profile before launch.
- Fixture teardown saves evidence, closes only Chrome processes with that exact
  profile argument, and deletes the profile, `native-project-root`, and generated
  `media` directory. The native input process is cancelled when its entry step ends.
- Global teardown repeats cleanup after worker failures. Cleanup is idempotent;
  an unsuccessful cleanup fails the run and is not silently ignored.
- Path containment checks reject unrelated profiles, traversal, and reparse points.
- HTML/JSON reports, screenshots, traces, exported verification artifacts, and
  cleanup evidence remain. Original reference media and ordinary Chrome stay intact.

A hard kill of the entire runner or machine shutdown can prevent both teardown
hooks from running. An external supervisor for that case is not implemented yet.
Only one interactive desktop campaign should operate a Windows session at a time.

`cleanup.spec.ts` verifies real Chrome termination after an injected failure,
temporary-directory removal, evidence retention, and rejection of an unrelated
directory. The native journey must pass separately before claiming UI coverage.
