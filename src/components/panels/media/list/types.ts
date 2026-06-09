import type { ProjectItem } from '../../../../stores/mediaStore';

export type MediaClassicColumnId =
  | 'label'
  | 'name'
  | 'badges'
  | 'duration'
  | 'resolution'
  | 'fps'
  | 'container'
  | 'codec'
  | 'audio'
  | 'bitrate'
  | 'size';

export interface MediaClassicListRowData {
  item: ProjectItem;
  depth: number;
}

export type MediaClassicBadgeTarget = 'transcript' | 'analysis';

export type MediaClassicDynamicColumnWidths = Record<Exclude<MediaClassicColumnId, 'name'>, number>;

export interface MediaClassicMarquee {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}
