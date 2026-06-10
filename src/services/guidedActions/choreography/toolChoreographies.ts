import type { GuidedToolChoreography } from './types';
import { compileMaskEdit } from './maskChoreographies';
import { compileAddClipSegment, compileDownloadAndImportVideo, compileImportLocalFiles } from './mediaChoreographies';
import { compilePreviewAction } from './previewChoreographies';
import { compileEffectEdit, compileKeyframeEdit } from './propertyEditChoreographies';
import { compileSelectClips, compileSetPlayhead } from './selectionNavigationChoreographies';
import { compileTimelineEdit } from './timelineEditChoreographies';
import { compileSetTransform } from './transformChoreographies';
export { createDefaultToolChoreography, normalizeBatchToolCalls, stripExecutionActions } from './choreographyShared';

const CHOREOGRAPHIES = new Map<string, GuidedToolChoreography>([
  ['selectClips', compileSelectClips],
  ['setPlayhead', compileSetPlayhead],
  ['setTransform', compileSetTransform],
  ['splitClip', compileTimelineEdit],
  ['splitClipEvenly', compileTimelineEdit],
  ['splitClipAtTimes', compileTimelineEdit],
  ['trimClip', compileTimelineEdit],
  ['moveClip', compileTimelineEdit],
  ['deleteClip', compileTimelineEdit],
  ['deleteClips', compileTimelineEdit],
  ['addClipSegment', compileAddClipSegment],
  ['addRectangleMask', compileMaskEdit],
  ['addEllipseMask', compileMaskEdit],
  ['addMask', compileMaskEdit],
  ['updateMask', compileMaskEdit],
  ['addMaskPathKeyframe', compileMaskEdit],
  ['addEffect', compileEffectEdit],
  ['updateEffect', compileEffectEdit],
  ['addKeyframe', compileKeyframeEdit],
  ['captureFrame', compilePreviewAction],
  ['importLocalFiles', compileImportLocalFiles],
  ['downloadAndImportVideo', compileDownloadAndImportVideo],
]);

export function getGuidedToolChoreography(tool: string): GuidedToolChoreography | undefined {
  return CHOREOGRAPHIES.get(tool);
}
