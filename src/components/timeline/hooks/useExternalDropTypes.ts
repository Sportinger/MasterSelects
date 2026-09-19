import type { RefObject } from 'react';
import type { TimelineTrack, TimelineClip } from '../../../types/timeline';
import type { TextClipProperties } from '../../../types/text';
import type { Composition } from '../../../stores/mediaStore';
import type { CameraItem, MeshItem, MeshPrimitiveType, TextItem } from '../../../stores/mediaStore/types';
import type { ShapePrimitive } from '../../../types/motionDesign';
import type { LightClipSettings } from '../../../types/light';
import type { AddClipOptions, TimelineToolId } from '../../../stores/timeline/types';
import type { TimelineEditResult, TimelinePlacementMode } from '../../../stores/timeline/editOperations/types';

export interface UseExternalDropProps {
  timelineRef: RefObject<HTMLDivElement | null>;
  scrollX: number;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  isExporting: boolean;
  activeTimelineToolId: TimelineToolId;
  pixelToTime: (pixel: number) => number;
  prepareTimelinePlacementRange: (
    mode: TimelinePlacementMode,
    options: {
      trackIds?: string[];
      startTime?: number;
      duration?: number;
      includeLinked?: boolean;
      source?: 'external-drop';
      historyLabel?: string;
    },
  ) => TimelineEditResult;
  addTrack: (type: 'video' | 'audio') => string | undefined;
  addClip: (
    trackId: string,
    file: File,
    startTime: number,
    duration?: number,
    mediaFileId?: string,
    mediaTypeOverride?: string,
    options?: AddClipOptions,
  ) => Promise<string | undefined> | string | undefined | void;
  addCompClip: (trackId: string, comp: Composition, startTime: number) => void | Promise<void>;
  addTextClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean, mediaItem?: TextItem) => Promise<string | null>;
  updateTextProperties: (clipId: string, props: Partial<TextClipProperties>) => void;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
  addSolidClip: (trackId: string, startTime: number, color?: string, duration?: number, skipMediaItem?: boolean) => string | null;
  addMeshClip: (trackId: string, startTime: number, meshType: MeshPrimitiveType, duration?: number, skipMediaItem?: boolean, mediaItem?: MeshItem) => string | null;
  addCameraClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean, mediaItem?: CameraItem) => string | null;
  addLightClip: (
    trackId: string,
    startTime: number,
    duration?: number,
    skipMediaItem?: boolean,
    lightSettings?: LightClipSettings,
    mediaItemId?: string,
  ) => string | null;
  addSplatEffectorClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
  addMathSceneClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
  addMotionShapeClip: (trackId: string, startTime: number, options?: { primitive?: ShapePrimitive; duration?: number; name?: string }) => string | null;
  replaceClipSource: (clipId: string, mediaFileId: string) => boolean;
  replaceClipSourceWithComposition: (clipId: string, compositionId: string) => Promise<boolean>;
}
