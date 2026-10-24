# Tutorial videos: handbook for agents

Read this before you work on a MasterSelects tutorial video. [`../README.md`](../README.md) explains
the recipe format and the commands. This page covers how the work goes with Roman, the setup of a
session, and every pitfall we have hit so far. [`plan.md`](plan.md) is the plan for the next version
of the pipeline: the voice line by line, and the final cut in a MasterSelects project.

## Quick start

1. Read "How Roman wants it" below. Skim the pitfalls of the area you will touch.
2. Session setup (below): worktree, Vite on 5192, secrets, `tutorial-tab.mjs serve`, and one Allow
   click by Roman.
3. Copy the last part recipe (`flamer-ep2-part2.json`) and write the scenes.
4. `make … --voice none` until the steps work, then `make` with the voice.
5. Check the contact sheet, show Roman, commit the recipe.

## What we make

Video Copilot style tutorials (Andrew Kramer) with the presenter "Dominik Flamer". The screen
recording shows the real editor of this checkout. A drawn pointer acts like a human presenter: it
points, circles, drags panels and clicks, timed to the words. Tone and jokes:
[`kramer-style.md`](kramer-style.md). Voice script and audio tags:
[`elevenlabs-script.md`](elevenlabs-script.md).

| Episode | State | Recipes |
|---|---|---|
| 1 | done. Roman's recorded voice, music, pointer gestures | `flamer-episode-1.json` |
| 2, "Knitted Jellyfish" (Weave, Qualle form) | parts 1 and 2 recorded; an older one-piece version exists | `flamer-ep2-part1.json`, `flamer-ep2-part2.json`, `flamer-episode-2.json` |

Episode 2 still needs:
- the parts after `yarn` (the scenes `form` … `outro` of `flamer-episode-2.json`, rebuilt in the new
  part style);
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
- **Zooms are light and emotional** (1.05–1.3): a slow push in for suspense, a quick snap back on the
  punchline.
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
3. Roman's Chrome: open it with `/home/admins/.local/bin/chrome-angemeldet` if needed. Remote debugging
   must be on at `chrome://inspect/#remote-debugging`.
4. Start the build server in the background: `node scripts/tutorial-tab.mjs serve` (with the secrets
   loaded). Tell Roman to click **Allow** in Chrome. He has to do this once per server start, so keep
   the server running for the whole session.
5. Each take: `node scripts/tutorial-tab.mjs make scripts/tutorials/<recipe>.json`. If you changed only
   the camera, captions or sound, add `--recut`. To find a target, use
   `node scripts/tutorial-tab.mjs eval '<code>'`: it runs a snippet in the recording tab.

## Making a part

1. Write the part's scenes into its own recipe. One scene is one beat; its `say` follows the style
   guides. Put the joke where the action gives it.
2. Build the start state in `setup`. The setup is not recorded. It runs on the open project before
   the take: load the default layout, build the finished effect for an intro, set loops, resize panels.
3. Try the take with `--voice none` until the steps work. That costs no credits. Then generate the
   voice and record.
4. Read the log: `late for "<word>"` and scenes that ran over. Fix the steps (`early`, `ms`, `after`)
   and run `make` again.
5. Check the contact sheet of the key moments, then show Roman the part.
6. Commit the recipe on the task branch. Audio and videos stay local (`audio/`, `tutorial-videos/`).

## Pitfalls

### Chrome and the connection

- **Every new DevTools connection asks Roman to click Allow.** Use the build server; it keeps one
  connection open. It retries a refused (403) or timed-out connection for about 2 minutes, so tell
  Roman at once when you start it. `--attach` without the server asks again on every run.
- **Do not start a separate Chrome by mistake.** Without `--attach` or the server, `tutorial-video.mjs`
  starts its own Chrome profile. That is not Roman's browser, and he noticed ("du startest die mit
  falscher Flag").
- **Never navigate or close Roman's own tabs.** The recorder opens its own tab and reuses it between
  takes. Tab ids shift, so use only the page the server opened.
- **Navigation drops the viewport emulation** (1280×720 at 2×). The pipeline re-applies it on
  `domcontentloaded` and checks it. Keep it that way when you change the browser code.
- **The real mouse disturbs hovers.** If it crosses the Chrome window, the log warns. Roman should
  not touch that window during a take.

### Recording and timing

- **Takes are 720p, scaled up.** Chrome's screencast sends the window's own pixels (1280×720). The
  recipe's `scale: 2` does not raise that. Roman wants 1800p; [`plan.md`](plan.md), stage 4, has
  the measurements and the way there.

- **Heavy pages make gestures late.** In the node workspace with Weave running, steps came 1–3 s
  late. Fix one part with larger `early` values. The structural fix is in [`plan.md`](plan.md): place
  each voice line by the recorded step times.
- **A missing target fails the step.** `locate` retries for 1.5 s, then the take stops. The recording
  up to that point is kept, so `--recut` can show it.
- **The pointer needs a start point.** Without `recipe.pointer` it starts mid-frame.
- **A scene lasts at least as long as its sentence.** A recorded voice keeps its own pauses: each
  scene lasts until the next scene's first word.

### Editor state and the test project

- **The test project is real.** Text typed into a menu that is not open goes to the timeline as
  shortcuts. In episode 2, a Delete after a card click removed the clip (fixed in MS since). Before
  `type`, make sure the menu or field is open and focused, for example with `click … until`.
- **Load Default Layout through the menu is flaky** (hover timing). Use the step
  `{ "defaultLayout": true }`: it loads the layout and checks that it stays.
- **A layout reset drops the node graph source** (Timeline / Active / clip). Do the node setup after
  the last layout reset.
- **The clip must start at 0.** With the playhead at 0 and the clip at 0.05 s, the preview stayed
  black for a whole part, and Roman found it. Drag new clips to the start
  (`drag clip:<name>:middle → time:…@Video 1`) and check the preview in the contact sheet.
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
- **Fit in a short canvas leaves the graph tiny.** The node canvas was only 277 px high, so Fit had
  little room. Shrink the timeline in `setup` (`drag handle:left-group:bottom ~0,140`) before Fit.
  Fit may also count hidden folder nodes; that is not checked yet.
- **Emptying Weave:** open the group, marquee Weave Pattern, Handmade, Reveal by Shape, Weave In,
  Yarn and Wind Cloth, then press Delete. Strand Render and Output stay. Then add Knit Sphere, connect
  it to Strand Render, and insert Yarn Profile into that cable.
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
