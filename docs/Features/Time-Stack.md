[Back to Features](README.md)

# Time Stack

Add **Time > Time Stack** to a video clip, then open its group in the Nodes workspace.
The default is 20 instances, 0.1 seconds between starts, blended with **Lighten**
(lit performers on a dark stage leave bright trails) and Decay 0.8. Use **Darken** for a
dark subject on a bright background. The inspector exposes Instances (1–32), Time offset
(0–10 seconds), Decay (0–1, keyframeable), Blend mode (all 37 timeline modes, grouped by
family), preview resolution, and GPU frame-cache budget (640 MiB to 4 GiB).

At clip time `t`, instance `i` reads `t - i × offset` and blends with opacity
`decay^i`: at Decay 0.8 the fifth instance keeps 41 % and the twentieth 1.4 %, so the
trail fades like an echo. Decay 1 keeps every instance at full opacity; values outside
0–1 are used at the nearest limit (0 as 0.0001), values that are not a number (NaN, text)
at 0.8, and the inspector and tool results say so. Only
instances whose start has been reached participate. Twenty instances at 0.1 seconds
span 1.9 seconds. Zero offset starts all instances together. One instance passes the
current image.

Decay fades the copies in modes that combine them, such as Lighten, Darken, Screen or
Add. Sequence Blend draws the current frame first and each older copy over it, so modes
that cover what is below (**Normal**) bury the current frame under the faded copies: at
Decay 0.8 and 20 instances it keeps under 1 % of the result (at Decay 1 none). The
inspector says so when Normal is chosen with Decay below 1.

Saved projects keep their look: a Time Stack stored without Decay (a project or an
effect preset from before Decay existed) renders with Decay 1, the parameter's
`legacyDefault`, in the graph, the inspector and the property registry, and saving
writes that 1 (`migratePersistedEffectOperatorGraph`); its stored blend mode stays,
untouched saved graphs gain the Decay nodes, and graphs edited before Decay existed
stay as saved (the inspector notes that Decay has no effect there, and tools report it
for `decay`).
The effect does not extend the clip's duration or repeat its audio.

The editable graph uses a Sequence Index, delay multiplication, Sample Past
Frame, a Decay power (`decay^index`, clamped) and Sequence Blend. Fifteen nodes
represent the entire stack; the GPU
loops over the samples instead of expanding twenty separate decoder branches.
Sequence Blend is reusable with other image sequences. Its numeric modes are
0 Darken, 1 Lighten, 2 Multiply, 3 Screen, 4 Normal; remaining modes follow
timeline order. RGB formulas share the timeline shader library. Opacity multiplies
each sample's alpha; the first sample seeds the stack and subsequent samples
composite in straight alpha. Stencil/Silhouette mask accumulated alpha. Dissolve
uses pixel position; Dancing Dissolve additionally uses timeline time.

Mode changes only update uniform values, preserving the source cache and compiled
shader. Cache status renders separately from the controls so loading progress
does not redraw an open blend menu. Hover highlighting uses CSS without per-option
React renders. The mouse wheel changes closed dropdowns; in an open menu it
scrolls the list. Keyboard arrows keep the active option visible.

## Source and quality

History comes from original video source timestamps through SourceFrameService,
including trims, speed mapping and reverse clips. It does not depend on previous
playback. Historical instances read the source before preceding effects; place
shared processing after Time Stack. The current instance uses the current input.
This requires a video source clip, not a still image or nested composition.

Full preview is the default and uses original source resolution without proxies.
Small preview is an explicit 960-pixel option. The resident GPU cache preloads the
continuous source interval when it fits; otherwise its spare slots are spread
across every delayed instance. Advancing playback keeps pending decodes alive.
Changing cache size does not change resolution, samples or blending.

The default cache budget is 1 GiB. Larger time spans, sources, or counts can need
more memory for continuous playback. The cache reserves only the estimated window
plus lookahead, subject to the selected budget and device limits. Initial playback
or a distant seek can wait for preparation. Preview holds the last complete image
during misses; export waits for exact originals and reports resource failures.
No universal real-time rate is guaranteed when the window cannot stay resident.

The Time Stack owner supplies the discrete `i × offset` source window. Editing
the graph's delay arithmetic does not expand that window automatically. Use the
Time offset control for supported time changes. General image owners still need
an explicit temporal resource owner to execute Sample Past Frame.
