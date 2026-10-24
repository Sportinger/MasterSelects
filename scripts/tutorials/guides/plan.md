# Tutorial pipeline: the next version

Plan for making a tutorial simple and fast for an agent: each stage is one command, and a recipe
holds little more than its scenes. Roman asked for this on 2026-10-24, after episode 2:
- the voice is generated line by line, so each line can be moved;
- the episode is cut and assembled in a MasterSelects project;
- recording in 1800p, output 1920×1080.

[`agents.md`](agents.md) describes how the pipeline works today and its pitfalls. Work through the
stages in order; each one is useful on its own. Tick off a stage here when it is done.

## Goals

- **One command per stage:** `voice`, `record`, `cut`, `ms-cut`. Defaults cover viewport, output,
  music and voice, so a new recipe needs only its scenes.
- **Nothing for Roman to click while an agent works.** The target is no Chrome Allow dialog and no
  real mouse in the way.
- **No retakes for timing.** Late gestures are absorbed by placing the voice afterwards.
- **A take is checked before Roman sees it.** The check is automatic: contact sheet plus a report.

## 1. The voice line by line

Today one ElevenLabs request speaks the whole part (`narrate` in `tutorialVoice.mjs`). A changed
sentence regenerates every line, and a line cannot be moved on its own.

- One request per scene `say` to `/v1/text-to-speech/<voice>/with-timestamps`. Each line keeps its
  character alignment, so captions and `word` steps keep working.
- Cache each line by a hash of its text, voice, model, settings and neighbour texts. Store it in
  `scripts/tutorials/audio/voice/<recipe>/<scene>-<hash>.mp3` plus `.json`. That folder is
  gitignored and survives a deleted work folder. Only changed lines cost credits.
- Keep the intonation even across lines: send `previous_text` / `next_text` (the neighbouring lines)
  and a fixed `seed`. Check that `eleven_v4` accepts both. If it does not, use the same settings for
  every line and accept small differences.
