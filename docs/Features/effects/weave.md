# Weave

Woven fabric, yarn, ropes and knots, drawn as fine lit fibres in 3D above the clip. The default net
of grey wool, about two thirds of the frame wide, weaves itself in over the first seconds and then
hangs in front of the clip.

Group: [3D & Particles](../Effects-3D-Particles.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Left, the dancer on stage; right, the same frame with a finished net of grey twisted yarn, woven over and under, hanging in front of her body from the shoulders to the knees, her face, raised arm and feet uncovered](../assets/effects/weave.webp)

<figcaption>Left: original. Right: the default Weave at 6 s, when the cloth is finished (editor preview).</figcaption>
</figure>

**Use it for:** a net or a veil that weaves itself in front of a performer · ropes and knots ·
textile and handmade looks in a projection.

- **The threads** are a node graph: open the clip in the **Nodes** tab to change them.
- **Exposed values** from that graph appear in the effect card, ready to keyframe: for example
  **Weave Speed**, **Irregularity** and **Reveal**.

**Tip:** switch a group off with **Byp** to see what it adds. More in [Weave](../Weave.md).

## Controls

<!-- generated:controls start -->
This effect has no controls.
<!-- generated:controls end -->

## Node setup

<figure class="docs-shot docs-shot--graph">

![The Weave graph: Weave Pattern feeds Handmade, then Weave In, Yarn and Wind Cloth, and Wind Cloth feeds Strand Render; Reveal by Shape and Handmade also feed values into Yarn](../assets/effects/graphs/weave.webp)

<figcaption>The default Weave graph as it opens in the Nodes tab (the Output card left out). Yellow cables carry the threads.</figcaption>
</figure>

**Weave Pattern** lays out the threads of a plain weave as curves. Each folded group then changes
those curves: **Handmade** makes them uneven, **Weave In** pulls them in over the first seconds,
**Yarn** twists fibres around them (**Reveal by Shape** sets how thick), and **Wind Cloth** puts them
on a sheet in the wind. **Strand Render** draws the result as lit fibres.

**Remix:** switch a group off with **Byp**. The picture shows the groups folded; open one with the ›
left of its title, and **Byp** sits near the right end of its title bar, next to Focus (the group's
section in the effect card has the same switch). Without **Weave In** you see the finished cloth from
the first frame, without **Wind Cloth** a flat sheet, without **Yarn** the bare threads. More
recipes, knots and ropes are in [Weave](../Weave.md).

## Technical details

- Weave renders into the shared 3D scene; its 2D pass leaves the clip unchanged. Preview and export
  use the same geometry and renderer.
- After adding the effect the preview can show "Preparing 3D scene" for several seconds before the
  threads appear.
- **Saved projects.** A saved Weave keeps the graph stored with it, so earlier weaves keep their
  larger white sheet; the smaller grey default applies only to new instances.

More: [Weave](../Weave.md) · curve nodes in the [Node Catalog](../Node-Catalog.md#curve-graphs-weave).
