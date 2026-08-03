import type { ToolDefinition } from '../types';

const captionBackgroundSchema = {
  type: 'object',
  description: 'Optional caption background patch. Omitted values keep their current setting.',
  properties: {
    enabled: { type: 'boolean' },
    color: { type: 'string', description: 'CSS background color.' },
    opacity: { type: 'number', description: 'Background opacity from 0 to 1.' },
    paddingX: { type: 'number', description: 'Horizontal padding in composition pixels (0-200).' },
    paddingY: { type: 'number', description: 'Vertical padding in composition pixels (0-200).' },
    borderRadius: { type: 'number', description: 'Corner radius in composition pixels (0-200).' },
  },
  required: [],
};

const captionHighlightSchema = {
  type: 'object',
  description: 'Optional word-highlight patch. Omitted values keep their current setting.',
  properties: {
    enabled: { type: 'boolean' },
    mode: { type: 'string', enum: ['active-word', 'spoken-words', 'caption-group'] },
    style: { type: 'string', enum: ['text', 'background', 'underline'] },
    scaleEnabled: { type: 'boolean' },
    scale: { type: 'number', description: 'Active-word peak scale from 1 to 3.' },
    textColor: { type: 'string', description: 'CSS active-word text color.' },
    backgroundColor: { type: 'string', description: 'CSS active-word background color.' },
    backgroundOpacity: { type: 'number', description: 'Active-word background opacity from 0 to 1.' },
    underlineColor: { type: 'string', description: 'CSS underline color.' },
    underlineWidth: { type: 'number', description: 'Underline width in composition pixels (1-30).' },
  },
  required: [],
};

const captionTextStyleSchema = {
  type: 'object',
  description: 'Optional editable caption typography patch. Omitted values keep editor defaults or the current style.',
  properties: {
    fontFamily: { type: 'string' },
    fontSize: { type: 'number', description: 'Font size in composition pixels (8-500).' },
    fontWeight: { type: 'number', description: 'Numeric font weight (100-900).' },
    fontStyle: { type: 'string', enum: ['normal', 'italic'] },
    color: { type: 'string', description: 'CSS text color.' },
    textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
    lineHeight: { type: 'number', description: 'Line-height multiplier (0.5-3).' },
    letterSpacing: { type: 'number', description: 'Letter spacing in pixels (-10 to 50).' },
    strokeEnabled: { type: 'boolean' },
    strokeColor: { type: 'string', description: 'CSS outline color.' },
    strokeWidth: { type: 'number', description: 'Outline width in pixels (0.5-20).' },
    shadowEnabled: { type: 'boolean' },
    shadowColor: { type: 'string', description: 'CSS shadow color.' },
    shadowOffsetX: { type: 'number', description: 'Horizontal shadow offset in pixels (-50 to 50).' },
    shadowOffsetY: { type: 'number', description: 'Vertical shadow offset in pixels (-50 to 50).' },
    shadowBlur: { type: 'number', description: 'Shadow blur radius in pixels (0-50).' },
  },
  required: [],
};

const captionPropertySchema: Record<string, unknown> = {
  sourceClipId: {
    type: ['string', 'null'],
    description: 'Transcript-bearing source clip ID, or null for automatic source selection.',
  },
  wordsPerCaption: { type: 'number', description: 'Maximum words per caption group (integer 1-20).' },
  gapThreshold: { type: 'number', description: 'Start a new group after this speech gap in seconds (0-5).' },
  holdAfter: { type: 'number', description: 'Hold a group after its final word in seconds (0-3).' },
  textTransform: { type: 'string', enum: ['none', 'uppercase', 'lowercase', 'capitalize'] },
  positionX: { type: 'number', description: 'Caption-box horizontal center as frame percent (0-100).' },
  positionY: { type: 'number', description: 'Caption-box vertical center as frame percent (0-100).' },
  maxWidth: { type: 'number', description: 'Caption-box width as frame percent (10-100).' },
  maxLines: { type: 'number', description: 'Maximum caption lines (integer 1-10).' },
  background: captionBackgroundSchema,
  highlight: captionHighlightSchema,
  textStyle: captionTextStyleSchema,
};

export const captionToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getCaptionProperties',
      description: 'Read one dynamic caption clip, including timing, transcript source, editable typography, layout, background, highlighting, and available transcript-bearing sources.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The caption clip ID.' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createCaptionClip',
      description: 'Create one transcript-driven editable caption clip. The editor uses an unlocked visible video track only when the requested interval is empty and automatically creates a new top video layer when no existing layer has room, so no clip is overlapped.',
      parameters: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Optional exact unlocked, visible, empty video track ID. Omit for collision-free automatic layer allocation.' },
          startTime: { type: 'number', description: 'Timeline start in seconds. Defaults to the source start when sourceClipId is set, otherwise the playhead.' },
          duration: { type: 'number', description: 'Duration in seconds. Defaults to the remaining source duration.' },
          ...captionPropertySchema,
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateCaptionProperties',
      description: 'Update an existing dynamic caption clip. Only supplied caption timing, source, box layout, typography, background, and word-highlight values change.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The caption clip ID.' },
          ...captionPropertySchema,
        },
        required: ['clipId'],
      },
    },
  },
];
