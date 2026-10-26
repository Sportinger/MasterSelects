# Tutorial videos: handbook for agents

Read this before you work on a MasterSelects tutorial video. [`../README.md`](../README.md) explains
the recipe format and the commands. This page covers how the work goes with Roman, the setup of a
session, and every pitfall we have hit so far. [`plan.md`](plan.md) is the plan for the rest of the
pipeline: the voice line by line, and the final cut in a MasterSelects project.

## Quick start

1. Read "How Roman wants it" below. Skim the pitfalls of the area you will touch.
2. Session setup (below): worktree, Vite on 5192, secrets, and the build server from the previous
   part's checkpoint: `node scripts/tutorial-tab.mjs serve --from <checkpoint>`. No Chrome, no Allow click.
3. Copy the last part recipe (`flamer-ep2-part3-yarn.json`), set `"from"` to the previous part's
   checkpoint, and write the scenes. Try single steps with `tutorial-tab.mjs step` and look at each picture.
4. `make … --voice none` until the steps work (read `scenes.jpg`), then `make` with the voice.
5. Look at the video, show Roman, commit the recipe. The take left a checkpoint for the next part.

## What we make

Video Copilot style tutorials (Andrew Kramer) with the presenter "Dominik Flamer". The screen
recording shows the real editor of this checkout. A drawn pointer acts like a human presenter: it
points, circles, drags panels and clicks, timed to the words. Tone and jokes:
[`kramer-style.md`](kramer-style.md). Voice script and audio tags:
[`elevenlabs-script.md`](elevenlabs-script.md).

| Episode | State | Recipes |
|---|---|---|
| 1 | done. Roman's recorded voice, music, pointer gestures | `flamer-episode-1.json` |
| 2, "Knitted Jellyfish" (Weave, Qualle form) | parts 1 and 2 recorded in 720p; part 3 ("Yarn") in 1440p from checkpoint `flamer-ep2-part2`; an older one-piece version exists | `flamer-ep2-part1.json`, `flamer-ep2-part2.json`, `flamer-ep2-part2-end.json` (builds the checkpoint), `flamer-ep2-part3-yarn.json`, `flamer-episode-2.json` |

Episode 2 still needs:
- parts 1 and 2 again in 1440p (part 1 with the new first line); part 2 should end where
  `flamer-ep2-part2-end.json` ends, so part 3 can continue from its checkpoint;
- the parts after part 3, starting from checkpoint `flamer-ep2-part3-yarn` (the scenes `form` … `outro` of `flamer-episode-2.json`, rebuilt in the new
  part style; part 3 ends with "Next up: we turn this thing into a jellyfish");
- the fly-around in edit mode (needs Weave orbit in MS, see [`plan.md`](plan.md));
- the final cut in MasterSelects.

## How Roman wants it

- **Short German replies, small steps.** Do not explain what can be looked up. Report what you did
  and what comes next in a few lines.
- **Work in parts** of about a minute each. Finish one part and show it before you start the next.
  Do not write one long script for the whole episode.
- **Show the result first.** Each episode opens with the finished effect. Then build it from scratch,
  piece by piece, in the real UI: nodes are added one by one and really connected.
- **Everything on screen is real.** When the narration talks about nodes, real node cards and the
  running clip must be visible. Do not fake product UI with overlays.
- **While building, take pictures and look at them.** Every setup step and every `tutorial-tab.mjs
  step` leaves a picture; look at it before the next step, so you know the step did what it should.
  Add `expect` steps where a mistake would cost a take (a clip at 0, a paused timeline). Do not build
  blind and debug afterwards (Roman, 2026-10-24).
- **Always the real environment.** Build, probe and record in the headless Chrome at 2560×1440 and
  100% scale: the build server and the takes use the same one. Never probe in another window or at
  another size; it shows a different layout than the take.
- **Work piece by piece.** Each part starts from the checkpoint the previous part left (`"from"`), so
  project, view, settings and pointer are the same, and the take checks that its first frame matches
  the checkpoint's last frame. A part's own `setup` stays short or empty.
- **Look at it yourself before you show it.** Check a contact sheet of the key moments (the
  `video-glance` skill): is the clip in the preview (not black), are the nodes visible, does the
  pointer hit what the voice names? Roman should not find errors that a look would have shown.
- **Every episode opens the same way:** "Hey, what's up, Dominik Flamer here, and today …". It never
  opens with "BOOM" (Roman, 2026-10-24). The episode 2 part 1 voice still starts with "BOOM!" and
  needs a new first line.
- **Pause before the node graph.** Do not let the clip play while the Nodes tab opens or nodes are
  edited: the take stutters (Roman, 2026-10-24). Pause first, park the playhead on a frame that shows
  the effect, and press play only to show a result.
