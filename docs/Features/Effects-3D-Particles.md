# 3D & Particles

Turn the clip into objects: a relief of blocks, a swarm, woven fibres, toy bricks or particles that
blow away. Add one in **Properties → Effects → + Add Effect → 3D & Particles**
([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: scene -->

## Which one?

| Look | Use |
|---|---|
| the picture as a relief of blocks you can look at from any angle | [Voxel Relief](./effects/voxel-relief.md) |
| a stylized Gaussian splat with light streaks and a wire mesh | [Splat Exploration](./effects/splat-exploration.md) |
| the picture rebuilt from toy bricks | [Toy Bricks](./effects/bricks.md) |
| the picture breaking into particles that blow away, as an exit | [Pixel Particle Disintegrate](./effects/pixel-particle-disintegrate.md) |
| a swarm of birds, fish or sparks moving around the clip | [Flocking](./effects/flocking.md) |
| woven fabric, yarn and knots hanging in front of the clip | [Weave](./effects/weave.md) |

## The shared idea

These effects build geometry or particles from the clip instead of changing its pixels in place:

- **In the 3D scene**: Voxel Relief, Flocking, Weave and Splat Exploration draw real 3D objects, so
  depth, light and the camera matter. Splat Exploration needs a Gaussian splat clip.
- **As particles**: Pixel Particle Disintegrate splits the frame into particles; it comes last in the
  effect stack, so effects after it are ignored.
- **Flat**: Toy Bricks is a 2D look of the pattern engine with a bevel on each brick.

Most of them are node setups you can open and change in the **Nodes** tab of the clip; Flocking and
Weave are whole graphs with presets.

## Technical details

3D effects cost more than 2D ones; a new 3D effect can show "Preparing 3D scene" for a few seconds.
More: [3D Layers](./3D-Layers.md), [Flock Clips](./Flock-Clips.md), [Weave](./Weave.md) and
[Effect system](./Effect-System.md).
