---
title: "Time Stack"
---

Add **Time > Time Stack** to a video clip, then open its group in the Nodes workspace.
The default is 20 instances, 0.1 seconds between starts, blended with **Darken**.
The inspector exposes Instances (1–32), Time offset (0–10 seconds), Blend mode
(all 37 timeline modes, grouped by family), preview resolution, and GPU frame-cache budget (640 MiB to 4 GiB).

At clip time `t`, instance `i` reads `t - i × offset`. Only instances whose start
has been reached participate. Twenty instances at 0.1 seconds span 1.9 seconds.
Zero offset starts all instances together. One instance passes the current image.
The effect does not extend the clip's duration or repeat its audio.

The editable graph uses a Sequence Index, delay multiplication, Sample Input
History and Sequence Blend. Eleven nodes represent the entire stack; the GPU
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
an explicit temporal resource owner to execute Sample Input History.