- **No title card intro.** Episode 1 opens straight with the presenter. The pointer moves like a
  person, not like a robot: arcs, small overshoots, a pause before a click.
- **Zooms are light and emotional** (1.05–1.33): a slow push in for suspense, a quick snap back on the
  punchline. At 100% the UI is small in a 1080p video, so frame the area being explained more often:
  a zoom up to 1.33 on the 2560 px take stays sharp (`"camera": {"panes": ["tab=Preview", "left-group"], "maxZoom": 1.33}`).
- **Intermediate renders.** When Roman asks for a "Zwischenstand", join the finished parts with the
  music. Open the file for him with `xdg-open`.
- **Jokes come from the action.** Examples: "the jellyfish is tall, so we need a portrait comp", "we're
  making a jellyfish, not a doormat". Roman adds ideas mid-way; write them into the part recipe.
- **Bugs found while recording are product bugs.** Fix them in MS at their root, with a targeted test
  and the feature doc, in their own commit (see the root `AGENTS.md`, section 12). Never work around
  them in the recipe. Episode 2 found five: Linux right-click marquee, folder delete, insert into
  cable, Delete removing the clip, wrong loop tooltip.

## Session setup

1. Your own task worktree (root `AGENTS.md`, section 1), a real `npm ci`, and Vite on its own port:
   `npx vite --port 5192 --strictPort` (in the background).
2. Secrets in `~/.config/agent-secrets/env`: `ELEVENLABS_BROWSER_API_KEY` (the account with credits),
   `DEEPGRAM_API_KEY`. Load them with `set -a && . ~/.config/agent-secrets/env && set +a` in the same
   shell command. Never print them or write them into files.
3. The build server in the background, from the checkpoint the part continues:
   `node scripts/tutorial-tab.mjs serve --from flamer-ep2-part3-yarn` (with the secrets loaded). It
   opens the editor in a headless Chrome (2560×1440, scale 1, hardware WebGPU); nothing opens on
   Roman's desktop. After a crash or restart, `serve --keep` continues its last editor. A new `serve`
   takes over from a running one (the old one exits), so there is never more than one.
4. Checkpoints are local (`tutorial-videos/checkpoints/`). If one is missing, rebuild it from its
   recipe: `node scripts/tutorial-video.mjs scripts/tutorials/flamer-ep2-part2-end.json --setup-only
   --save flamer-ep2-part2`, or take the previous part again.

## Making a part

1. Write the part's scenes into its own recipe with `"from": "<previous checkpoint>"`. One scene is
   one beat; its `say` follows the style guides. Put the joke where the action gives it.
2. Try each new gesture in the build server before it goes into a scene:
   `tutorial-tab.mjs step '<step json>'` runs it and prints the picture; `locate '<target>'` shows where
   a target is; `state` lists clips, playhead, panels and what has the focus. A step changes the
   build server's editor; `serve --from <checkpoint>` again gives the clean start.
3. If the part needs a start state the previous take did not leave, put the steps into `setup` (run
   before the take, not recorded, a picture after each), or build it in the build server and save it
   with `tutorial-tab.mjs checkpoint <name> '[<resume steps>]'`. Keep those steps in a recipe
   (`*-end.json` with `--setup-only`) so the checkpoint can be rebuilt.
4. Try the take with `--voice none` until the steps work. That costs no credits. Then generate the
   voice and record: `node scripts/tutorial-tab.mjs make scripts/tutorials/<part>.json`.
5. Read the log (`seamless: …`, `late for "<word>"`, scenes that ran over) and `scenes.jpg`, the frame
   after every step. A failed step stops with `<scene>.failed.jpg`: before and after, the error and
   the editor's warnings. Fix the steps (`early`, `ms`, `after`) and run `make` again; the retake
   starts from the clean checkpoint.
6. List in `resume` what the part's end view needs after a reload (see "Checkpoints" below), so the
   next part continues seamlessly.
7. Look at the video, show Roman the part, commit the recipe on the task branch. Audio, videos and
   checkpoints stay local (`audio/`, `tutorial-videos/`).

## Pitfalls

### The headless Chrome

- **Takes are real 2560×1440.** Chrome's screencast sends the window's own pixels, so a visible window
  on Roman's 3440×1440 monitor gave 1280×720 at most, and an emulated device scale did not raise it.
  The headless Chrome has no such limit (`tutorialBrowser.mjs`; about 26 fps when the whole page
  repaints).
- **Headless Chrome needs the Vulkan flags for WebGPU** (`--use-angle=vulkan --enable-features=Vulkan
  --disable-vulkan-surface`), and right after the launch `requestAdapter()` answers null for about a
  second. The pipeline asks from the editor's favicon until the GPU answers, then loads the editor
  (`warmGpu`). An editor that loads earlier starts without WebGPU.
