// Where the Stick Figure is drawn in its layer (output pixels), shared by the uniform packer and the
// notes that tell the inspector and tools when a figure cannot be seen (no silent failure).
import {
  facingX,
  figureMirror,
  SKELETON_JOINTS,
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

const scaleOf = (params: Params) => typeof params.scale === 'number' && Number.isFinite(params.scale) ? params.scale : 1;

/** Settings that leave nothing to see: a figure scaled to nothing, or one entirely outside its layer. */
export function stickFigureWarnings(params: Params, width = 1920, height = 1080): string[] {
  if (scaleOf(params) <= 0) return [`scale: ${scaleOf(params)} gives the figure no size, so it is drawn as a dot at the pelvis. Use a scale above 0 (1 = 1080p proportions).`];
  const { joints, limbRadius, headRadius } = stickFigureLayout(params, width, height);
  const pad = Math.max(limbRadius, headRadius);
  const inside = SKELETON_SEGMENTS.some(([a, b]) => segmentTouchesFrame(joints[a], joints[b], pad, width, height))
    || joints.some(joint => joint.x > -pad && joint.x < width + pad && joint.y > -pad && joint.y < height + pad);
  if (inside) return [];
  const pelvis = joints[0];
  return [`The whole figure lies outside its layer (pelvis at ${Math.round(pelvis.x)}, ${Math.round(pelvis.y)} px of a ${width}×${height} frame), so nothing is drawn; check Pelvis X/Y, Lift and Ground Y.`];
}

/** Coarse test: the segment's bounding box (grown by `pad`) overlaps the frame. */
function segmentTouchesFrame(a: { x: number; y: number }, b: { x: number; y: number }, pad: number, width: number, height: number): boolean {
  return Math.max(a.x, b.x) > -pad && Math.min(a.x, b.x) < width + pad && Math.max(a.y, b.y) > -pad && Math.min(a.y, b.y) < height + pad;
}
