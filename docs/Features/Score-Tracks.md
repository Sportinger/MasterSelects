# Score Tracks

Infrastructure for the upcoming scorewriter (issue #366): a `score` track type
that lives in the timeline's audio section, holds data-only score clips, and
opens a detached score-editor window. The notation surface itself is not built
yet — the current editor window is a placeholder that proves the wiring.

## Creating a score track

Right-click any track header (audio-side headers included) and choose
**+ Add Score Track** from the track context menu, next to the existing Video /
Audio / MIDI entries. Score tracks:

- render at the bottom of the audio section (`isAudioSectionTrackType`),
- insert at the bottom like audio and MIDI tracks,
- use a warm parchment identity tint (`--score-color` in
  `src/styles/tokens.css`, mirrored as `SCORE_TRACK_COLOR` in
  `src/components/timeline/trackColor.ts`) unless a label color is set,
- use the full mixer header like MIDI (type badge, M/S, pan/fader strip in the
  advanced audio layer) with a beamed-note glyph (`ScoreTrackTypeIcon`) as the
  badge; only the MIDI instrument selector stays MIDI-specific,
- join the audible mute/solo group (`isAudibleTrack`) so their M/S buttons
  behave like the other musical lanes, even though they emit no audio yet,
- use the `stack` overlap policy like MIDI: overlapping score clips coexist,
- reject external media drops, like MIDI tracks.

Right-clicking empty space in the track-header column (below the last track,
either section) opens an add-only track menu with the same four add-track
entries, so a track can be inserted without aiming at an existing header.

## Creating score clips

The MIDI pencil tool (`midi-draw`) also draws on score tracks: click-drag on
empty score-lane space paints a clip over the dragged range; a plain click
creates a default 4-second clip (`useMidiClipDraw` →
`addScoreClip` in `src/stores/timeline/midiClipSlice.ts`). Score clips are
data-only clips with `source.type === 'score'` and a placeholder file, like
MIDI/solid/text clips, and they persist through both the in-memory
serialize/load cycle and project save/load.

## Score editor window

Double-clicking a score clip opens (or focuses) a detached score-editor popup
bound to that clip (`src/components/scoreEditor/ScoreEditorBoot.ts`, modeled on
the piano-roll boot: same-origin popup, shared JS heap and Zustand store, one
window per clip). `ScoreEditor.tsx` currently renders placeholder text with the
clip name and timing.

## Kernel boundary note

The pinned v1 kernel fingerprint contract only understands
`audio | midi | video` tracks. Score tracks are filtered out before
fingerprinting (`isPublicTimelineFingerprintTrackTypeV1`); their clips are
fingerprint-ineligible, so a timeline's digest is unchanged by score tracks.
The contract constants themselves are untouched.
