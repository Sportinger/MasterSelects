import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EDIT_CAMERA_SETTINGS,
  EDIT_CAMERA_PIVOT_BLEND_MS,
  buildPreviewCameraConfigFromTransform,
  createDefaultEditorCameraTransform,
} from '../../src/components/preview/usePreviewEditCameraConfig';
import type { TimelineClip } from '../../src/types/timeline';
import type { ClipTransform } from '../../src/types/timelineCore';

describe('preview editor camera', () => {
  it('blends orbit pivot changes for exactly 200ms', () => {
    expect(EDIT_CAMERA_PIVOT_BLEND_MS).toBe(200);
  });

  it('starts outside the timeline camera and looks back at it', () => {
    const sceneCamera = {
      position: { x: 1, y: 2, z: 3 },
      target: { x: 1, y: 2, z: -2 },
      up: { x: 0, y: 1, z: 0 },
      fov: 50,
      near: 0.1,
      far: 1000,
    };
    const baseTransform: ClipTransform = {
      opacity: 1,
      blendMode: 'normal',
      position: { ...sceneCamera.position },
      scale: { all: 1, x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const editorTransform = createDefaultEditorCameraTransform(sceneCamera, baseTransform);
    const editorCamera = buildPreviewCameraConfigFromTransform(
      { id: 'camera', source: { type: 'camera' } } as TimelineClip,
      editorTransform,
      { width: 800, height: 600 },
      sceneCamera.position,
      DEFAULT_EDIT_CAMERA_SETTINGS,
    );

    expect(editorTransform.position).not.toEqual(sceneCamera.position);
    expect(editorCamera?.target.x).toBeCloseTo(sceneCamera.position.x, 5);
    expect(editorCamera?.target.y).toBeCloseTo(sceneCamera.position.y, 5);
    expect(editorCamera?.target.z).toBeCloseTo(sceneCamera.position.z, 5);
  });
});
