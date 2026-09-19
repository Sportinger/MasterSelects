import {
  SCENE_COLOR_FORMAT,
  SCENE_DEPTH_FORMAT,
} from './constants';

export interface SceneTargetRefs {
  texture: GPUTexture | null;
  view: GPUTextureView | null;
  gizmoTexture: GPUTexture | null;
  gizmoView: GPUTextureView | null;
  depthTexture: GPUTexture | null;
  depthView: GPUTextureView | null;
}

export interface SceneTargets {
  texture: GPUTexture;
  view: GPUTextureView;
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
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const view = texture.createView();
  const gizmoTexture = device.createTexture({
    size: { width, height },
    format: SCENE_COLOR_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const gizmoView = gizmoTexture.createView();
  const depthTexture = device.createTexture({
    size: { width, height },
    format: SCENE_DEPTH_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const depthView = depthTexture.createView();

  return {
    texture,
    view,
    gizmoTexture,
    gizmoView,
    depthTexture,
    depthView,
  };
}
