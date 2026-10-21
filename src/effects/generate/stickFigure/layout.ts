// Where the Stick Figure is drawn in its layer (output pixels), shared by the uniform packer and the
// notes that tell the inspector and tools when a figure cannot be seen (no silent failure).
import {
  createDefaultSkeletonShape,
  facingX,
  figureMirror,
  SKELETON_COORDINATE_LIMIT,
  SKELETON_JOINTS,
  SKELETON_LENGTH_KEYS,
  SKELETON_SEGMENTS,
  skeletonFromParams,
  solveSkeleton,
  STICK_FIGURE_REFERENCE_HEIGHT,
} from '../../../services/rig/skeletonRig';

type Params = Readonly<Record<string, unknown>>;

export interface StickFigureLayout {
  /** Joint centres in output pixels, in SKELETON_JOINTS order. */
  joints: Array<{ x: number; y: number }>;
  /** Limb capsule radius and head radius in output pixels (at least half a pixel, so a hairline stays visible). */
  limbRadius: number;
  headRadius: number;
}

export function stickFigureLayout(params: Params, width: number, height: number): StickFigureLayout {
  const skeleton = skeletonFromParams(params);
  const { joints } = solveSkeleton(skeleton);
  const unit = height > 0 ? height / STICK_FIGURE_REFERENCE_HEIGHT : 1;
  const facing = figureMirror(params);
  return {
    joints: SKELETON_JOINTS.map(joint => ({
      x: width / 2 + facingX(joints[joint].x, skeleton.rootX, facing) * unit,
      y: height / 2 + joints[joint].y * unit,
    })),
    limbRadius: Math.max(0.5, skeleton.thickness * unit / 2),
    headRadius: Math.max(0.5, skeleton.headRadius * unit),
  };
}

/** The Ring head's opening keeps at least this share of the head radius. */
export const STICK_FIGURE_RING_MIN_OPENING = 0.5;

/** The Ring head: a stroke as thick as the limbs, so head and body read with one line weight. Thin
 * lines keep the outer edge at the head radius; thicker ones grow the ring outward (to at most
 * 1.5 × the head radius, a stroke of at most one head radius) so the opening stays at least half the
 * head radius. `outer` is where the neck ends (stickFigureRingDistance). */
export function stickFigureRing(limbRadius: number, headRadius: number): { centre: number; halfStroke: number; outer: number } {
  const stroke = Math.min(2 * limbRadius, headRadius);
  const inner = Math.max(headRadius - stroke, headRadius * STICK_FIGURE_RING_MIN_OPENING);
  return { centre: inner + stroke / 2, halfStroke: stroke / 2, outer: inner + stroke };
}

const scaleOf = (params: Params) => typeof params.scale === 'number' && Number.isFinite(params.scale) ? params.scale : 1;

/** Lengths whose stored value is drawable but which Scale pushes past the rig limit (renderMax only sees the stored value). */
function scaledLengthNotes(params: Params): string[] {
  const scale = scaleOf(params), defaults = createDefaultSkeletonShape();
  const over = SKELETON_LENGTH_KEYS.filter(key => {
    const stored = typeof params[key] === 'number' && Number.isFinite(params[key]) ? params[key] as number : defaults[key];
    return stored <= SKELETON_COORDINATE_LIMIT && stored * scale > SKELETON_COORDINATE_LIMIT;
  });
  return over.length ? [`${over.join(', ')}: times Scale ${scale} is longer than ${SKELETON_COORDINATE_LIMIT} figure px, so it is drawn at ${SKELETON_COORDINATE_LIMIT}.`] : [];
}

/** Settings that leave nothing to see (a figure scaled to nothing, or one entirely outside its layer) and
 * scaled lengths the rig clamps. `width`/`height`: the composition size, which the off-frame check uses. */
export function stickFigureWarnings(params: Params, width = 1920, height = 1080): string[] {
  if (scaleOf(params) <= 0) return [`scale: ${scaleOf(params)} gives the figure no size, so it is drawn as a dot at the pelvis. Use a scale above 0 (1 = 1080p proportions).`];
  const notes = scaledLengthNotes(params);
  const { joints, limbRadius, headRadius } = stickFigureLayout(params, width, height);
  const pad = Math.max(limbRadius, headRadius, stickFigureRing(limbRadius, headRadius).outer);
  const inside = SKELETON_SEGMENTS.some(([a, b]) => segmentTouchesFrame(joints[a], joints[b], pad, width, height))
    || joints.some(joint => joint.x > -pad && joint.x < width + pad && joint.y > -pad && joint.y < height + pad);
  if (inside) return notes;
  const pelvis = joints[0];
  return [...notes, `The whole figure lies outside its layer (pelvis at ${Math.round(pelvis.x)}, ${Math.round(pelvis.y)} px, judged at the ${width}×${height} composition size and the saved pose, before actions move it), so nothing is drawn; check Pelvis X/Y, Lift and Ground Y.`];
}

/** Coarse test: the segment's bounding box (grown by `pad`) overlaps the frame. */
function segmentTouchesFrame(a: { x: number; y: number }, b: { x: number; y: number }, pad: number, width: number, height: number): boolean {
  return Math.max(a.x, b.x) > -pad && Math.min(a.x, b.x) < width + pad && Math.max(a.y, b.y) > -pad && Math.min(a.y, b.y) < height + pad;
}
