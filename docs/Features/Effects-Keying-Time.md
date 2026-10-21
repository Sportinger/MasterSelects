# Keying & Time

Take a performer off a green or blue screen, or let time itself become the picture: echoes of a movement, or every part of the frame from a different moment. Add one in **Properties → Effects → + Add Effect** – Chroma Key under **Keying**, the others under **Time** ([Using effects](./Effects.md)).

<!-- docs-gallery: keying+time -->

## Which one?

| Look | Use |
|---|---|
| a performer in front of any background | [Chroma Key](./effects/chroma-key.md) |
| each part of the frame from a different moment | [Slit Scan](./effects/slit-scan.md) |
| echoes of a movement, like a long exposure | [Time Stack](./effects/time-stack.md) |
| fading light trails behind moving content | [Motion Trails](./effects/kinetic-trace.md) |

## The shared idea

Time Stack and Slit Scan read the past. Both are built around one node, **Sample Past Frame**: it reads the clip at the same spot a number of seconds earlier (its **Delay** input). They differ only in how they choose that delay: Time Stack gives every copy its own, Slit Scan every pixel. Their pages show the recipe: [Time Stack](./effects/time-stack.md#node-setup) and [Slit Scan](./effects/slit-scan.md#node-setup).

## Technical details

Time Stack and Slit Scan need a video clip, not a still or a nested composition, and read the past from the video itself. The first load of their frames takes a moment; the export waits for the exact frames. Each keeps its frames in a GPU memory budget of its own.

Developer notes: [Effect system: Keying & Time notes](./Effect-System.md#keying--time-notes).
