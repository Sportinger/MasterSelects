/**
 * Window of a correction node (Resolve-style power window): the node's correction applies inside
 * (or outside) an ellipse or rectangle with a soft edge, everywhere else the picture passes through.
 * Coordinates are in the clip's own picture (before its transform), 0..1 from the top left. The
 * window lives in the grade, so a camera grade shares it with every clip of the camera.
 */
export interface ColorWindowParams {
  /** 0 = whole picture, 1 = ellipse, 2 = rectangle. */
  windowShape: number;
  windowX: number;
  windowY: number;
  windowWidth: number;
  windowHeight: number;
  /** Soft edge as a share of the window size; 0 is a hard edge. */
  windowSoftness: number;
  /** 0 = correct inside the window, 1 = correct outside it. */
  windowOutside: number;
}

export const DEFAULT_COLOR_WINDOW_PARAMS: ColorWindowParams = {
  windowShape: 0,
  windowX: 0.5,
  windowY: 0.5,
  windowWidth: 0.5,
  windowHeight: 0.5,
  windowSoftness: 0.3,
  windowOutside: 0,
};

/** Weight of the node's correction at one point (u, v in 0..1); 1 = fully corrected. */
export function colorWindowWeight(params: ColorWindowParams, u: number, v: number): number {
  const shape = Math.round(params.windowShape);
  if (shape !== 1 && shape !== 2) return 1;
  const dx = (u - params.windowX) / Math.max(params.windowWidth * 0.5, 1e-4);
  const dy = (v - params.windowY) / Math.max(params.windowHeight * 0.5, 1e-4);
  const distance = shape === 1 ? Math.hypot(dx, dy) : Math.max(Math.abs(dx), Math.abs(dy));
  const softness = Math.min(Math.max(params.windowSoftness, 0), 1);
  const inside = softness <= 1e-4 ? (distance <= 1 ? 1 : 0) : 1 - smoothstep(1 - softness, 1 + softness, distance);
  return params.windowOutside >= 0.5 ? 1 - inside : inside;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** WGSL twin of colorWindowWeight; must stay numerically identical. */
export const COLOR_WINDOW_WGSL = /* wgsl */ `
fn colorWindowWeight(uv: vec2f, p8: vec4f, p9: vec4f) -> f32 {
  let shape = u32(round(p8.x));
  if (shape != 1u && shape != 2u) { return 1.0; }
  let d = (uv - p8.yz) / max(vec2f(p8.w, p9.x) * 0.5, vec2f(0.0001));
  var distance = max(abs(d.x), abs(d.y));
  if (shape == 1u) { distance = length(d); }
  let softness = clamp(p9.y, 0.0, 1.0);
  var inside = select(0.0, 1.0, distance <= 1.0);
  if (softness > 0.0001) { inside = 1.0 - smoothstep(1.0 - softness, 1.0 + softness, distance); }
  return select(inside, 1.0 - inside, p9.z >= 0.5);
}
`;