- **Vite must not watch `tutorial-videos/`.** Its tens of thousands of frames exhausted the inotify
  watches and Vite died with ENOSPC; the folder is unwatched since 2026-10-26 (`tools/devServerWatch.ts`).
- **"Storage persistence DENIED"** in the editor warnings is the headless Chrome refusing persistent
  storage. It does not matter for checkpoints.
- **`--attach` (Roman's Chrome) is for trying things only.** Every new DevTools connection asks him
  to click Allow, the screencast stays 1280×720, and the real mouse can cross the window. Never
  navigate or close his own tabs, and never use Playwright's `page.screenshot` there (it resets the
  emulated pixel ratio); the pipeline takes pictures through DevTools (`Page.captureScreenshot`).

### Checkpoints

- **A reload keeps the project, not every view.** After a checkpoint reopens, the project, the dock
  layout, the node graph's source and an expanded Weave group are back. Lost are: hidden playback
  controls, the Properties tab (Effects falls back to Transform) and the selected row in Media. The
  part that saves the checkpoint lists the steps that bring them back in `resume`
  (`flamer-ep2-part2-end.json` has the four for the Qualle start).
- **The seamless check finds what is missing.** It stops when more than 0.3 % of the first frame
  differs from the checkpoint's last frame, names the area, and writes `seam.jpg`. Add the missing
  view to `resume`, or pass `--no-seam` when the cut does not join there.
- **A checkpoint belongs to its origin and size.** The project lives in the storage of
  `http://localhost:5192`; a take with another `--url` or viewport refuses the checkpoint.
- **A failed take saves no checkpoint**; the previous one stays as it was.

### Recording and timing

- **Heavy pages make gestures late.** In the node workspace with Weave running, steps came 1–3 s
  late. Fix one part with larger `early` values. The structural fix is in [`plan.md`](plan.md): place
  each voice line by the recorded step times.
- **Drags in long setups and heavy scenes are slow.** A `connect` takes about 2.5 s, a `cableClick` about
  2 s and a value `drag` about 1.4 s. Start them one word earlier (part 3: `connect` at "and", the
  cable click at "So" or "perfect") and give them `approach` and `ms` of 300–600.
- **A missing target fails the step.** `locate` retries for 1.5 s, then the take stops. The recording
  up to that point is kept, so `--recut` can show it.
- **The pointer needs a start point.** A part from a checkpoint starts where the last part left the
  pointer; otherwise `recipe.pointer`, or mid-frame.
- **Pixel offsets depend on the layout.** At 2560×1440 the panels are proportionally larger: the moved
  Preview drops at `@14,660`, the node group widens by `~600,0`, the timeline shrinks by `~0,200`.
  Offsets around a control (`~250,0` into a submenu, `~-150,70` beside a node card) stay the same.
- **A scene lasts at least as long as its sentence.** A recorded voice keeps its own pauses: each
  scene lasts until the next scene's first word.

### Editor state and the test project

- **The test project is real.** Text typed into a menu that is not open goes to the timeline as
  shortcuts. In episode 2, a Delete after a card click removed the clip (fixed in MS since). `type`
  now stops when no text field has the focus; open the menu or field first (`click … until`).
- **Load Default Layout through the menu is flaky** (hover timing). Use the step
  `{ "defaultLayout": true }`: it loads the layout and checks that it stays.
- **A layout reset drops the node graph source** (Timeline / Active / clip). Do the node setup after
  the last layout reset.
- **The clip must start at 0.** With the playhead at 0 and the clip at 0.05 s, the preview stayed
  black for a whole part, and Roman found it. Add Layer now starts a clip at the beginning of the
  empty space under the click (0 on an empty track); check it with
  `{"expect": {"clip": {"name": "Blank", "start": 0}}}`.
- **`previewNotBlack` is for clips that should show something.** An empty Weave is black on purpose.
- **The new project's name goes into the dialog field.** Until 2026-10-24 the pipeline typed it before
  the dialog was open; the letters of "Qualle" reached the timeline as shortcuts (`l` played), and the
  setup then ran against a playing project: menus closed mid-glide, a clip or the whole comp was gone.
  If a setup behaves at random, look at the setup pictures for a running playhead first.
- **Shortcuts:** L plays forward; the loop toggles with **Shift+L** (the tooltip said "L" until
  `54715ba9d`). Say the right key in the narration.
- **Dock tabs need a hold before they drag.** Use `hold: 650` on the drag step (MS waits 500 ms).
- **Composition Settings** has "Switch to 9:16 portrait". The preview has "Hide playback controls".
  Both are good visual jokes.

### Targets

