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
  Lens Correction's manual model at Distortion −28 and Scale 120 (radius 1 = frame corner)
  up to the radius that correction reads, continued smoothly beyond it, source cropped 1.62×; so
  Distortion −28 with Scale 120 straightens it exactly.
- `neon_rain_street_lens.jpg` – `neon_rain_street_barrel.jpg` with dark lens corners as well (2026-10-22):
  divided by Lens Correction's vignette gain at Amount 40 and Midpoint 30, so the Even Corners preset
  lifts them exactly; the preset strip of Lens Correction uses it.
- `neon_rain_street_tilted.jpg` – simulated upward camera tilt: the frame's top corners spread
  18 % outward (verticals lean in towards the top), cropped to 72 %.

- `black.jpg` – plain black 1920×1080 (Pillow, 2026-10-22): the background of a generator's basic
  still, which shows the effect alone.
