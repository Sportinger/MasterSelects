# Tutorial videos

Narrated screen recordings of the real editor, made from a recipe, for the website and the social
channels. The pointer is the presenter: it points, circles, drags panels and clicks, each move timed
to a word of the voice. The camera only zooms lightly, for emphasis.

Takes record in a headless Chrome at 2560×1440 and 100% scale, and the cut makes 1920×1080 from it.
An episode is made of short parts (about 20 s or less). Each part continues from the checkpoint the
previous part left, so parts join seamlessly and a part needs no long setup. Every part goes into the
episode's MasterSelects project, where the tutorial is cut and exported.

**Agents start with [`guides/agents.md`](guides/agents.md)**: how the work goes with Roman, the
session setup, and every pitfall so far. [`guides/plan.md`](guides/plan.md) lists what is built and
what is still open.

## Folders

| Path | What | In git |
|---|---|---|
| `scripts/tutorials/<name>.json` | the recipe: voice, scenes, pointer steps | yes |
| `scripts/tutorials/audio/` | voice recordings (`.mp3`, `.wav`), the music the recipes use, and the generated voice lines (`voice/<part>/<scene>-<hash>.mp3`) | no, local only |
| `scripts/tutorials/guides/` | how to write the voice script: `elevenlabs-script.md` (audio tags, Episode 1 as the example) and `kramer-style.md` (tone and jokes) | yes |
| `tutorial-videos/<name>.cut/` | the material for the cut in MasterSelects: the picture `<name>.mp4` (no sound, no captions), `voice/<name>.NN-<scene>.wav` (one file per line), `edl.json` | no |
| `tutorial-videos/<name>.mp4` | a quick look: picture and voice | no |
| `tutorial-videos/<name>.work/` | screencast frames, `recording.json`, the voice, the pictures (`setup.jpg`, `scenes.jpg`, `seam.jpg`, `*.failed.jpg`) and the profile copy of the take | no |
| `tutorial-videos/checkpoints/<name>/` | a checkpoint: Chrome profile, `checkpoint.json`, `last.png` | no |
| `tutorial-videos/.tab/` | the build server: its profile, pictures (`work/steps/`, `shots/`) and jobs | no |

## Requirements

- The Vite dev server of this checkout: `npx vite --port 5192 --strictPort`. The default `--url` is
  `http://localhost:5192`.
- Google Chrome, `ffmpeg`, and the Playwright package from `npm ci`. Takes run in a headless Chrome
  with the hardware GPU (Vulkan); nothing opens on the desktop and Chrome asks for no permission.
- `DEEPGRAM_API_KEY` in the environment for a recorded voice (word timing), or
  `ELEVENLABS_BROWSER_API_KEY` for a voice generated from the recipe text (see "The voice").
- Only for `--attach` (trying something in your own Chrome): remote debugging on at
  `chrome://inspect/#remote-debugging`. Its screencast is 1280×720, so it is not for takes.

## The voice

Every MasterSelects tutorial speaks with one voice, "Dominik Flamer": the ElevenLabs voice
`nQ95rSg3xpIIuIQxL1w6`, model `eleven_v3`. It is the default (`"voice": { "voice": "flamer" }`).
The voice belongs to the ElevenLabs account whose key is `ELEVENLABS_BROWSER_API_KEY`; without that
key the pipeline tries `ELEVENLABS_API_KEY`. Make recorded voice files with the same voice.

A recipe without `audio` sends every scene's `say` to ElevenLabs as its own line and caches each line
in `audio/voice/<recipe>/` by its text and settings, so a changed sentence costs only that line and a
new take or `--recut` costs nothing. Each line becomes its own clip in the MasterSelects cut. A scene's
`speed` (0.7–1.2) slows its line, and its `tail` sets the pause after it. `--voice none` times the
words at an even pace instead, to check a take before paying for the voice. `"voice": { "whole": true
}` speaks the whole part in one request (recipes recorded before 2026-10-26).

## The music

