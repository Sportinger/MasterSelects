import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EDIT_CAMERA_SETTINGS,
  buildPreviewCameraConfigFromTransform,
  createDefaultEditorCameraTransform,
  createPreviewEditorCameraClip,
} from '../../src/components/preview/usePreviewEditCameraConfig';
import type { TimelineClip } from '../../src/types/timeline';
import type { ClipTransform } from '../../src/types/timelineCore';

describe('preview editor camera', () => {
  it('uses a panel-local camera carrier instead of a timeline camera', () => {
    const clip = createPreviewEditorCameraClip('front');

    expect(clip.id).toBe('preview-editor-camera-front');
    expect(clip.source?.type).toBe('camera');
    expect(clip.transform.position.z).toBe(1);
  });

  it('starts outside the scene origin and looks back at it', () => {
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
      { x: 0, y: 0, z: 0 },
      DEFAULT_EDIT_CAMERA_SETTINGS,
    );

    expect(editorTransform.position).not.toEqual({ x: 0, y: 0, z: 0 });
    expect(editorCamera?.target.x).toBeCloseTo(0, 5);
    expect(editorCamera?.target.y).toBeCloseTo(0, 5);
    expect(editorCamera?.target.z).toBeCloseTo(0, 5);
  });
});
