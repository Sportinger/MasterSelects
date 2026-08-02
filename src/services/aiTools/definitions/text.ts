import type { ToolDefinition } from '../types';

const textPathPointItems = {
  type: 'object',
  properties: {
    x: { type: 'number', description: 'Normalized X coordinate in the text canvas (0-1 is inside the frame).' },
    y: { type: 'number', description: 'Normalized Y coordinate in the text canvas (0-1 is inside the frame).' },
    handleIn: {
      type: 'object',
      description: 'Incoming bezier handle offset in normalized coordinates.',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['x', 'y'],
    },
    handleOut: {
      type: 'object',
      description: 'Outgoing bezier handle offset in normalized coordinates.',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['x', 'y'],
    },
  },
  required: ['x', 'y'],
};

const textPropertySchema: Record<string, unknown> = {
  text: { type: 'string', description: 'Text content. Newlines are supported.' },
  fontFamily: { type: 'string', description: 'Font family, for example Arial, Inter, Roboto, or Open Sans.' },
  fontSize: { type: 'number', description: 'Font size in pixels (8-500).' },
  fontWeight: { type: 'number', description: 'Numeric font weight (100-900).' },
  fontStyle: { type: 'string', enum: ['normal', 'italic'], description: 'Normal or italic text.' },
  color: { type: 'string', description: 'Fill color as a CSS color, for example #ffffff or rgba(255,255,255,0.8).' },
  textAlign: { type: 'string', enum: ['left', 'center', 'right'], description: 'Horizontal alignment inside the text field.' },
  verticalAlign: { type: 'string', enum: ['top', 'middle', 'bottom'], description: 'Vertical alignment inside the text field.' },
  lineHeight: { type: 'number', description: 'Line-height multiplier (0.5-3).' },
  letterSpacing: { type: 'number', description: 'Letter spacing in pixels (-10 to 50).' },
  boxEnabled: { type: 'boolean', description: 'Enable area text wrapping and clipping inside the text field.' },
  boxX: { type: 'number', description: 'Text-field left edge in composition pixels (-100000 to 100000).' },
  boxY: { type: 'number', description: 'Text-field top edge in composition pixels (-100000 to 100000).' },
  boxWidth: { type: 'number', description: 'Text-field width in composition pixels (24-100000).' },
  boxHeight: { type: 'number', description: 'Text-field height in composition pixels (24-100000).' },
  strokeEnabled: { type: 'boolean', description: 'Enable the text outline.' },
  strokeColor: { type: 'string', description: 'Outline color as a CSS color.' },
  strokeWidth: { type: 'number', description: 'Outline width in pixels (0.5-20).' },
  shadowEnabled: { type: 'boolean', description: 'Enable the text shadow.' },
  shadowColor: { type: 'string', description: 'Shadow color as a CSS color.' },
  shadowOffsetX: { type: 'number', description: 'Horizontal shadow offset in pixels (-50 to 50).' },
  shadowOffsetY: { type: 'number', description: 'Vertical shadow offset in pixels (-50 to 50).' },
  shadowBlur: { type: 'number', description: 'Shadow blur radius in pixels (0-50).' },
  pathEnabled: { type: 'boolean', description: 'Lay the text out along pathPoints instead of normal lines.' },
  pathPoints: {
    type: 'array',
    description: 'Bezier path points in normalized text-canvas coordinates. Use at least two points when pathEnabled is true.',
    items: textPathPointItems,
  },
};

