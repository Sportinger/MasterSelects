# Blur Effects

Five ways to soften a picture, from a gentle defocus to fast streaks of motion.

All blurs look the same in the preview and in the export, whatever the preview
quality or project size: sizes are measured on a 1080p frame and scale with it.
Transparent edges (logos, titles, keyed footage) fade out cleanly without a dark rim.

## Gaussian Blur
![Original left, Gaussian Blur (Radius 12) right, on the harbour image](assets/effects/gaussian-blur.webp)
A smooth, even softening, like a lens out of focus. The standard choice for
backgrounds, transitions and anything that should simply look soft.
- **Radius** – how soft. 2–5 takes the edge off, 10 is clearly out of focus, 30 and more turns shapes into light.

Tip: animate Radius from 0 for a smooth focus pull.

## Box Blur
![Original left, Box Blur (Radius 10) right, on the night street with neon signs](assets/effects/box-blur.webp)
Averages a square around every pixel. Softer shapes keep a slightly hard,
graphic edge, and bright lights turn into small squares instead of round glows.
- **Radius** – size of the square. Changes smoothly when animated.

Tip: for a natural defocus use Gaussian Blur; Box Blur is the graphic look.

## Motion Blur
![Original left, Motion Blur (Length 0.03, horizontal) right, on the dancer](assets/effects/motion-blur.webp)
Smears the picture in one direction, as if the camera or the subject moved fast
during the exposure.
- **Length** – how long the streaks are, as a share of the picture width (0.03 is a quick move, 0.1 a fast pan).
- **Angle** – the direction on screen, in radians: 0 is horizontal, 1.57 vertical, 0.79 diagonal.

Tip: keep Length small on faces; long streaks work best on lights and fabric.

## Radial Blur
![Original left, Radial Blur in Spin mode (Amount 0.5) right, on the night street](assets/effects/radial-blur.webp)
Blurs around a centre point. **Zoom** streaks the picture towards the centre and
leaves the middle sharp; **Spin** turns it in circles, like a rotating camera.
- **Type** – Zoom or Spin.
- **Amount** – strength. For Spin, 0.5 is a turn of about 10 degrees, 2 about 40.
- **Center X / Center Y** – where the sharp middle sits (0.5 / 0.5 is the centre of the picture).

Tip: put the centre on the performer to keep them sharp while the stage swirls.

## Zoom Blur
![Original left, Zoom Blur (Amount 0.3) right, on the night street](assets/effects/zoom-blur.webp)
Streaks the picture outward from a centre point, as if zooming in during the
exposure: a burst of speed.
- **Amount** – length of the streaks. 0.1 is subtle, 0.3 a clear zoom burst, 1 is extreme.
- **Center X / Center Y** – where the burst starts.

Tip: combine with a quick scale animation for a punch-in.
