# Tutorial pipeline: the next version

Plan for making a tutorial simple and fast for an agent. Each stage is one command, a recipe holds
little more than its scenes, and the agent works piece by piece. Roman's requests from 2026-10-24:

- always record in the real environment: headless Chrome at 100%, 2560×1440, output 1920×1080;
- while building, take pictures and look at them, so it is clear that each step is right;
- come back to exactly the same point (project, view, settings, pointer), so the parts join
  seamlessly;
- generate the voice line by line, so each line can be moved;
- cut and assemble the episode in a MasterSelects project.

Roman's requests from 2026-10-26:

- a fresh agent that gets a topic knows from the guides how to work ([`agents.md`](agents.md), "The
  workflow");
- parts of at most about 20 seconds, each planned, voiced, recorded and put into MS on its own;
- the recorded parts are imported into a MasterSelects session and cut there with the bridge;
- a voice that runs too fast can be split and moved in MS for more pause;
- the next take starts exactly where the last one ended (checkpoints, stage 2).

[`agents.md`](agents.md) describes how the pipeline works today and its pitfalls.
[`test-yarn-2026-10-24.md`](test-yarn-2026-10-24.md) shows where a fresh agent lost its time. Work through the
stages in order; each one is useful on its own. Tick off a stage here when it is done.

## Goals

- **One command per stage:** `record`, `voice`, `cut`, `ms-cut`. Defaults cover viewport, output,
  music and voice.
- **Nothing for Roman to click while an agent works.** No Chrome Allow dialog, no real mouse in the
  way, Roman's Chrome untouched.
- **Piece by piece.** Each part starts from the checkpoint the previous part left. No part rebuilds
  its start state by clicking.
- **Every step is seen.** Building steps and takes produce pictures, and the agent looks at them.

## 1. The real environment: headless Chrome at 2560×1440 ✓ (2026-10-26)

**Done.** `tutorialBrowser.mjs` launches it by default; the build server and the takes use it, and
`--attach` remains for trying things in Roman's Chrome. Part 3 was recorded this way: real
2560×1440 frames, 1920×1080 output, a 1.33 zoom on the node scenes stays sharp. Learned on the way:
`requestAdapter()` answers null for about a second after the launch (`warmGpu` waits before the
editor loads), and Vite must not watch `tutorial-videos/` (ENOSPC). The drawn pointer is 1.25× and
the overlays scale with the page width. Open: retune the pixel offsets of the 720p recipes when
their parts are recorded again.

**Finding (2026-10-24):** every take so far was 1280×720, scaled up to 1080p. Chrome's screencast
sends the window's own pixels. The emulated device scale (`scale: 2`) does not raise that, and a
larger window does not fit on Roman's 3440×1440 monitor.

**Decision (Roman):** headless Chrome, 100% scale, 2560×1440. No emulated scale, no browser zoom.

Measured on Roman's machine (AMD RDNA 3):
- **Headless Chrome with Vulkan, 2560×1440 at scale 1:** real 2560×1440 frames and hardware WebGPU.
  The screencast reaches 26 fps when the whole page repaints every frame (median gap 33 ms, p90
  50 ms). At 1920×1080 it reaches 39 fps.
- **Measure capacity with a repainting page.** The screencast sends frames only when something
  changes, so an idle page reports far too few (9–19 fps in the first, wrong measurements).
- **Flags:** `--headless=new --use-angle=vulkan --enable-features=Vulkan --disable-vulkan-surface
  --enable-unsafe-webgpu --ignore-gpu-blocklist`, viewport 2560×1440, `deviceScaleFactor: 1`.
  Without the Vulkan flags, headless Chrome has no WebGPU adapter.
- **Option for more speed:** `gamescope --backend headless` with Chrome on X11. It also gives the real
  GPU, and it publishes a PipeWire stream (`node.name = gamescope`). Capturing that stream with
  `gst-launch-1.0 pipewiresrc` stayed PAUSED twice. Try it only if 26 fps is not enough.

To do:
- `tutorialBrowser.mjs` launches this headless Chrome with its own profile (see stage 2) and makes
  it the default. `--attach` (Roman's Chrome) stays as an option, but not for takes.
- Defaults: viewport 2560×1440, scale 1, output 1920×1080 at 30 fps.
- The UI at 100% is small in a 1080p video (scaled to 75%). Camera zooms up to 1.33× stay sharp,
  so zoom into the area being explained more often.
- The existing recipes use pixel offsets for the 1280 layout (`~0,140`, `pane:…:x,y`). Retune them,
  and prefer targets that do not depend on pixels.
- Probes (`eval`, screenshots) run in the same headless Chrome as the takes, so what the agent
  checks is what gets recorded.

**Done when** a take's frames are 2560×1440, the output is 1920×1080, and Roman's Chrome is not used.

## 2. Checkpoints: continue exactly where the last part ended ✓ (2026-10-26)

**Done** as described below, with one change: views the editor keeps only in memory come back through
`resume` steps of the part that saves the checkpoint, not through MS hooks. The node graph's source
and an expanded group survive a reload by themselves; hidden playback controls, the Properties tab
and the Media selection do not. Part 3 now starts from checkpoint `flamer-ep2-part2` with no setup
step (it had 43); the seamless check measured 0.02 % difference (the pointer). Saving a checkpoint
takes about 20 s; `flamer-ep2-part2-end.json --setup-only` rebuilds that start state in 67 s,
pixel-identical to the hand-built one.

Today every part rebuilds its start state with `setup` steps. In the yarn test, an agent needed about
an hour for a setup of about 40 steps. Parts also cannot join seamlessly, because nothing records
where the last one ended.

A checkpoint is everything needed to see the same picture again:

| What | Where it lives | How it is saved | How it comes back |
|---|---|---|---|
| Project (clips, effects, node graph, keyframes) | OPFS / IndexedDB of the profile | profile copy | profile copy |
| Layout, settings, recent projects | localStorage (`dockStore`, `settingsStore`) | profile copy | profile copy |
| Playhead, selection, open comp | runtime | `checkpoint.json` from `getTimelineState` | editor tools / store calls |
| Node workspace: source, open group, pan and zoom | runtime | `checkpoint.json` | restore step (needs a small MS hook, see stage 8) |
| Preview zoom and pan, panel scroll positions | runtime | `checkpoint.json` | restore step |
| Drawn pointer position, camera (cx, cy, zoom) | pipeline | `checkpoint.json` | pipeline |
| Last frame | screencast | `last.png` | compared with the first frame of the next part |

- Each take runs Chrome with a copy of the start checkpoint's profile:
  `tutorial-videos/<episode>/checkpoints/<name>/profile`.
- When the take ends, the pipeline writes the end state into `checkpoint.json` and `last.png`, closes
  Chrome, and copies the profile as a new checkpoint named after the part. A live profile must not be
  copied.
- A recipe starts with `"from": "<checkpoint>"` instead of a long `setup`. The first episode
  checkpoint is built once, step by step, with pictures (stage 3).
- **Seamless check:** before recording, the pipeline compares the first frame with the previous
  part's `last.png`. If they differ beyond a small threshold, it stops, saves both images and the
  difference, and says what differs.
- **Retakes:** retaking part 3 always starts from checkpoint "part 2", never from a state that a failed
  part 3 left behind.
- `node scripts/tutorial-tab.mjs checkpoint <name>` saves the current state by hand, for building
  start states.

**Done when** part 3 starts from part 2's checkpoint with zero setup steps, and its first frame
matches part 2's last frame.

## 3. Build with pictures ✓ (2026-10-26)

**Done:** a picture after every setup and `resume` step and every build server `step`, contact sheets
of 16 pictures (`setup.jpg`, `scenes.jpg` from the take's own frames), before and after for a failed
step with the editor's warnings, `expect` checks, and the build server's `locate`, `state` and `shot`,
so an agent needs no probe scripts of its own. `type` refuses to type when no field has the focus.

An agent that builds a start state or a scene must see each step. Today the setup is invisible, and
in the yarn test an agent searched for a lost clip for most of an hour.

- **`--shots`** (added by the yarn test agent) saves a screenshot after every setup step. This
  becomes the default for setup and for `make --voice none`.
- **One contact sheet per run** (`<part>.work/steps.jpg`): every step's picture, labelled with its
  step number and target. The agent looks at it after every run.
- **On a failed step,** the pipeline names the step and shows the picture before the step and the
  failure picture next to each other. It also adds the editor's warnings from the log.
- **State checks in the recipe:** `{ "expect": { "clips": 1, "clipStart": 0, "previewNotBlack": true } }`
  checks through the editor tools and stops with a clear message.
- **The same environment as the take** (stage 1), so the pictures show what will be recorded.

**Done when** a broken setup step names itself with before/after pictures, without the agent
writing its own probe scripts.

## 4. The voice line by line ✓ (2026-10-26)

**Done:** `narrateLines` in `tutorialVoice.mjs` sends one request per scene `say` to
`/v1/text-to-speech/<voice>/with-timestamps` and caches each line in
`scripts/tutorials/audio/voice/<recipe>/<scene>-<hash>.mp3` plus `.json` (the hash covers text,
voice, model, settings and seed, not the neighbours, so a changed line costs only itself). The
neighbour lines go along as `previous_text` / `next_text` with a fixed `seed`; a model that refuses
them gets the lines without context, and the log says so. Each line is cut from 0.1 s before its
first sound to 0.3 s after its last one. A scene's `speed` slows one line. A recorded voice (Roman's
own) is cut into lines at the middle of the pauses between scenes. `--voice none` stays the free dry
run; `"voice": { "whole": true }` keeps the old single request for recipes recorded with it.

## 5. Record first, place the voice afterwards (partly done)

Gestures come 1–3 s late on heavy pages, and every fix needed a retake.

- ✓ The voice is generated before the recording, so each line's duration is known. A scene still
  waits at least as long as its line. In MS, each line is its own clip and can be moved by hand.

Open:
- The recording logs each step's real start and end in `recording.json`.
- The cut places each line by an anchor: by default the scene start plus `lead`. With
  `"sync": { "word": "here", "step": 2 }`, the word "here" lands on the start of step 2.
  `"offset": 0.4` moves a line by hand.
- If a line would run into the next one, the next line moves later and the picture holds. The log
  says so.

**Done when** a take with late gestures still has the voice exactly on the pointer.

## 6. Cut in a MasterSelects project ✓ for parts (2026-10-26); music open

**Done:** a take delivers `tutorial-videos/<part>.cut/`: the picture without sound or captions
(`<part>.mp4`), one levelled file per voice line (`voice/<part>.NN-<scene>.wav`, the part's voice at
−14 LUFS), and `edl.json` (where each line starts, its word times). `node scripts/tutorial-ms-cut.mjs
<part>.json …` puts parts into the project open in the cut editor (the dev server's editor, through
the bridge): the picture on video track "Picture" after the previous part, each line on audio track
"Voice", a caption clip per part on video track "Captions" above. The new editor tool
`setClipTranscript` gives every line clip its ElevenLabs word times, so the captions follow a split
or moved line. `--replace` swaps in a retake. `importLocalFiles` now reports the `clipId` of each
placed clip.

Open:
- **Music in MS:** place the cues of README "The music" on an audio track "Music" with `trimClip`
  and `audio-volume` keyframes for the fades. Until then add the music by hand or in the quick look.
- **Export** through the MS Export panel at 1920×1080, 30 fps: check that the export matches the
  quick look (captions, voice level).
- **Hold the picture for a pause:** a pause added in MS by moving a voice line has no picture to fill
  it; today the part is re-recorded with a longer `tail`. A freeze-frame tool for agents (the editor
  has freeze frame at the playhead) would let the cut hold a frame instead.

## 7. Automatic check after every take

After the cut, write `<part>.check.jpg` (one frame per scene, at its sync word) and
`<part>.check.txt`. The text file lists:
- late steps and failed targets;
- black preview frames;
- caption drift;
- the seamless comparison (stage 2).

The agent reads both before showing Roman.

## 8. Building blocks and MS hooks

- **Building blocks:** reusable step sequences in `scripts/tutorials/blocks/<name>.json`, used as
  `{ "block": "portrait-comp" }`. Candidates:
  - `new-project <name>`, `portrait-comp`, `preview-left`, `hide-playback-controls`;
  - `add-effect <name>`, `open-nodes`, `delete-nodes [labels]`;
  - `add-node <name>`, `connect`, `insert-into-cable`, `scrub <from> <to>`.
- **MS hooks for automation:**
  - a dev-only `window.__msTutorial.locate({ node, port })` that returns the screen rectangle of a
    card or port;
  - read and set the node workspace view (open group, pan, zoom) for checkpoints;
  - stable labels on moved dock groups;
  - distinct names for the node canvas Fit and the timeline Fit.

## 9. Product work found by the tutorials

- ~~New layers start where you right-click~~ (fixed: an Add Layer clip starts at the beginning of the
  empty space under the click, 0 on an empty track). In the live check, Ctrl+Z and the `undo` tool did
  not remove two blank clips just added this way; check whether Add Layer is undoable.
- **The project name dialog:** in the yarn test, the name was typed before the dialog's field was
  ready, and the setup went wrong after that. Check whether the dialog should focus its field at
  once, and whether a new project with an existing name should be refused or reported clearly.
- **Views lost on reload:** hidden playback controls, the Properties tab and the Media selection reset
  when a project reopens. Keeping them would make checkpoints need fewer `resume` steps.
- **Weave orbit in Edit mode** (`cameraInteraction` like voxel relief), for the fly-around.
- **Fit in the node canvas:** check whether hidden folder nodes enlarge the fitted area.
- **The node inspector reopens** on every return to the Nodes tab, so hiding it does not last (yarn test).
- **Narrow inspector layout:** values sit below their labels without sliders, not in the unified inspector design (yarn test).
