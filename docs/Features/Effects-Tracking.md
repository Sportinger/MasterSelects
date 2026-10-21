# Tracking & Overlays

Graphics that follow a person: target boxes, security-camera looks, sparkles around hands and ropes
hanging from a face. Add one in **Properties → Effects → + Add Effect → Tracking & Overlays**
([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: tracking -->

## Which one?

| Look | Use |
|---|---|
| ropes that hang from points of a face and swing | [Face Cables](./effects/face-cables.md) |
| glowing particles around the hands | [Hand Particles](./effects/hand-particles.md) |
| a sci-fi target box around the subject | [HUD Tracker](./effects/hud-tracker.md) |
| greenish security-camera video with a target box | [CCTV](./effects/cctv.md) |
| the subject bright, the rest dimmed | [Subject Highlight](./effects/subject.md) |
| tracked points joined by lines, like motion capture | [Tracked Scene](./effects/tracked-scene.md) |
| sparkles around the tracked points | [Stardust](./effects/stardust.md) |
| coloured rain over a darkened scene, the subject left clear | [Rain Reveal](./effects/rain-reveal.md) |

## The shared idea

These effects need to know where the person is. Select the video clip and click **Track Landmarks**
in its **Effects** tab: the editor finds hands, face and body in the clip, and the overlays follow
those points. Until a clip is tracked, the overlays sit in the middle of the frame (the still images
on these pages show that).

- **Overlay** is the colour of the box, lines or particles, **Amount** how strongly they show and
  **Speed** how fast they move.
- **Face Cables** needs the more precise face pass instead: **Properties → Tracking → Track face**,
  then **Bake cables** in the effect card.

HUD Tracker, CCTV, Stardust, Rain Reveal and Tracked Scene are styles of one overlay engine: the
**Style** menu in their card switches between them.

## Technical details

Tracking runs in the browser and stays on this computer. More:
[Effect system: landmark tracking effects](./Effect-System.md#landmark-tracking-effects).
