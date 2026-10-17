import type { ComponentType } from 'react';
import {
  IconCircleDashed,
  IconHandStop,
  IconPointer,
  IconScan,
  IconSquareDashed,
  IconTypography,
  IconVectorBezier2,
  IconZoomIn,
} from '@tabler/icons-react';
import type { ShortcutActionId } from '../../../services/shortcutTypes';
import type { MaskDrawMode } from '../../../services/canvasTools';
import type { CanvasToolId } from '../../../stores/canvasToolStore';

type ToolIcon = ComponentType<{ size?: number; stroke?: number; 'aria-hidden'?: boolean | 'true' }>;

interface ToolDefinitionBase {
  label: string;
  description: string;
  icon: ToolIcon;
  shortcutActionId?: ShortcutActionId;
}

export type CanvasToolDefinition =
  | (ToolDefinitionBase & { kind: 'pointer'; id: CanvasToolId })
  | (ToolDefinitionBase & { kind: 'mask'; id: MaskDrawMode })
  | (ToolDefinitionBase & { kind: 'segment'; id: 'segment' });

/** Canvas tools in display order; `null` draws a separator. */
export const CANVAS_TOOL_LAYOUT: readonly (CanvasToolDefinition | null)[] = [
  {
    kind: 'pointer',
    id: 'move',
    label: 'Move',
    description: 'Select, move and scale layers',
    icon: IconPointer,
    shortcutActionId: 'tool.select',
  },
  {
    kind: 'pointer',
    id: 'hand',
    label: 'Hand',
    description: 'Drag to pan the view',
    icon: IconHandStop,
    shortcutActionId: 'tool.hand',
  },
  {
    kind: 'pointer',
    id: 'zoom',
    label: 'Zoom',
    description: 'Click to zoom in, Alt-click to zoom out',
    icon: IconZoomIn,
    shortcutActionId: 'tool.zoom',
  },
  {
    kind: 'pointer',
    id: 'text',
    label: 'Text',
    description: 'Click to place a text layer',
    icon: IconTypography,
    shortcutActionId: 'tool.text',
  },
  null,
  {
    kind: 'mask',
    id: 'drawingRect',
    label: 'Rectangle mask',
    description: 'Draw a rectangle mask on the selected layer',
    icon: IconSquareDashed,
    shortcutActionId: 'mask.rectangle',
  },
  {
    kind: 'mask',
    id: 'drawingEllipse',
    label: 'Ellipse mask',
    description: 'Draw an ellipse mask on the selected layer',
    icon: IconCircleDashed,
    shortcutActionId: 'mask.ellipse',
  },
  {
    kind: 'mask',
    id: 'drawingPen',
    label: 'Pen mask',
    description: 'Draw a path mask on the selected layer',
    icon: IconVectorBezier2,
    shortcutActionId: 'mask.pen',
  },
  null,
  {
    kind: 'segment',
    id: 'segment',
    label: 'AI Segment',
    description: 'Click objects to cut them out with AI Segment',
    icon: IconScan,
  },
];

export const CANVAS_TOOL_DEFINITIONS = CANVAS_TOOL_LAYOUT.filter(
  (tool): tool is CanvasToolDefinition => tool !== null,
);
