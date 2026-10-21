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

- **Source.** Time Stack and Slit Scan need a video clip, not a still image or a nested composition. The past comes from the original video's own timestamps (trims, speed changes and reverse clips included), not from earlier playback, through one shared source-frame service.
- **Loading.** The first load of the frame window takes a moment; the preview shows the plain clip or the last complete picture meanwhile, and the export waits for the exact frames.
- **Memory.** Each of them keeps its frames in a GPU budget of its own (Time Stack: Frame cache; Slit Scan: History memory).
- **More.** Keyer internals: [Effect system: editable keying and feedback graphs](./Effect-System.md#editable-keying-and-feedback-graphs); Slit Scan notes: [Effect system: Slit Scan](./Effect-System.md#slit-scan); compilation: [Operator Graph Compiler](./Operator-Graph-Compiler.md).
- **Pictures.** The stills come from `scripts/effect-lab.mjs`; the graph and inspector pictures from `scripts/effect-graph-shot.mjs` and `scripts/effect-editor-shot.mjs`, each with a `keying-time.json` manifest (`scripts/effect-*-shots/`).