- **Visible text can be ambiguous.** `button:Fit` hit the timeline's "Fit composition to window" instead
  of the node canvas Fit. Scope the target to a dock group: `Fit@left-group`.
- **Moved dock groups get generated ids.** After the Preview tab moves, its group is no longer
  `preview-group`. Use `pane:tab=Preview:x,y`.
- **`aria:<label>[@group]`** picks the largest match on screen. `option:<label>` targets a menu
  entry, and `input:<value>` targets a field by its value.

### Node workspace

- **Cards and ports are drawn on a canvas.** A port becomes a DOM element only while the pointer
  hovers it. Use the steps `connect`, `marquee` and `cableClick`, which find ports by hovering near
  them (`portNear`), instead of hand-made coordinates.
- **Right button:** a right-drag on the canvas draws a selection marquee. A right-click on the canvas
  opens the add menu. A right-click on a cable opens the insert menu, and its search field takes
  typing at once.
- **Linux sends `contextmenu` on press, not on release.** MS now holds it during a right gesture and
  opens the menu on release only if there was no drag. Keep this in mind if a menu pops up mid-drag.
- **Fit in a short canvas leaves the graph tiny.** Shrink the timeline before Fit
  (`drag handle:left-group:bottom ~0,200` at 2560×1440). Fit may also count hidden folder nodes; that
  is not checked yet.
- **The selected clip shows a move gizmo in the preview** (red and green arrows). It is visible in
  part 3; hide it before the next takes if it distracts.
- **Emptying Weave:** open the group, marquee Weave Pattern, Handmade, Reveal by Shape, Weave In,
  Yarn and Wind Cloth, then press Delete. Strand Render and Output stay. Then add Knit Sphere, connect
  it to Strand Render, and insert Yarn Profile into that cable.
- **Adding inside the open Weave group:** right-click about `~-150,70` from Strand Render (inside the
  group frame); the new node lands in the group. A node added or inserted into a cable is selected,
  so the node inspector on the right shows its parameters at once (Yarn Profile: Plies, Fibers per
  Ply, Radius, Ply Twist …). Targets: `Plies@left-group`, `aria:Yarn Profile Radius`.
- **The node inspector comes back when the Nodes tab is opened again.** "Hide node inspector" in the
  setup does not survive a switch to Media and back; plan the take with the inspector open.
- **Dragging a value field:** the recording tab has no pointer lock (scripted moves cannot drive a
  locked drag; the value jumped tenfold). Node parameters move at most one step per pixel since
  2026-10-24, so `{"drag": "aria:Yarn Profile Radius", "to": "~19,0"}` adds about 0.025.
- **The Weave group's frame** is `aria:Weave node group@left-group`; the empty Weave shows a black
  preview until a curve generator feeds Strand Render.
- **Edit mode for the Weave clip is 2D** (move, scale, zoom). The 3D workspace views do not show the
  Weave scene. Orbiting an effect (`cameraInteraction`) exists only for voxel relief so far.

### Voice

- **One voice for every tutorial:** ElevenLabs `nQ95rSg3xpIIuIQxL1w6` ("flamer"). Use it with
  `ELEVENLABS_BROWSER_API_KEY`; the other account has no credits for it.
- **Model:** the code defaults to `eleven_v3`. Episode 2 sets `eleven_v4` in the recipe; keep that
  for new parts.
- **The whole narration is one request.** A changed sentence regenerates the whole part and costs
  credits for every line again. [`plan.md`](plan.md) changes this to one request per line. Until then,
  iterate with `--voice none`.
- **Audio tags** such as `[excited]` are directions, not words. They are left out when words are
  counted and matched. If the voice returns a different word count, the log warns that captions may
  drift.
- **A recorded voice** (Roman's own take, or a file from the ElevenLabs site) is timed with Deepgram.
  Each scene's `say` must hold its words in spoken order. Cut a part's audio out of a longer file
  with ffmpeg first (`flamer-ep2-part1.mp3` is 0–27.124 s of the episode 2 narration).

### Audio and ffmpeg

- **Never put `apad,atrim` behind `amix`.** With a mono MP3 it made ffmpeg hang. The mixes start from
  an `anullsrc` base input and split it with `asplit` (`tutorialMusic.mjs`, `tutorialCut.mjs`).
- **Music cues** are fixed by Roman (intro from 0:19.6 of the track, ending from 2:26). The README has
  the numbers. Use the same cue for intermediate renders.

### Intermediate render

Join the parts with the concat demuxer (`-c copy`, same encoding settings). Extract the joined voice
as WAV, mix the intro cue with `mixMusic` from `tutorialMusic.mjs`, and mux it back. The result goes
to `tutorial-videos/<episode>-zwischenstand.mp4`. This step should become the cut in MS
([`plan.md`](plan.md)).
