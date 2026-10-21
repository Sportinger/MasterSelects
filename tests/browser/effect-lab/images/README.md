Test images for the Effect Lab (`scripts/effect-lab.mjs`), generated with Nano Banana 2
for MasterSelects on 2026-10-20 (no real people, places or brands). 1920×1080 JPEG.

- `dancer_stage.jpg` – skin tones, warm/cool stage light, deep shadows, haze.
- `harbor_town.jpg` – fine detail, saturated daylight colour, sky gradient.
- `neon_rain_street.jpg` – night, saturated light sources, reflections, bokeh.

Derived from `neon_rain_street.jpg` with Pillow (2026-10-21) to show corrections:

- `neon_rain_street_barrel.jpg` – simulated wide-angle barrel distortion: the inverse of Lens
  Correction's manual model at Remove Distortion −14 (radius 1 = frame corner), cropped 1.34×,
  so Remove Distortion −14 straightens it.
- `neon_rain_street_tilted.jpg` – simulated upward camera tilt: the frame's top corners spread
  18 % outward (verticals lean in towards the top), cropped to 72 %.
