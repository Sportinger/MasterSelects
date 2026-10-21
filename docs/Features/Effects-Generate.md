# Generate

Effects that make a new picture instead of changing the clip: a colour wheel, a stage floor and a
stick figure. Add one in **Properties → Effects → + Add Effect → Generate**
([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: generate -->

## Which one?

| Look | Use |
|---|---|
| a colour reference or a gel spot | [Color Wheel](./effects/color-wheel.md) |
| a retro floor running to the horizon | [Perspective Grid](./effects/perspective-grid.md) |
| a posable figure, a choreography sketch | [Stick Figure](./effects/stick-figure.md) |
| a swarm in 3D | [Flocking](./effects/flocking.md), under 3D & Particles |
| woven threads, ropes and knots | [Weave](./effects/weave.md), under 3D & Particles |
| raw computer memory as a glitch | [Memory Leak](./effects/memory-leak.md), under Analog & Glitch |

## The shared idea

A generator draws its own picture over the clip; on a **Blank** clip only that picture shows. They
build it in three ways:

- **One fixed drawing:** Color Wheel, Perspective Grid and Stick Figure each draw their picture in a
  single built-in step. Everything you can change is in the card: sliders with units (%, px, °), a ◇
  to set keyframes and ↺ to reset. Values a generator cannot draw, such as a Stick Figure scaled to 0
  or standing outside the picture, are named in the card instead of failing silently, in the same
  units as the rows.
- **An image graph:** [Memory Leak](./effects/memory-leak.md#node-setup) is a small node graph that
  turns bytes into pixels. You can open and rewire it like the distort or blur effects.
- **A 3D scene:** [Weave](./effects/weave.md#node-setup) and [Flocking](./effects/flocking.md) build
  threads or a swarm in the editor's 3D scene, above the clip. Their graphs work on curves and
  particles, not on pixels.

## Technical details

Every setting can be keyframed. Keyframing a speed (Perspective Grid Speed, Color Wheel Spin) changes how fast the pattern moves without making it jump. Values the effect cannot draw are named in its card.

Developer notes: [Effect system: Generate notes](./Effect-System.md#generate-notes).
