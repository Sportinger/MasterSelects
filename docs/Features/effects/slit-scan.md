# Slit Scan

Shows each part of the frame from a different moment, so movement smears and folds through the picture. The classic slit-scan look, and with **3D geometry** a sculpture of time in the 3D scene.

Group: [Keying & Time](../Effects-Keying-Time.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Left: the dancer turning on a dark stage, seen from behind. Right: Slit Scan with the Time steps look at the same moment: the picture is cut into vertical bands, each from a slightly earlier moment towards the right, so her face, arms and dress are assembled from strips that do not line up and a hand floats detached at the left](../assets/effects/slit-scan.webp)

<figcaption>Left: original. Right: the Time steps look; each band further right is further back in time (up to 2 s).</figcaption>
</figure>

**Use it for:** a dancer whose body folds through time · smeared crowds, traffic or water · a movement turned into a 3D sculpture ([3D time surfaces](#3d-time-surfaces)).

- **Look** – a starting point: Sweep, Falling time, Center out, Wave folds, Radial bloom, Time rings or Time steps. It sets the Time and Wave values; once one of them differs, the menu shows Custom.
- **Delay** – how far back in time the picture reaches (1 s by default, up to 60 s).
- **Profile** and **Scan direction** – the shape of the time gradient: a straight scan in one direction, out from the centre, waves, radial or rings.
- **Preview** – **Time map** shows which moment each pixel comes from, instead of the result.

**Tip:** fast limbs break into a row of soft ghosts; switch on the **Motion compensation** section (its header switch) to turn them into one continuous smear. A new Slit Scan needs a moment to load its frames.

## Controls

The card opens on **Time** and **Wave**; Sampling, Motion compensation, Preview quality, 3D geometry and the sections for stabilization, time maps and protection start closed.

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **3D geometry** | | |
| Representation | 2D image, Reference time surface, Free motion band, Motion-deformed surface, Space-time slice (observed depth) | 2D image |
| Reference projection | Perspective, Orthographic | Perspective |
| Depth time source | Continuous requested time, Sampled source frames | Continuous requested time |
| Mesh quality | 128 columns, 256 columns, 512 columns, 1024 columns, 2048 columns | 256 columns |
| Time depth / sec | −5 to 5 | 0.25 |
| Motion deformation | 0 to 2 | 1 |
| Untracked regions | Keep time surface, Leave gaps | Keep time surface |
| Flow depth | −2 to 2 | 0 |
| Geometry smoothing | 0 to 4 | 0 |
| **Space-time slice** | | |
| Space axis | X, Y, Depth Z | X |
| Tilt (°) | 0 to 90 | 0 |
| Length / second | 0.01 to 5 | 0.25 |
| Slice position | −10 to 10 | 0 |
| Slice thickness | 0.001 to 2 | 0.06 |
| Relative depth | 0 to 2 | 0.5 |
| Point size | 0.001 to 0.1 | 0.025 |
| **RGB time** | | |
| Channel times | Linked, Separate RGB (no smoothing) | Linked |
| Red offset (s) | −60 to 60 | 0 |
| Green offset (s) | −60 to 60 | 0 |
| Blue offset (s) | −60 to 60 | 0 |
| Time map channel | Base / alpha, Red, Green, Blue | Base / alpha |
| **Time map** | | |
| Field source | External image / video, Effect input, Noise, Clip mask, Source motion and 2 more | External image / video |
| Map alignment | Timeline (free), Depth source | Timeline (free) |
| Map mix | 0 to 1 | 0 |
| Map start (timeline s) | −3600 to 3600 | 0 |
| Map channel | Luminance, Alpha, Red, Green, Blue and 3 more | Luminance |
| Invert map | Off, On | Off |
| **Shape target** | | |
| Anchor X | 0 to 1 | 0.5 |
| Anchor Y | 0 to 1 | 0.5 |
| Target stretch (×) | 0.1 to 8 | 1 |
| Time coherence | 0 to 1 | 0.25 |
| **Motion field** | | |
| Motion value | Magnitude, Directed velocity | Magnitude |
| Direction (degrees) | −180 to 180 | 0 |
| Minimum (UV/s) | −10 to 10 | 0 |
| Maximum (UV/s) | −10 to 10 | 0.25 |
| Confidence threshold | 0 to 1 | 0.1 |
| **Resources** | | |
| Time field mask | text | empty |
| Motion compensation | Off, DIS optical flow | Off |
| Time change (ms / 1%) | 0 to 2000 | 100 |
| Show smoothing areas | on or off | off |
| Protection mask | text | empty |
| Stabilization tracking | text | empty |
| Enable stabilization | on or off | on |
| Time map source | text | empty |
| Bypass slowdown | on or off | off |
| **Field shaping** | | |
| Input minimum | 0 to 1 | 0 |
| Input maximum | 0 to 1 | 1 |
| Gamma | 0.01 to 10 | 1 |
| Hue mapping | Periodic wave, Direct ramp (seam) | Periodic wave |
| Hue phase | 0 to 1 | 0 |
| **Field noise** | | |
| Noise scale | 0.1 to 100 | 4 |
| Noise seed | 0 to 1000 | 0 |
| Drift X (UV/s) | −1 to 1 | 0.02 |
| Drift Y (UV/s) | −1 to 1 | 0.01 |
| Noise type | Smooth, Hard cells | Smooth |
| **Field combination** | | |
| Noise strength | 0 to 1 | 0 |
| Combine noise | Mix, Add (centered), Multiply, Minimum, Maximum | Mix |
| **Sampling** | | |
| Frame storage | GPU cache, Hybrid · bounded GPU memory, GPU history · resident video volume | GPU history · resident video volume |
| History memory | 640 MiB, 1 GiB, 2 GiB, 4 GiB | 4 GiB |
| Temporal sampling | Blend adjacent frames, Nearest frame (no blending) | Blend adjacent frames |
| Export processing | Individual frames, Shared source frames (Hybrid) | Shared source frames (Hybrid) |
| Samples | 2 to 8192 | 1920 |
| Scan smoothing (px) | 0 to 4 | 0 |
| Seam smoothing (px) | 0 to 8 | 0 |
| Seam edge protection | 0 to 1 | 0.65 |
| Stretch threshold (×) | 1.01 to 16 | 2 |
| Resolution | Full size (follows preview Proxy mode), Small preview · 160 px | Full size (follows preview Proxy mode) |
| **Preview quality** | | |
| Preview quality | Full resolution, Adaptive · playback / scrub / edits | Adaptive · playback / scrub / edits |
| **Motion compensation** | | |
| Flow strength | 0 to 2 | 1 |
| **Stabilization** | | |
| Reference (source s) | 0 to 86400 | 0 |
| Strength | 0 to 1 | 1 |
| Rotation | Lock rotation, Keep rotation | Lock rotation |
| Scale | Lock size, Keep size changes | Lock size |
| **Time** | | |
| Preview | Result, Time map, Protection mask | Result |
| Delay (s) | 0 to 60 | 1 |
| Time factor (×) | 1 to 100 | 1 |
| Profile | Linear scan, Out from center, Wave / folds, Radial scan, Time rings | Linear scan |
| Angle (°) | −180 to 180 | 0 |
| Mix | 0 to 1 | 1 |
| Time bands (0 = off) | 0 to 64 | 0 |
| **Subject protection** | | |
| Protection strength | 0 to 1 | 1 |
| **Protected center** | | |
| Center X | 0 to 1 | 0.5 |
| Center Y | 0 to 1 | 0.5 |
| Radius | 0 to 1 | 0 |
| Feather | 0 to 1 | 0.15 |
| **Wave** | | |
| Waves | 0.1 to 10 | 2 |
| Phase | 0 to 1 | 0 |
| Speed (cycles/s) | −2 to 2 | 0.15 |
<!-- generated:controls end -->

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside Slit Scan's Time Sampling & Mix folder: Time Map and Protection feed the first Multiply, whose Protected Time output and Delay (s) feed the second Multiply; its output is Delay per Pixel](../assets/effects/graphs/slit-scan-time-sampling.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 767" aria-hidden="true" focusable="false">
<defs><marker id="slit-scan-time-sampling-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M508 38 L508 122" marker-end="url(#slit-scan-time-sampling-arrow)" />
<circle class="docs-shot-number" cx="508" cy="38" r="18" /><text x="508" y="38" class="docs-shot-number-text">1</text>
</svg>
</div>

<figcaption>The heart of Slit Scan, in its Time Sampling &amp; Mix folder. 1 — the first Multiply.</figcaption>
</figure>

Slit Scan is built around **Sample Past Frame**, which reads the clip at the same spot a number of seconds earlier – once per pixel. The **Time Map** gives every pixel a number from 0 (now) to 1 (the full Delay); the Look, Profile and Scan direction shape it in the folders before. The first **Multiply** (1) sets protected areas back to now (**Protection**), the second turns the map into seconds (**Delay per Pixel**), and Sample Past Frame reads each pixel at its own moment. How to open it: [The node setup](../Effects.md#the-node-setup).

**Remix:** for time that speeds up towards the far end of the scan, add a **Multiply** with both inputs from **Time Map** and plug it into input A of the first Multiply instead of Time Map.

## 3D time surfaces

The **3D geometry** section, below Preview quality, puts the Slit Scan picture into the shared 3D scene as a surface. Switch the section on and choose a **Representation**:

| Representation | What you see |
|---|---|
| 2D image | the flat picture (the default) |
| Reference time surface | a relief: each point moves along its view ray by how far back in time it lies (**Time depth / sec**) |
| Motion-deformed surface | the relief, with each point also carried sideways along the measured motion (a new effect starts with this one) |
| Free motion band | experimental: a band through the centre that follows the motion, for straight scans |
| Space-time slice (observed depth) | points from a baked depth video, cut through space and time |

Orbit, pan and dolly the scene camera to look at the surface from the side; the **Reference view** button (↶) brings the preview back to the original view. While the geometry prepares, the section shows its progress in large red text and the preview shows the flat picture; the export waits for the finished geometry. Switching the section off returns the clip to 2D and remembers your choice.

**Motion deformation** scales the sideways movement (0 none, 1 as measured, 2 exaggerated); **Untracked regions** keeps the time surface where tracking fails, or **Leave gaps** shows where it failed. It is a designed space-time surface, not the real depth of the scene.

### Space-time slice

First bake a depth video in **Tracking → AI Depth Map**, select it in the Slit Scan inspector and bake a source window of up to eight seconds. **Space axis**, **Tilt**, **Length / second**, **Slice position** and **Slice thickness** choose the cut: at Tilt 0° it selects one moment, at 90° a plane in space with time along the chosen axis. **Relative depth** scales the depth and **Point size** the rendered points. It is a 2.5D picture for a fixed camera: hidden surfaces stay empty, and thin cuts can show gaps between the samples.

## Technical details

- **Delay.** 0 to 60 s, clamped in the graph; the inspector reports a value outside. Looks set only the Time and Wave values and show Custom once one differs or is animated.
- **Sampling.** New effects blend adjacent frames (Sampling → Temporal sampling: Blend adjacent frames). That softens the bands of Nearest but leaves overlapping ghosts on fast limbs, which Motion compensation turns into a smear. The first load of the frame window takes a few seconds; until it is ready the preview shows the plain clip.
- **Source.** Slit Scan needs a video clip, not a still image or a nested composition. Its history comes from the original video's own timestamps (trims, speed changes and reverse clips included).
- **Saved projects.** Slit Scan graphs with the radial profiles in the Protected Center folder are regrouped, so Radial scan and Time rings render (they showed Wave while that folder was muted).

### 3D geometry

- **Model.** New effects start with 3D geometry off (2D image) and the `history` base time sampler; existing effects keep their saved representation. Choosing a 3D representation turns on the clip's 3D mode; choosing 2D image again (or switching the section off) turns it off, also for a clip that was 3D before. The base time sampler is a saved node identity: a missing sampler is reported, never replaced by another node. The reference projection, mesh quality and depth controls are ordinary effect parameters and save with the project; GPU objects stay runtime-only.
- **Time surface.** A two-sided, unlit triangle grid; each vertex moves along its fixed reference ray, and the colour is projected back into the reference image per pixel. The reference is fixed in object space, so orbiting the camera does not change it. Time depth is signed and follows the requested source age, including trims, reverse, source overrides and speed changes; a Float32 table with 8192 intervals evaluates the time mapping, so nonlinear speed ramps are approximated between entries. **Depth time source → Sampled source frames** uses the sampler's resolved source frames and blend weights instead (blended pixels use the weighted age) and needs no motion analysis while Flow depth is 0. Missing source metadata is reported, not guessed.
- **Flow depth and motion.** Flow depth and the motion surfaces use DIS optical flow between real source frames, forward and backward measured separately. Trajectories stop after 512 frame pairs per vertex; missing intervals, weak confidence, occlusion and image exits end a track. Geometry smoothing is separate from image smoothing and avoids large delay jumps and motion boundaries. Changing Delay or Time factor replaces a pending analysis; moving the playhead does not.
- **Free motion band.** For straight scans in the four main directions without an external time map. Its seed is a line through the image centre across the scan; it carries the finished Slit Scan picture. Cells touching a lost track are left out, and self-overlap uses depth with an alpha cutout at 50 % (no sorted transparency). The back face shows the same picture.
- **Space-time slice.** Up to 64,000 coloured observations (40 columns, at most 40 rows, 5 samples per second) are stored in the effect parameters with their source, so save, load and undo keep the bake. Depth is relative and can vary over time; the baked colours come before the clip's effects, and changing the depth video needs a new bake. A moving camera would need camera poses (no COLMAP solve); a missing bake is reported and the export does not substitute a mesh.
- **Scene and export.** Effects up to Slit Scan run once in image space; the mesh then projects that picture, and later effects keep their scene position. The mesh depth takes part in scene occlusion; pixels that later effects create outside the mesh sit on the far plane. Clip opacity applies once, after these effects. The Reference view changes only the preview camera: save an export view with the scene camera controls.
- **Quality and memory.** Mesh quality is 128 to 2048 columns (256 by default), rows follow the aspect ratio up to 512; playback and scrubbing use at most 128 columns, pausing and the export the chosen quality. Colour uses its own premultiplied mip chain with 8× anisotropic filtering, reserved from the history budget (about a third over the colour snapshot). **Sampling → Seam smoothing (px)** runs before the 3D colour snapshot and applies only to Result with linked RGB time; 0 skips it.
- **Motion analysis cache.** Finished DIS pairs save with the project (`Cache/motion`, or `.masterselects-cache/motion` in the linked media folder of a packaged project) and load again instead of being recomputed; keys cover the source, the exact frame pair, the analysis size, stabilization and the algorithm version. Copy that folder with the project to keep the speed-up on another computer. Saving runs in the background (up to four pairs or 64 MiB at a time); `ready · saving` means rendering can go on. Projects without folder storage keep the analysis in memory only, and the status says so.
- **Status.** The 3D representations are new: the complete editor and export acceptance checks are still in progress.

Deeper notes (time maps, shape targets, stabilization, motion compensation): [Effect system: Slit Scan](../Effect-System.md#slit-scan). Sampling past frames: [Temporal frame access](../../architecture/Temporal-Frame-Access.md). Nodes: [Node Catalog](../Node-Catalog.md).
