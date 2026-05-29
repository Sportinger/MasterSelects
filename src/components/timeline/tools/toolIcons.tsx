import type { ComponentType } from 'react';
import {
  IconAdjustmentsHorizontal,
  IconArrowsHorizontal,
  IconArrowsMaximize,
  IconArrowsMove,
  IconArrowsSplit,
  IconBlade,
  IconColumnInsertRight,
  IconColumnRemove,
  IconCopyMinus,
  IconDragDrop,
  IconFlag,
  IconHandMove,
  IconKeyframe,
  IconLayersIntersect,
  IconLayersSelected,
  IconMapPin,
  IconPencil,
  IconPlayerTrackNext,
  IconPointer,
  IconReplace,
  IconRipple,
  IconScissors,
  IconSelectAll,
  IconSquaresSelected,
  IconStretching,
  IconZoomIn,
} from '@tabler/icons-react';
import type { TimelineToolGroupId, TimelineToolId } from '../../../stores/timeline/types';
import {
  BladeAllTracksIcon,
  MarkInIcon,
  MarkOutIcon,
  RippleTrimIcon,
  RollingEditIcon,
  SlideEditIcon,
  SlipEditIcon,
  TrackSelectBackwardIcon,
  TrackSelectForwardIcon,
  TrimEdgeIcon,
  TrimToPlayheadIcon,
  type TimelineCustomIconProps,
} from './icons/TimelineCustomIcons';

export type TimelineToolIcon = ComponentType<TimelineCustomIconProps>;

export const TIMELINE_TOOL_GROUP_ICONS: Record<TimelineToolGroupId, TimelineToolIcon> = {
  selection: IconPointer,
  cut: IconBlade,
  trim: TrimEdgeIcon,
  placement: IconReplace,
  navigation: IconHandMove,
};

export const TIMELINE_TOOL_ICONS: Record<TimelineToolId, TimelineToolIcon> = {
  select: IconPointer,
  'track-select-forward': TrackSelectForwardIcon,
  'track-select-backward': TrackSelectBackwardIcon,
  'track-select-forward-all': IconSelectAll,
  'range-select': IconSquaresSelected,
  blade: IconBlade,
  'blade-all-tracks': BladeAllTracksIcon,
  'split-at-playhead': IconScissors,
  'split-all-at-playhead': IconArrowsSplit,
  'trim-start-to-playhead': TrimToPlayheadIcon,
  'trim-end-to-playhead': TrimToPlayheadIcon,
  'ripple-trim-start-to-playhead': RippleTrimIcon,
  'ripple-trim-end-to-playhead': RippleTrimIcon,
  'ripple-delete': IconRipple,
  'delete-gap': IconColumnRemove,
  'lift-range': IconCopyMinus,
  'extract-range': IconColumnRemove,
  'edge-trim': TrimEdgeIcon,
  'ripple-trim': RippleTrimIcon,
  'rolling-edit': RollingEditIcon,
  slip: SlipEditIcon,
  slide: SlideEditIcon,
  'rate-stretch': IconStretching,
  'position-overwrite': IconArrowsMove,
  insert: IconColumnInsertRight,
  overwrite: IconReplace,
  replace: IconReplace,
  'fit-to-fill': IconArrowsMaximize,
  'append-at-end': IconPlayerTrackNext,
  'place-on-top': IconLayersIntersect,
  'ripple-overwrite': IconRipple,
  hand: IconHandMove,
  zoom: IconZoomIn,
  marker: IconMapPin,
  'in-point': MarkInIcon,
  'out-point': MarkOutIcon,
  'pen-keyframe': IconKeyframe,
  'midi-draw': IconPencil,
};

export const TIMELINE_TOOL_FALLBACK_ICON = IconAdjustmentsHorizontal;
export const TIMELINE_DELETE_GAP_ICON = IconColumnRemove;
export const TIMELINE_DRAG_DROP_ICON = IconDragDrop;
export const TIMELINE_LAYERS_ICON = IconLayersSelected;
export const TIMELINE_ARROWS_HORIZONTAL_ICON = IconArrowsHorizontal;
export const TIMELINE_FLAG_ICON = IconFlag;
