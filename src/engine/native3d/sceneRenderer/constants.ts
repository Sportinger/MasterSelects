export const PLANE_UNIFORM_SIZE = 112;
/**
 * HDR scene target of every native pass: premultiplied, display-referred values that may exceed 1.
 * The tone map pass (SceneTextureComposite.wgsl) writes SCENE_DISPLAY_FORMAT for the compositor.
 */
export const SCENE_COLOR_FORMAT: GPUTextureFormat = 'rgba16float';
export const SCENE_DISPLAY_FORMAT: GPUTextureFormat = 'rgba8unorm';
export const SCENE_GIZMO_FORMAT: GPUTextureFormat = 'rgba8unorm';
export const SCENE_DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';
export const SPLAT_SOFT_DEPTH_ALPHA_CUTOFF = 0.42;
export const WORLD_HEIGHT = 2.0;
