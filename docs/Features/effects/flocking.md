# Flocking

A swarm in 3D (birds, fish, krill, sparks) that moves by itself around the clip, with real depth. The
clip stays visible underneath.

Group: [3D & Particles](../Effects-3D-Particles.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Left, the dancer; right, the same crop with a violet swarm of fine particles, thin curved filaments and small wire cubes drifting around her](../assets/effects/flocking.webp)

<figcaption>Left: original. Right: preset Violet Filaments, 4 s in (editor preview, cropped to the swarm).</figcaption>
</figure>

**Use it for:** birds, fish or insects around a performer · sparks and dust in a stage space · data
sculptures and abstract swarms.

- **Preset** – a starting swarm, from the calm Free Swarm to large showcase scenes.
- **Population**, **Behavior**, **Guidance**, **Appearance** and **Lines** – the controls the preset
  exposes in the effect card.
- **Open Nodes** – the whole graph, to add forces, paths or other looks.

**Tip:** one swarm per clip: adding Flocking again selects the existing one. More in
[Flock Clips](../Flock-Clips.md).

## Controls

<!-- generated:controls start -->
The card shows a **Preset** menu and the values that preset exposes, grouped as Population, Behavior, Guidance, Appearance and Lines; they change with the preset. **Open Nodes** shows the whole swarm graph.
<!-- generated:controls end -->

## Node setup

The swarm is a node graph of particles, forces and render nodes: the green **Flock** group on the
clip's node canvas, opened with **Open Nodes**. Its nodes work on particles, not on pixels. The graph,
its presets and every node: [Flock Clips: graph model](../Flock-Clips.md#graph-model).

## Technical details

- Flocking renders into the shared 3D scene; its 2D pass leaves the clip unchanged.
- After adding the effect the preview can show "Preparing 3D scene" for several seconds before the
  swarm appears; compiling the swarm's simulation shader takes about 0.3 s of that.
- Removing the effect deletes its graph and keyframes; disabling or bypassing it only hides the
  swarm.

More: [Flock Clips](../Flock-Clips.md#flocking-is-an-effect).
