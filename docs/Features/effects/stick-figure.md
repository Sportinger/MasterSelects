# Stick Figure

A posable stick figure for choreography sketches, storyboards and animated characters. On a Blank
clip only the figure shows; a new figure starts in a walking stance in profile.

Group: [Generate](../Effects-Generate.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The dancer with a white stick figure with a ring head on the right, echoing her pose: one arm raised, the other out to the side, one leg stretched back](../assets/effects/stick-figure.webp)

<figcaption>A posed figure, Facing Left, Head Ring, Scale 1.6.</figcaption>
</figure>

**Use it for:** blocking a choreography before rehearsal · a storyboard figure over a shot · a small
animated character.

- **Pose** – joint angles in degrees: shoulders and hips swing forward from hanging down, elbows and
  knees bend. The **Pose library** applies or keys whole poses.
- **Actions** – Walk, Run, Jump, Punch and more on the figure's own lane; they blend into each
  other.
- **Scale**, **Line Thickness**, **Head** (filled or ring) and **Color** – the look. A ring head is
  drawn as thick as the lines and keeps an open centre.
- **Ground** – Plant keeps the lowest point on the floor while the figure moves.

**Tip:** **Walk**, **Run** and **Idle** under Motion animate every joint in one click.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Pose** | | |
| Pelvis X | −2000 to 2000 px | 0 px |
| Pelvis Y | −2000 to 2000 px | 0 px |
| Lift | −2000 to 2000 px | 0 px |
| Spine Lean | −180 to 180° | 4° |
| Head Tilt | −180 to 180° | −4° |
| Shoulder L | −180 to 180° | 30° |
| Elbow L | −180 to 180° | 35° |
| Shoulder R | −180 to 180° | −25° |
| Elbow R | −180 to 180° | 20° |
| Hip L | −180 to 180° | 16° |
| Knee L | −180 to 180° | 18° |
| Hip R | −180 to 180° | −12° |
| Knee R | −180 to 180° | 6° |
| **Proportions** | | |
| Torso | 0 to 400 px | 110 px |
| Neck | 0 to 200 px | 14 px |
| Head Radius | 0 to 200 px | 26 px |
| Upper Arm | 0 to 400 px | 62 px |
| Forearm | 0 to 400 px | 58 px |
| Thigh | 0 to 400 px | 74 px |
| Shin | 0 to 400 px | 70 px |
| Line Thickness | 0 to 100 px | 12 px |
| Scale | 0.05 to 5 | 1 |
| **Ground** | | |
| Ground | Plant lowest point, Keep above ground, Off | Plant lowest point |
| Ground Y | −2000 to 2000 px | 144 px |
| **Style** | | |
| Facing | Right, Left | Right |
| Turn | −1 to 1 | 1 |
| Head | Filled, Ring | Filled |
| Color | a colour | `#ffffff` |
| Opacity | 0 to 1 | 1 |

The effect card also has controls of its own that this table does not list.
<!-- generated:controls end -->

## Node setup

The figure itself is drawn in one built-in step, but every joint is a parameter that nodes can drive.
**Walk**, **Run** and **Idle** add a **Gait Cycle** node wired to every joint; **Limb IK** bends an
arm or a leg so the hand or foot reaches a target, and **Attach to Joint** lets another clip follow a
hand or a foot. How these rig nodes work:
[Stick figures and rig nodes](../Node-Workspace.md#stick-figures-and-rig-nodes).

## Technical details

- **Units.** Angles are in degrees; bone lengths and positions are in figure pixels (pixels of a
  1080 px tall frame, scaled with the resolution).
- **Drawing.** Joints are solved on the CPU and drawn as lines. Positions and lengths, also after
  Scale, stay within ±100 000 figure pixels, and a clamp is named.
- **Ring head.** The ring is stroked with the line thickness up to the head radius; thick lines grow
  it outward (at most 1.5 × Head Radius) so the opening keeps half the head radius, and the neck ends
  flat at its outer edge.
- **Warnings.** Scale at or below 0 and a figure outside its layer (judged at the composition size and
  the saved pose) are reported in the inspector and in the tool results, `createRig` included.
- **Saved projects.** Figures saved before the walking stance keep their saved pose; instances without
  pose values render at the rig's rest pose.

More: [Node Workspace](../Node-Workspace.md#stick-figures-and-rig-nodes).
