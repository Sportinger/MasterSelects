import {
  SCENE_COLOR_FORMAT,
  SCENE_DEPTH_FORMAT,
  SCENE_DISPLAY_FORMAT,
  SCENE_GIZMO_FORMAT,
} from './constants';

export interface SceneTargetRefs {
  texture: GPUTexture | null;
  view: GPUTextureView | null;
  displayTexture: GPUTexture | null;
  gizmoTexture: GPUTexture | null;
  gizmoView: GPUTextureView | null;
  depthTexture: GPUTexture | null;
  depthView: GPUTextureView | null;
}

export interface SceneTargets {
  /** HDR scene color the native passes render into. */
  texture: GPUTexture;
  view: GPUTextureView;
  /** Tone mapped 8-bit image the compositor samples. */
  displayTexture: GPUTexture;
  displayView: GPUTextureView;
  gizmoTexture: GPUTexture;
  gizmoView: GPUTextureView;
  depthTexture: GPUTexture;
  depthView: GPUTextureView;
}

export function hasMatchingSceneTargets(
  targets: SceneTargetRefs,
  width: number,
  height: number,
): boolean {
  return (
    !!targets.texture &&
    targets.texture.width === width &&
    targets.texture.height === height &&
    !!targets.view &&
    !!targets.displayTexture &&
    targets.displayTexture.width === width &&
    targets.displayTexture.height === height &&
    !!targets.gizmoTexture &&
    targets.gizmoTexture.width === width &&
    targets.gizmoTexture.height === height &&
    !!targets.gizmoView &&
    !!targets.depthTexture &&
    targets.depthTexture.width === width &&
    targets.depthTexture.height === height &&
    !!targets.depthView
  );
}

export function createSceneTargets(
  device: GPUDevice,
  width: number,
  height: number,
): SceneTargets {
  const texture = device.createTexture({
    size: { width, height },
    format: SCENE_COLOR_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.STORAGE_BINDING,
    label: 'native-scene-hdr-color',
  });
  const view = texture.createView();
  const displayTexture = device.createTexture({
    size: { width, height },
    format: SCENE_DISPLAY_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
    label: 'native-scene-display',
  });
  const displayView = displayTexture.createView();
  const gizmoTexture = device.createTexture({
    size: { width, height },
    format: SCENE_GIZMO_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const gizmoView = gizmoTexture.createView();
  const depthTexture = device.createTexture({
    size: { width, height },
    format: SCENE_DEPTH_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const depthView = depthTexture.createView();

  return {
    texture,
    view,
    displayTexture,
    displayView,
    gizmoTexture,
    gizmoView,
    depthTexture,
    depthView,
  };
}