The tutorial music is `audio/tutorial-music.wav` (2:44.8; local like the voice files). It plays
twice, set in the recipe's `music.cues`. Times are seconds of the video unless they say "track".

- **Intro:** the track from 0:19.6 at the start of the video. It fades in over 400 ms, stays at
  full level until 1.6 s, goes down to −7 dB by 2.0 s, then fades out slowly until it is silent at
  23 s.
- **Ending:** the track from 2:26 to its end, placed so that it ends with the video. It fades in
  slowly over 6 s to −7 dB.

```json
"music": {
  "file": "audio/tutorial-music.wav",
  "cues": [
    { "at": 0, "from": 19.6, "volume": [[0, -60], [0.4, 0], [1.6, 0], [2.0, -7], [23, -60]] },
    { "end": true, "from": 146, "volume": [[0, -60], [6, -7]] }
  ]
}
```

A cue starts `at` a video time, or with `"end": true` it ends with the video. `from` and `to` are
track times (`to` defaults to the end of the track). `volume` lists points as
`[seconds after the cue starts, dB]`; between two points the level moves in a straight line, like a
fader. −60 dB means silence, and a cue that fades to silence stops there. The mix is limited, so
voice and music together do not clip. To try other cues without recording a new take, run with
`--recut`.

## Make a video from a voice recording

1. Put the voice file into `scripts/tutorials/audio/`, for example `audio/my-episode.mp3`.
2. Write a recipe (the format is at the top of `scripts/tutorial-video.mjs`). Set `name`, set
   `"audio": "audio/my-episode.mp3"`, and split the transcript into scenes. Each scene's `say`
   holds its words in the order they are spoken. Audio tags such as `[whisper]` may stay in.
3. Build it: `node scripts/tutorial-video.mjs scripts/tutorials/my-episode.json`. While you build a
   part, use the build server instead (next section): `make` there runs the same take.
4. Watch `tutorial-videos/my-episode.mp4`, the quick look; `--captions` burns the word captions in when
   the video is not cut in MasterSelects. To change only the camera or the sound, add `--recut`: it
   encodes the kept recording again without recording a new take.

## Cut in MasterSelects

A take writes `tutorial-videos/<name>.cut/`: the picture, one file per voice line, and `edl.json`
(where each line starts in the picture, and its word times). Put the part into the project that is
open in the cut editor (the dev server's editor, `npm run dev:full` in the main folder):

```bash
node scripts/tutorial-ms-cut.mjs scripts/tutorials/<part>.json            # after the last part
node scripts/tutorial-ms-cut.mjs scripts/tutorials/<part>.json --replace  # a retake of a part already there
```

It uses the AI bridge of the editor at `--editor` (default `http://localhost:5173`). The picture goes
onto the video track "Picture", each line onto the audio track "Voice", and a caption clip onto the
video track "Captions" above. Every line clip carries its word times (`setClipTranscript`), so the
captions stay with a line that is split or moved. Trim, move lines, add the music and export there.

## Parts, checkpoints and the build server

An episode is recorded in parts of about 20 seconds or less (the take warns above 20 s). A finished take saves its end as a checkpoint
named after the recipe (or its `checkpoint`). The next part starts with `"from": "<checkpoint>"`:
its take runs on a copy of that checkpoint's Chrome profile, so the project, the layout and the
settings are there, and playhead, selection and pointer come back. Views the editor keeps only in
memory (hidden playback controls, the Properties tab, a selected media row) come back through the
`resume` steps that the earlier part's recipe lists. Before recording, the take compares its first
frame with the checkpoint's last frame and stops if they differ (`seam.jpg` shows both and the
difference). A retake always starts from the clean checkpoint.

A start state that no take has left yet comes from a recipe with only `setup` and `resume`, saved
without recording: `node scripts/tutorial-video.mjs scripts/tutorials/<part>-end.json
--setup-only --save <checkpoint>` (about a minute for 40 steps).

The build server keeps one editor open in the same headless Chrome, for building a setup step by
step and looking at every step:

```bash
node scripts/tutorial-tab.mjs serve --from <checkpoint>   # or without --from: a new project
node scripts/tutorial-tab.mjs step '{"click": "Nodes@left-group"}' '{"pause": 800}'   # a picture after each
node scripts/tutorial-tab.mjs locate 'aria:Strand Render@left-group'   # where a target is, marked in a picture
node scripts/tutorial-tab.mjs state            # clips, playhead, playing?, panels, focus
node scripts/tutorial-tab.mjs shot             # a picture of the page
node scripts/tutorial-tab.mjs checkpoint my-start '[<resume steps>]'
node scripts/tutorial-tab.mjs make scripts/tutorials/<part>.json   # a take; then the editor shows its end
```

Every setup step leaves a picture in `<work>/steps/` and all of them in `<work>/setup.jpg` (16 per
sheet). A take leaves the frame after every scene step in `<work>/scenes.jpg`. A failed step stops
with its name and `<step>.failed.jpg`: the page before and after it, the error and the editor's
latest warnings. `--no-shots` skips the setup pictures.

## Writing scenes

A scene is one sentence or one beat. With a recorded voice, each scene lasts until the next scene's
first word, so the pauses of the recording stay as they are. Set `"captions": "top"` when the action
happens in the lower half of the screen.

The steps of a scene run in order. `{ "word": "timeline", "early": 0.25 }` waits until 0.25 s before
that word is spoken; `nth` picks a repeated word. The steps:

| Step | What the pointer does |
|---|---|
| `move`, `click` (`until`: text) | glides there; clicks (again until that text shows) |
| `drag` … `to` (`via`: points) | presses, drags through the via points, releases: a panel edge, a node |
| `circle` (`r`, `ry`, `turns`) | loops around a control: "right here we've got …" |
| `wave`, `nod` (`amp`, `cycles`) | swings sideways (hello) or up and down (yes) |
| `trace` (`curve: true`) | follows a line, such as a node cable |
| `connect`, `marquee`, `cableClick` | drags a cable between two node cards' ports; right-drags a selection around cards; right-clicks a cable |
| `type`, `press`, `key` | types into the focused field (stops if no field has the focus: letters elsewhere are timeline shortcuts), presses a key, or presses a key and shows its cap |
| `files`, `pick`, `dropFiles` | a desktop window with media files, dragged into the editor |
| `camera` | `"all"`, dock groups, or `{ "focus": <target>, "zoom": 1.2 }` with `ms` |
| `waitFor`, `pause` | waits for media, clips, a download, a text, or a fixed time |
| `defaultLayout` | (setup) loads the default dock layout and checks that it stays |
| `expect` | checks the editor and stops with what differs: `clips`, `clip: { name, start, end }`, `playing`, `playhead`, `selected`, `text`, `gone`, `previewNotBlack` (times within 0.1 s) |

Targets are visible text (`"File"`, `"Nodes@left-group"`), `button:<name>`, `pane:<group>:<x>,<y>`,
`node:<node id>`, `handle:<group>:right` (a panel edge), `pane:tab=<tab>:<x>,<y>` (a moved dock group),
`aria:<label>[@group]`, `option:<menu entry>`, `input:<value>`, `clip:`, `time:`, `ruler:`, or `~dx,dy`
relative to the pointer. A `camera` names dock groups by id or as `tab=<tab>` (`["tab=Preview",
"left-group"]`). `setup` holds steps that run on the open project before the recording starts;
`storage` resets editor settings before the editor loads. The complete format is described
at the top of `scripts/tutorial-video.mjs`.

Keep zooms light (1.05 to 1.3) and use them for feeling: a slow push in for suspense, a quick snap
back on the punchline.

## Timing a take

After each scene the log says whether a step came late (`late for "organized"`) or the scene ran
over. Shorten that step's `ms` or `after`, or start it earlier with a larger `early`, then run
`make` again. Fine shifts of a voice line need no retake: move its clip in the MasterSelects cut.