- Trim leading and trailing silence per line down to about 0.1 s (ffmpeg `silenceremove`).
- A recorded voice (Roman's own) stays possible. Split it into lines at the pauses between scenes,
  which Deepgram already finds.
- `--voice none` stays the free dry run.

**Done when** changing one `say` regenerates only that line, and the log names the lines it
requested.

## 2. Record first, place the voice afterwards

Gestures come 1–3 s late on heavy pages, and every fix needed a retake.

- The voice is generated before the recording, so every line's duration is known. A scene still
  waits at least as long as its line.
- The recording logs each step's real start and end into `recording.json`
  (`steps: [{ scene, index, start, end }]`).
- The cut places each line by an anchor. By default a line starts at its scene's start plus `lead`.
  With `"sync": { "word": "here", "step": 2 }`, the line shifts so that "here" lands on the start of
  step 2. `"offset": 0.4` moves a line by hand.
- If a placed line would run into the next one, the next line moves later and the picture holds
  (freeze) for the difference. The log says so.
- `word` steps keep their meaning (wait for the word), measured against the placed line.

**Done when** a take with late gestures still has the voice exactly on the pointer, without a retake.

## 3. Cut in a MasterSelects project

The episode is assembled in a MasterSelects project and exported from MS. Roman can then move voice
lines, trim parts and change the music in the editor.

- **What a take delivers:** the picture with the camera moves, without captions or sound
  (`<part>.video.mp4`); the voice lines (stage 1); and an edit list `<part>.edl.json` with the start
  time of every line in the part.
- **Episode recipe** `scripts/tutorials/<episode>.json`: the parts in order and the music cues
  (README, "The music").
- **`node scripts/tutorial-ms-cut.mjs <episode>.json`** builds the project through the editor's own
  tools:
  - `createLocalProject` / `saveProject`;
  - `importLocalFiles` with track and start: track Video 1 holds the parts, Audio 1 the voice lines,
    Audio 2 the music clips;
  - `addKeyframe` for the music volume points;
  - `createCaptionClip` for captions that follow the voice clips.
- **Captions need transcripts on the voice clips.** Either run `startClipTranscription` (check its
  provider and cost first), or add a small atomic MS tool that sets a clip transcript from the
  ElevenLabs word times. The second needs no extra service. An atomic tool is allowed in the editor
  (root `AGENTS.md`, section 7).
- **Camera zooms** stay baked into the part video at first. Once takes have real resolution
  (stage 4), they can become transform keyframes in MS.
- **Export** through the MS Export panel at 1920×1080, 30 fps. The music levels come from the volume
  keyframes.
- **Open questions:**
  - The bridge runs only with the main folder's `dev:full` (5173). A task worktree's Vite (5192) has
    no `.ai-bridge-token`. Build the cut project in the main editor (an authorized test project), or
    give the worktree its own bridge.
  - Where should the project folder live? `tutorial-videos/<episode>.ms/` is local and not in git.

**Done when** `tutorial-ms-cut.mjs` turns two parts into an MS project with picture, voice lines,
music and captions. A moved voice line must stay in sync with its captions, and the MS export must
look like today's cut.

## 4. Real resolution: 1800p recording, 1920×1080 output

**Finding (2026-10-24):** all takes so far were recorded at 1280×720 and scaled up to 1080p. Chrome's
screencast sends the window's own pixels. The emulated device scale (`scale: 2` in the recipes) only
makes the page render finer before Chrome scales it back down.

Measured on Roman's machine (AMD RDNA 3, monitor 3440×1440):

| Way | Frames | Speed | Note |
|---|---|---|---|
| Roman's Chrome, attached (today) | 1280×720 | 36–49 fps | sharp only at 720p |
| Headless Chrome, Vulkan, `--force-device-scale-factor=2.5` | 3200×1800 | 8.5 fps (JPEG q90), 12.5 (q60) | real GPU WebGPU; readback is the bottleneck: 1.5× also only gets 16 fps |
| `gamescope --backend headless -w 3200 -h 1800`, Chrome on X11 with scale 2.5 | 3200×1443 | 19.5 fps | real GPU; the window frame took height, so emulate the viewport inside |
| Same gamescope, its PipeWire stream (`node.name = gamescope`) | – | – | the node appears, but `gst-launch-1.0 pipewiresrc path=<id>` stayed PAUSED twice; not solved yet |

A 3200×1800 window does not fit on the 1440 px monitor, so Roman's own Chrome cannot record 1800p.

Plan:
1. **Quick win: native 1080p in Roman's Chrome.** Set the browser zoom for the editor origin once to
   150% (Chrome remembers it per origin) and size the window so the page is 1920×1080. Then use
   `scale: 1`, with no emulated scale. Check the frame size and fps with a probe before switching.
2. **Target: 1800p at 30 fps from a headless gamescope.**
   - Chrome with its own profile and the real GPU runs inside `gamescope --backend headless`.
   - Capture its PipeWire stream instead of the screencast. Next try: give pipewiresrc an explicit
     format (`! video/x-raw,format=BGRx`), or read it through `pw-record` or a small PipeWire
     client, then encode with `h264_vaapi`.
   - Sync the video to the step times with a one-frame marker that the stage draws at t0.
   - Bonus: no Allow dialog, no real mouse in the way, and Roman's Chrome stays untouched. That
     makes it the simplest way for agents.
3. Once the frames are 1800p, the cut crops the camera zooms from real pixels (up to 1.67× without
   upscaling).

**Done when** a take's frames are 3200×1800 at 30 fps, and the encoded 1920×1080 output is sharp in
a zoom.

## 5. Automatic check after every take

- After the cut, write `tutorial-videos/<part>.check.jpg` and `<part>.check.txt`. The contact sheet
  shows one frame per scene, taken at its sync word.
- The report lists:
  - late steps and failed targets;
  - real mouse events;
  - frames where the preview pane is black (mean brightness of its rectangle);
  - captions that drifted (word count mismatch).
- The agent reads both before showing Roman.

**Done when** the black preview of the first part 2 take would have been reported automatically.

## 6. Start states, building blocks, MS hooks

- **Start states:** save the start of a part once as an MS project and load it before the take,
  instead of clicking it together in `setup`. A `checks` list (preview not black, clip at 0, layout
  as expected) stops the take before it records rubbish.
- **Building blocks:** reusable step sequences in `scripts/tutorials/blocks/<name>.json`, used as
  `{ "block": "portrait-comp" }` with parameters. First candidates:
  - `portrait-comp`, `preview-left`, `hide-playback-controls`;
  - `add-effect <name>`, `open-nodes`, `delete-nodes [labels]`;
  - `add-node <name>`, `connect`, `insert-into-cable`;
  - `scrub <from> <to>`.
- **MS hooks for automation:**
  - a dev-only `window.__msTutorial.locate({ node, port })` that returns the screen rectangle of a
    node card or port. It replaces hovering to find ports.
  - stable labels on moved dock groups;
  - distinct accessible names for the node canvas Fit and the timeline Fit.

## 7. Product work found by the tutorials

- **Weave orbit in Edit mode:** `cameraInteraction` like voxel relief, so the presenter can fly
  around the jellyfish and zoom (Roman's wish for episode 2).
- **Fit in the node canvas:** check whether hidden folder nodes enlarge the fitted area.
- Every new find goes the normal way: fix at the root, targeted test, feature doc, own commit.
