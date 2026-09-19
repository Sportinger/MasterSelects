import { describe, expect, it } from 'vitest';

import {
  applyVideoInspectorSpeedBypass,
  applyVideoInspectorTransformBypass,
  isVideoInspectorSectionEnabled,
} from '../../src/services/videoInspector/sectionBypass';
import type { ClipTransform, TimelineClip } from '../../src/types';

const editedTransform: ClipTransform = {
  opacity: 0.4,
  blendMode: 'screen',
  position: { x: 0.5, y: -0.25, z: 3 },
  scale: { all: 2, x: -2, y: 2, z: 0.5 },
  rotation: { x: 12, y: 24, z: 36 },
};

function clipWithSections(videoInspectorSections: TimelineClip['videoInspectorSections']): TimelineClip {
  return {
    id: 'clip-1',
    videoInspectorSections,
  } as TimelineClip;
}

describe('video inspector section bypass', () => {
  it('defaults Dynamic Zoom off and implemented sections on', () => {
    expect(isVideoInspectorSectionEnabled(undefined, 'dynamicZoom')).toBe(false);
    expect(isVideoInspectorSectionEnabled(undefined, 'transform')).toBe(true);
    expect(isVideoInspectorSectionEnabled(undefined, 'composite')).toBe(true);
    expect(isVideoInspectorSectionEnabled(undefined, 'speedChange')).toBe(true);
  });

  it('bypasses transform and composite while preserving the edited input', () => {
    const clip = clipWithSections({ transform: false, composite: false });
    const resolved = applyVideoInspectorTransformBypass(clip, editedTransform);

    expect(resolved).toEqual({
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      anchor: { x: 0, y: 0, z: 0 },
      scale: { all: 1, x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    expect(editedTransform).toEqual({
      opacity: 0.4,
      blendMode: 'screen',
      position: { x: 0.5, y: -0.25, z: 3 },
      scale: { all: 2, x: -2, y: 2, z: 0.5 },
      rotation: { x: 12, y: 24, z: 36 },
    });
  });

  it('bypasses speed without changing the stored speed', () => {
    const clip = clipWithSections({ speedChange: false });
    expect(applyVideoInspectorSpeedBypass(clip, 2.5)).toBe(1);
    expect(clip.videoInspectorSections?.speedChange).toBe(false);
  });
});
