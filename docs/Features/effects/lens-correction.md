# Lens Correction

Repairs what a camera lens does to a photo or clip: bowed lines, coloured fringes at contrast edges
and dark corners.

Group: [Lens & Distort](../Effects-Distort.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The night street twice: on top with strong simulated wide-angle distortion, the house fronts at the left and right bowing outward; below, corrected and slightly enlarged, the house edges straight and upright](../assets/effects/lens-correction.webp)

<figcaption>Top: simulated barrel distortion. Bottom: Remove Distortion −28, Scale 120.</figcaption>
</figure>

**Use it for:** straight walls and horizons in wide-angle photos · removing colour fringes along
contrast edges · evening out dark corners.

- **Lens Profile** – the measured Canon EF 24–105mm f/4L IS USM, or Manual (the default). With the
  profile, Focal Length and Aperture come from the photo's metadata when a Canon raw file (CR2)
  carries them.
- **Remove Distortion** – negative values straighten lines that bow outward (wide angle), positive
  values lines that bow inward.
- **Red/Cyan Fringe and Blue/Yellow Fringe** – remove coloured edges.
- **Vignette Amount** – lifts dark corners (negative darkens them).

**Tip:** very strong correction leaves empty corners. Raise Scale to crop them, turn on **Fit Entire
Photo** to keep the whole photo, or fill them on still photos with [AI Edge Fill](./ai-edge-fill.md).

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Profile** | | |
| Lens Profile | Manual, Canon EF 24-105mm f/4L IS USM | Manual |
| Focal Length | 24 to 105 | 24 |
| Aperture | 4 to 22 | 4 |
| Focus Distance | 0.45 to 1000 | 1000 |
| Sensor Crop | 1 to 2 | 1 |
| **Geometry** | | |
| Remove Distortion | −100 to 100 | 0 |
| Fine Distortion | −50 to 50 | 0 |
| Scale | 50 to 200 | 100 |
| Fit Entire Photo | on or off | off |
| Optical Center X | 0 to 1 | 0.5 |
| Optical Center Y | 0 to 1 | 0.5 |
| **Chromatic aberration** | | |
| Red/Cyan Fringe | −20 to 20 | 0 |
| Blue/Yellow Fringe | −20 to 20 | 0 |
| **Vignette** | | |
| Vignette Amount | −100 to 100 | 0 |
| Vignette Correction | on or off | on |
| Midpoint | 0 to 100 | 50 |
<!-- generated:controls end -->

## Node setup

Lens Correction is a fixed shader with its own controls: it has no node graph to open. Put it first
in the effect stack, before [Guided Perspective](./guided-perspective.md) and other effects.

## Technical details

- **Profile.** The profile uses measured Lensfun calibrations for distortion, colour fringes and
  vignetting, interpolated across focal length, aperture and focus distance. Sensor Crop is 1 for
  full-frame cameras; use 1.6 for Canon APS-C. Manual adjustments add to the profile.
- **Empty borders.** Areas the corrected picture no longer covers are transparent. Barrel correction
  strong enough to fold the picture back on itself stops at the fold: pixels beyond it stay
  transparent with a one-pixel soft edge, and the inspector and tool results say so.
- **Edges.** The fringe channels repeat the border pixel, so no coloured line runs along the frame,
  and the frame edge is smoothed. Cut-outs in the source are read like any layer transform.
- **Vignette Correction** switches off the profile vignetting and Vignette Amount together and keeps
  their settings.
- Corrections are saved with the effect and applied in the export.

More: [Effect system: Lens Correction](../Effect-System.md#lens-correction).
