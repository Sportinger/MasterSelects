Test images for the Effect Lab (`scripts/effect-lab.mjs`), generated with Nano Banana 2
for MasterSelects on 2026-10-20 (no real people, places or brands). 1920×1080 JPEG.

- `dancer_stage.jpg` – skin tones, warm/cool stage light, deep shadows, haze.
- `harbor_town.jpg` – fine detail, saturated daylight colour, sky gradient.
- `neon_rain_street.jpg` – night, saturated light sources, reflections, bokeh.
- `greenscreen_dancer.jpg` – hard green-screen still for keyers: curly hair with flyaways,
  semi-transparent chiffon, unevenly lit screen with falloff, green spill, floor shadow and dark
  curtains at the frame edges.

Derived from `neon_rain_street.jpg` with Pillow (2026-10-21) to show corrections:

- `neon_rain_street_barrel.jpg` – strong simulated wide-angle barrel distortion: the inverse of
  Lens Correction's manual model at Remove Distortion −28 and Scale 120 (radius 1 = frame corner)
  up to the radius that correction reads, continued smoothly beyond it, source cropped 1.62×; so
  Remove Distortion −28 with Scale 120 straightens it exactly.
- `neon_rain_street_tilted.jpg` – simulated upward camera tilt: the frame's top corners spread
  18 % outward (verticals lean in towards the top), cropped to 72 %.

- `black.jpg` – plain black 1920×1080 (Pillow, 2026-10-22): the background of a generator's basic
  still, which shows the effect alone.

- `title_act_one.png` – the title "ACT ONE" in silver grey (#969ca8, FreeSans Bold 260 px) on a
  transparent 1920×1080 PNG (Pillow, 2026-10-22): a title layer for effects that stay inside a
  layer's shape (Sheen's glint).
