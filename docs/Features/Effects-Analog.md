# Analog Effects

Ten effects that make a picture look as if it came through an old TV, a worn tape,
a film lens or a broken digital signal.
Add one in **Properties → Effects → + Add Effect**.

## The analog effects

### CRT Screen
<figure class="docs-shot docs-shot--float-right">

![The night street with neon signs, enlarged, original left and with CRT Screen right: the picture is drawn in fine horizontal lines with thin red, green and blue stripes, and the top edge of the screen bends down into a dark frame](assets/effects/crt-screen.webp)

<figcaption>Left: original. Right: CRT Screen at its default settings, both enlarged 1.5×.</figcaption>
</figure>

Turns the picture into an old tube TV: glowing lines, a fine pattern of red, green
and blue stripes, and a curved screen with rounded corners. Bright parts glow
over the gaps between the lines, dark parts show them.
- **Line Count** – how many lines run down the picture. 240 is a classic TV; fewer lines look coarser.
- **Line Depth** – how dark the gaps between the lines are.
- **Curvature** – how much the screen bulges. 0 keeps the picture flat and fills the whole frame.
- **Mask** and **Mask Strength** – the stripe pattern of the screen: Aperture Grille (straight stripes) or Slot Mask (stripes with small breaks).

Tip: add Glow after it for the soft bloom of a real tube.

### Glitch
<figure class="docs-shot docs-shot--float-left">

![The dancer, original left and with Glitch right: rows of the picture are torn sideways with red, green and blue fringes, and a few square blocks are moved or show swapped colours](assets/effects/glitch.webp)

<figcaption>Left: original. Right: Intensity 0.75, Density 0.45, one frame of a burst.</figcaption>
</figure>

A broken digital signal: rows of the picture tear sideways, blocks jump to the
wrong place and the colours split. It comes in short bursts, with clean frames
in between, and plays back the same way every time.
- **Intensity** – how far the picture tears and jumps.
- **Density** – how often it breaks up and how much of the frame breaks at once. At 1 it never stops.
- **Bands** – how many rows the picture tears into.
- **RGB Split** – how far red and blue slide apart.

Tip: Speed 0 freezes one glitch; change Seed for a different pattern.

### Film Prism
<figure class="docs-shot docs-shot--float-right">

![The night street with neon signs, original left and with Film Prism right: the edges of the signs and shop windows split into soft red-to-blue rainbow fringes, and fine film grain covers the picture](assets/effects/film-prism.webp)

<figcaption>Left: original. Right: Fringe 0.8, Grain 0.35, Lens shape.</figcaption>
</figure>

The look of film shot through a cheap lens or a glass prism: edges break into
soft rainbow fringes, and a fine, living film grain lies over the picture.
- **Fringe** – how far the colours split at edges.
- **Shape** – Lens: the fringes grow towards the corners. Prism: the same everywhere, in the direction of Prism Angle.
- **Grain** and **Grain Size** – how strong and how coarse the grain is.

Tip: Grain Speed 0 freezes the grain, for still images.

### Analog Signal Lab
<figure class="docs-shot docs-shot--float-left">

![The dancer, original left and through Analog Signal Lab as a worn VHS tape right: the picture is softer, paler and noisy, with bright streaks across the top where the tape tracking slips](assets/effects/analog-signal-lab.webp)

<figcaption>Left: original. Right: the Worn VHS Look.</figcaption>
</figure>

Sends the picture through a simulated PAL television chain – antenna, video tape
and tube TV – with real faults: noise, ghost images, rolling, colour that bleeds
and tracking errors. It is the most realistic analog look, and the deepest.
- **RF / Antenna Stage**, **VHS Stage** and **CRT Stage** – switch each part of the chain on (1) or off (0).
- **Signal Strength** – weaker reception adds noise; very weak reception makes the picture roll.
- **Tracking Error** and **Tape Wear** – the typical faults of a worn VHS tape.

Tip: start from the Looks PAL Broadcast, Weak Antenna or Worn VHS and adjust from there.

<div class="docs-float-end"></div>

The other six – Crystal Glass, Glass Dispersion, Holo, Ribbon Scan, Wave Lines and
Pixel Sort – are simpler pattern effects: glass facets, colour-split cells, a
hologram shimmer, wavy ribbons, line drawings and short sorted pixel runs.

**Saved projects:** CRT Screen, Glitch and Film Prism were rebuilt in this update.
Effects and custom Looks saved before it keep their earlier look and controls; add
the effect again for the new version. The built-in Looks CRT Memory, Data Glitch
and Prism Film use the new versions.

**Known limitations:** Pixel Sort only sorts runs of up to 16 pixels, so it makes a
fine streaky texture rather than long sorted streaks; Glass Dispersion's cells
change size with the frame resolution and Crystal Glass's facets stretch with the
frame shape; Holo's outlines get weaker at higher resolutions; Ribbon Scan smears
the frame edges; Analog Signal Lab turns very fine detail into strong colour dots,
so soften busy footage first.

<div class="docs-float-end"></div>

<!-- docs agent: middle and technical levels go here -->
