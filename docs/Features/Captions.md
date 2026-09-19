[Back to Documentation](./README.md)

# Dynamic Captions

Dynamic caption clips render timed transcript words as ordinary canvas-backed
Text clips. Typography, paragraph bounds, transforms, color, effects, preview,
and export therefore use the normal text/render path while caption properties
control transcript selection, cue grouping, timing, line paging, background,
and word highlighting.

## Sources and timing

- `Auto - active transcript` follows the top-most transcript-bearing video or
  audio clip at the current timeline frame. A caption can also pin one source.
- Transcript timestamps remain in media-source time. Preview and export map the
  playhead through clip placement, trim points, speed, reverse state, and
  transition source mappings before selecting the active word.
- Words are grouped by `Words`, split on gaps larger than `Gap`, and remain
  visible for the configured `Hold` time without crossing the next cue.
- Cue groups restart at the visible in/out window of every source segment and
  at the caption clip's own timeline boundaries. Words beginning before a cut
  are not carried into the incoming segment.
- Transcript Source remains a deliberate dropdown: mouse-wheel scrolling over
  the closed control scrolls the panel and never changes the selected source.

## Lines and layout

`Lines` sets a strict visible-line limit from 1 to 10. The caption text area
grows when the limit increases. When a word group wraps beyond the limit, the
renderer pages the group according to the currently spoken word instead of
clipping or permanently hiding overflow words. For example, `Lines = 1` keeps
the preview and export single-line while advancing to later wrapped words as
they are spoken.

Wrapping, alignment, and position use the Text section's editable Area Text
bounds. The Caption tab also exposes case transformation, background styling,
and active/spoken/group highlight modes, including text color, word background,
underline, and optional active-word scale.

Discrete caption choices use compact responsive pills. Typography pills show
the selected font in the represented weight or style; all nine standard weight
slots remain visible, while weights unavailable for the selected family are
dark and disabled. The font-family control remains a compact dropdown. Caption
typography changes repaint the current transcript frame immediately, including
after asynchronous font loading, without exposing the stored preview placeholder
or requiring a playhead movement.

## Direct word corrections

While playback is paused, double-click any visible caption word directly in the
Preview to correct it in place. `Enter` saves the replacement and `Escape`
cancels it. Editing is deliberately limited to one word per timing slot, so the
word's source start/end timestamps, trim mapping, and synchronization do not
change.

The corrected word is written to the media-level transcript and propagated to
every split clip that uses the same media. Hybrid transcript artifacts retain
their original provider runs and record the correction as a manual text patch.

## Runtime ownership

Durable caption settings live in `CaptionClipProperties`; transcript words stay
on the media/clip transcript artifact. The renderer creates a frame-local text
document and never writes generated caption strings back into durable Text clip
content. The same caption runtime is called by interactive preview and export.