export const textToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getTextProperties',
      description: 'Read a text clip’s complete content, typography, fill, outline, shadow, path, canvas dimensions, and resolved text-field position and size.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The text clip ID.' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createEditableTitleStack',
      description: 'Atomically create 1-6 editable text rows with matching native Motion rectangle backplates. Boxes use top-left composition pixels; the tool converts backplate positions to centered Motion coordinates, allocates collision-free video tracks when needed, and guarantees TOPMOST-FIRST text-above-backplate compositing.',
      parameters: {
        type: 'object',
        properties: {
          startTime: { type: 'number', description: 'Timeline start in seconds. Defaults to the playhead.' },
          duration: { type: 'number', description: 'Duration in seconds (greater than 0, default 5).' },
          trackIds: {
            type: 'array',
            description: 'Optional exact unlocked, visible, empty video track IDs in current TOPMOST-FIRST order. Supply exactly 2 IDs per row: all text tracks first, then all backplate tracks. Omit to allocate tracks safely.',
            items: { type: 'string' },
          },
          rows: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            description: 'Editable title rows, each with an area-text box and a matching backplate.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Visible row text.' },
                name: { type: 'string', description: 'Optional semantic layer name.' },
                box: {
                  type: 'object',
                  description: 'Text box in pixels from the composition top-left.',
                  properties: {
                    x: { type: 'number', description: 'Left edge in composition pixels.' },
                    y: { type: 'number', description: 'Top edge in composition pixels.' },
                    width: { type: 'number', description: 'Box width in pixels (at least 24).' },
                    height: { type: 'number', description: 'Box height in pixels (at least 24).' },
                  },
                  required: ['x', 'y', 'width', 'height'],
                },
                textStyle: {
                  type: 'object',
                  description: 'Optional editable typography. Defaults to bold centered white Arial.',
                  properties: {
                    fontFamily: textPropertySchema.fontFamily,
                    fontSize: textPropertySchema.fontSize,
                    fontWeight: textPropertySchema.fontWeight,
                    fontStyle: textPropertySchema.fontStyle,
                    color: textPropertySchema.color,
                    textAlign: textPropertySchema.textAlign,
                    verticalAlign: textPropertySchema.verticalAlign,
                    lineHeight: textPropertySchema.lineHeight,
                    letterSpacing: textPropertySchema.letterSpacing,
                    strokeEnabled: textPropertySchema.strokeEnabled,
                    strokeColor: textPropertySchema.strokeColor,
                    strokeWidth: textPropertySchema.strokeWidth,
                    shadowEnabled: textPropertySchema.shadowEnabled,
                    shadowColor: textPropertySchema.shadowColor,
                    shadowOffsetX: textPropertySchema.shadowOffsetX,
                    shadowOffsetY: textPropertySchema.shadowOffsetY,
                    shadowBlur: textPropertySchema.shadowBlur,
                  },
                  required: [],
                },
                backplate: {
                  type: 'object',
                  description: 'Optional editable rectangle styling and padding.',
                  properties: {
                    color: { type: 'string', description: 'Hex fill color (default #000000).' },
                    opacity: { type: 'number', description: 'Fill opacity from 0 to 1 (default 0.9).' },
                    paddingX: { type: 'number', description: 'Horizontal padding in pixels (default 24).' },
                    paddingY: { type: 'number', description: 'Vertical padding in pixels (default 8).' },
                    cornerRadius: { type: 'number', description: 'Corner radius in pixels (default 12).' },
                  },
                  required: [],
                },
              },
              required: ['text', 'box'],
            },
          },
        },
        required: ['rows'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manageEditableHook',
      description: 'Create or update one durable editable hook overlay. All geometry, padding, radii, and font sizes are composition pixels. A hook is 1-4 editable text rows with native Motion backplates, a stable hookId, preset layout, shared styling, and optional per-row colors. Prefer this over assembling hook layers manually.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update'] },
          hookId: { type: 'string', description: 'Stable id beginning with hook-, reused for every later update.' },
          preset: {
            type: 'string',
            enum: ['top-banner', 'stacked-center', 'center-card', 'lower-third', 'bottom-banner'],
          },
          startTime: { type: 'number', description: 'Timeline start in seconds. Omit on update to preserve it.' },
          duration: { type: 'number', description: 'Duration in seconds. Omit on update to preserve it.' },
          rows: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            description: 'Complete visible rows. Required for create; omit on update to preserve text and per-row styling.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                textColor: { type: 'string' },
                backgroundColor: { type: 'string' },
                backgroundOpacity: { type: 'number' },
                fontSize: { type: 'number', description: 'Font size in composition pixels (8-500).' },
                fontWeight: { type: 'number' },
              },
              required: ['text'],
            },
          },
          style: {
            type: 'object',
            description: 'Shared style patch. Omitted values use preset defaults on create or preserve the current value on update.',
            properties: {
              fontFamily: { type: 'string' },
              fontSize: { type: 'number', description: 'Font size in composition pixels (8-500).' },
              fontWeight: { type: 'number' },
              textColor: { type: 'string' },
              textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
              backgroundColor: { type: 'string' },
              backgroundOpacity: { type: 'number' },
              cornerRadius: { type: 'number', description: 'Backplate corner radius in pixels.' },
              paddingX: { type: 'number', description: 'Horizontal padding in pixels.' },
              paddingY: { type: 'number', description: 'Vertical padding in pixels.' },
            },
            required: [],
          },
          placement: {
            type: 'object',
            description: 'Optional composition-pixel placement. x/y are the text box top-left; width, rowHeight, and gap are pixels.',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              rowHeight: { type: 'number' },
              gap: { type: 'number' },
            },
            required: [],
          },
        },
        required: ['action', 'hookId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'refineEditableHook',
      description: 'Refine only the indexed text rows and native backplates belonging to an existing durable hookId. All coordinates, sizes, radii, stroke widths, offsets, and font sizes are composition pixels. Prefer manageEditableHook for the first build and this tool for visual iteration.',
      parameters: {
        type: 'object',
        properties: {
          hookId: { type: 'string', description: 'Existing stable hook id beginning with hook-.' },
          textEdits: {
            type: 'array', minItems: 1, maxItems: 4,
            items: {
              type: 'object',
              properties: {
                rowIndex: { type: 'number' }, text: { type: 'string' },
                fontFamily: { type: 'string' }, fontSize: { type: 'number', description: 'Font size in composition pixels (8-500).' },
                fontStyle: { type: 'string', enum: ['normal', 'italic'] },
                fontWeight: { type: 'number' }, letterSpacing: { type: 'number', description: 'Letter spacing in pixels.' },
                lineHeight: { type: 'number' }, textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
                textColor: { type: 'string' }, verticalAlign: { type: 'string', enum: ['top', 'middle', 'bottom'] },
                strokeEnabled: { type: 'boolean' }, strokeColor: { type: 'string' }, strokeWidth: { type: 'number', description: 'Text outline width in pixels.' },
                shadowEnabled: { type: 'boolean' }, shadowColor: { type: 'string' },
                shadowOffsetX: { type: 'number', description: 'Horizontal shadow offset in pixels.' }, shadowOffsetY: { type: 'number', description: 'Vertical shadow offset in pixels.' }, shadowBlur: { type: 'number', description: 'Shadow blur radius in pixels.' },
                box: {
                  type: 'object',
                  description: 'Text box in composition pixels from the top-left.',
                  properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
                  required: [],
                },
              },
              required: ['rowIndex'],
            },
          },
          backgroundEdits: {
            type: 'array', minItems: 1, maxItems: 4,
            items: {
              type: 'object',
              properties: {
                rowIndex: { type: 'number' }, centerX: { type: 'number', description: 'Backplate center X in pixels from the composition left.' }, centerY: { type: 'number', description: 'Backplate center Y in pixels from the composition top.' },
                width: { type: 'number', description: 'Backplate width in pixels.' }, height: { type: 'number', description: 'Backplate height in pixels.' }, cornerRadius: { type: 'number', description: 'Backplate corner radius in pixels.' },
                fillColor: { type: 'string' }, fillOpacity: { type: 'number' },
                strokeEnabled: { type: 'boolean' }, strokeColor: { type: 'string' },
                strokeOpacity: { type: 'number' }, strokeWidth: { type: 'number', description: 'Backplate stroke width in pixels.' },
                strokeAlignment: { type: 'string', enum: ['center', 'inside', 'outside'] },
              },
              required: ['rowIndex'],
            },
          },
        },
        required: ['hookId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createTextClip',
      description: 'Create a real editable text clip. Omitted styling uses editor defaults. The text field uses composition-pixel coordinates; omit its rectangle for a full-frame field.',
      parameters: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Unlocked video track ID. Defaults to the first visible unlocked video track.' },
          startTime: { type: 'number', description: 'Timeline start in seconds. Defaults to the playhead.' },
          duration: { type: 'number', description: 'Duration in seconds (greater than 0, default 5).' },
          ...textPropertySchema,
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateTextProperties',
      description: 'Update any editable text setting on an existing text clip. Only supplied values change. Text-field coordinates and dimensions are composition pixels.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The text clip ID.' },
          ...textPropertySchema,
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setTextBox',
      description: 'Enable, disable, move, or resize an area-text field. Coordinates are pixels from the composition’s top-left; omitted rectangle values preserve their current value.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The text clip ID.' },
          enabled: { type: 'boolean', description: 'Enable or disable area-text wrapping and clipping.' },
          x: { type: 'number', description: 'Left edge in composition pixels (-100000 to 100000).' },
          y: { type: 'number', description: 'Top edge in composition pixels (-100000 to 100000).' },
          width: { type: 'number', description: 'Width in composition pixels (24-100000).' },
          height: { type: 'number', description: 'Height in composition pixels (24-100000).' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addTextBoundsKeyframe',
      description: 'Animate a text field’s position and size with a clip-local keyframe. Supply a rectangle in composition pixels, or omit it to capture the current field bounds.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The text clip ID.' },
          time: { type: 'number', description: 'Clip-local time in seconds. Defaults to the current playhead relative to the clip.' },
          easing: { type: 'string', description: 'Easing: linear, ease-in, ease-out, ease-in-out, or bezier.' },
          x: { type: 'number', description: 'Keyframed left edge in composition pixels (-100000 to 100000).' },
          y: { type: 'number', description: 'Keyframed top edge in composition pixels (-100000 to 100000).' },
          width: { type: 'number', description: 'Keyframed width in composition pixels (24-100000).' },
          height: { type: 'number', description: 'Keyframed height in composition pixels (24-100000).' },
        },
        required: ['clipId'],
      },
    },
  },
];
