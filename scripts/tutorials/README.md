# Tutorial videos

Narrated screen recordings of the real editor, made from a recipe, for the website and the social
channels. The pointer is the presenter: it points, circles, drags panels and clicks, each move timed
to a word of the voice. The camera only zooms lightly, for emphasis.

## Folders

| Path | What | In git |
|---|---|---|
| `scripts/tutorials/<name>.json` | the recipe: voice, scenes, pointer steps | yes |
| `scripts/tutorials/audio/` | voice recordings (`.mp3`, `.wav`) and the music the recipes use | no, local only |
| `scripts/tutorials/guides/` | how to write the voice script: `elevenlabs-script.md` (audio tags, Episode 1 as the example) and `kramer-style.md` (tone and jokes) | yes |
| `tutorial-videos/<name>.mp4` | the finished video | no |
| `tutorial-videos/<name>.work/` | screencast frames, `recording.json`, cached transcript | no |

## Requirements

- The Vite dev server of this checkout: `npx vite --port 5192 --strictPort`. The default `--url` is
  `http://localhost:5192`.
- Google Chrome, `ffmpeg`, and the Playwright package from `npm ci`.
- `DEEPGRAM_API_KEY` in the environment for a recorded voice (word timing), or
  `ELEVENLABS_BROWSER_API_KEY` for a voice generated from the recipe text (see "The voice").
- To record in your own Chrome, turn on remote debugging once at `chrome://inspect/#remote-debugging`.

## The voice

Every MasterSelects tutorial speaks with one voice, "Dominik Flamer": the ElevenLabs voice
`nQ95rSg3xpIIuIQxL1w6`, model `eleven_v3`. It is the default (`"voice": { "voice": "flamer" }`).
The voice belongs to the ElevenLabs account whose key is `ELEVENLABS_BROWSER_API_KEY`; without that
key the pipeline tries `ELEVENLABS_API_KEY`. Make recorded voice files with the same voice.

A recipe without `audio` sends its scene texts to ElevenLabs in one request and caches the result
in the work folder, so a new take or `--recut` costs no further credits. `--voice none` times the
words at an even pace instead, to check a take before paying for the voice.

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
2. Copy a recipe (`flamer-episode-1.json` is a complete example). Set `name`, set
   `"audio": "audio/my-episode.mp3"`, and split the transcript into scenes. Each scene's `say`
   holds its words in the order they are spoken. Audio tags such as `[whisper]` may stay in.
3. Build it. For iterating, use the build server: it keeps one connection to Chrome open, so
   Chrome asks to allow it only once:

   ```bash
   node scripts/tutorial-tab.mjs serve                                   # once; allow it in Chrome
   node scripts/tutorial-tab.mjs make scripts/tutorials/my-episode.json  # every take
   ```

   For a single run there are two other ways: add `--attach` to record in your own Chrome (it asks
   to allow the connection every run), or leave it out to record in a separate Chrome window:
   `node scripts/tutorial-video.mjs scripts/tutorials/my-episode.json`.
4. Watch `tutorial-videos/my-episode.mp4`. To change only the camera, the captions or the sound,
   add `--recut`: it encodes the kept recording again without recording a new take.

During a take, keep the real mouse off the Chrome window and do not switch tabs. If the real mouse
crosses the window, the log warns about it.

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
| `type`, `press`, `key` | types text, presses a key, or presses a key and shows its cap |
| `files`, `pick`, `dropFiles` | a desktop window with media files, dragged into the editor |
| `camera` | `"all"`, dock groups, or `{ "focus": <target>, "zoom": 1.2 }` with `ms` |
| `waitFor`, `pause` | waits for media, clips, a download, a text, or a fixed time |

Targets are visible text (`"File"`, `"Nodes@left-group"`), `button:<name>`, `pane:<group>:<x>,<y>`,
`node:<node id>`, `handle:<group>:right` (a panel edge), `clip:`, `time:`, `ruler:`, or `~dx,dy`
relative to the pointer. `setup` holds steps that run on the open project before the recording
starts; `storage` resets editor settings before the editor loads. The complete format is described
at the top of `scripts/tutorial-video.mjs`.

Keep zooms light (1.05 to 1.3) and use them for feeling: a slow push in for suspense, a quick snap
back on the punchline.

## Timing a take

After each scene the log says whether a step came late (`late for "organized"`) or the scene ran
over. Shorten that step's `ms` or `after`, or start it earlier with a larger `early`, then run
`make` again.
