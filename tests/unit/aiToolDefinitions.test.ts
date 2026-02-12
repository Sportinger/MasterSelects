import { describe, it, expect } from 'vitest';
import {
  AI_TOOLS,
  timelineToolDefinitions,
  clipToolDefinitions,
  trackToolDefinitions,
  previewToolDefinitions,
  analysisToolDefinitions,
  mediaToolDefinitions,
  batchToolDefinitions,
} from '../../src/services/aiTools/definitions/index';
import { MODIFYING_TOOLS } from '../../src/services/aiTools/types';
import type { ToolDefinition } from '../../src/services/aiTools/types';

// ─── Helper ─────────────────────────────────────────────────────────────────

function findTool(name: string): ToolDefinition {
  const tool = AI_TOOLS.find((t) => t.function.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

function getProp(tool: ToolDefinition, propName: string): Record<string, unknown> {
  return tool.function.parameters.properties[propName] as Record<string, unknown>;
}

// ─── Tool count validation ─────────────────────────────────────────────────

describe('AI_TOOLS combined array', () => {
  it('contains exactly 36 tool definitions', () => {
    expect(AI_TOOLS).toHaveLength(36);
  });

  it('equals the sum of all category arrays', () => {
    const expectedLength =
      timelineToolDefinitions.length +
      clipToolDefinitions.length +
      trackToolDefinitions.length +
      previewToolDefinitions.length +
      analysisToolDefinitions.length +
      mediaToolDefinitions.length +
      batchToolDefinitions.length;

    expect(AI_TOOLS).toHaveLength(expectedLength);
  });

  it('preserves category ordering (timeline, clips, tracks, preview, analysis, media, batch)', () => {
    const expected = [
      ...timelineToolDefinitions,
      ...clipToolDefinitions,
      ...trackToolDefinitions,
      ...previewToolDefinitions,
      ...analysisToolDefinitions,
      ...mediaToolDefinitions,
      ...batchToolDefinitions,
    ];
    expect(AI_TOOLS).toEqual(expected);
  });

  it('is a plain array (not frozen or sealed)', () => {
    expect(Array.isArray(AI_TOOLS)).toBe(true);
  });
});

// ─── Per-category counts ────────────────────────────────────────────────────

describe('category tool counts', () => {
  it('timelineToolDefinitions has 3 tools', () => {
    expect(timelineToolDefinitions).toHaveLength(3);
  });

  it('clipToolDefinitions has 12 tools', () => {
    expect(clipToolDefinitions).toHaveLength(12);
  });

  it('batchToolDefinitions has 1 tool', () => {
    expect(batchToolDefinitions).toHaveLength(1);
  });

  it('trackToolDefinitions has 4 tools', () => {
    expect(trackToolDefinitions).toHaveLength(4);
  });

  it('previewToolDefinitions has 3 tools', () => {
    expect(previewToolDefinitions).toHaveLength(3);
  });

  it('analysisToolDefinitions has 6 tools', () => {
    expect(analysisToolDefinitions).toHaveLength(6);
  });

  it('mediaToolDefinitions has 7 tools', () => {
    expect(mediaToolDefinitions).toHaveLength(7);
  });
});

// ─── Per-category tool name membership ──────────────────────────────────────

describe('category membership', () => {
  it('timelineToolDefinitions contains exactly getTimelineState, setPlayhead, setInOutPoints', () => {
    const names = timelineToolDefinitions.map((t) => t.function.name);
    expect(names).toEqual(['getTimelineState', 'setPlayhead', 'setInOutPoints']);
  });

  it('clipToolDefinitions contains the expected 12 clip tools', () => {
    const names = clipToolDefinitions.map((t) => t.function.name);
    expect(names).toEqual([
      'getClipDetails',
      'getClipsInTimeRange',
      'splitClip',
      'deleteClip',
      'deleteClips',
      'moveClip',
      'trimClip',
      'cutRangesFromClip',
      'splitClipEvenly',
      'splitClipAtTimes',
      'selectClips',
      'clearSelection',
    ]);
  });

  it('batchToolDefinitions contains exactly executeBatch', () => {
    const names = batchToolDefinitions.map((t) => t.function.name);
    expect(names).toEqual(['executeBatch']);
  });

  it('trackToolDefinitions contains the expected 4 track tools', () => {
    const names = trackToolDefinitions.map((t) => t.function.name);
    expect(names).toEqual(['createTrack', 'deleteTrack', 'setTrackVisibility', 'setTrackMuted']);
  });

  it('previewToolDefinitions contains the expected 3 preview tools', () => {
    const names = previewToolDefinitions.map((t) => t.function.name);
    expect(names).toEqual(['captureFrame', 'getCutPreviewQuad', 'getFramesAtTimes']);
  });

  it('analysisToolDefinitions contains the expected 6 analysis tools', () => {
    const names = analysisToolDefinitions.map((t) => t.function.name);
    expect(names).toEqual([
      'getClipAnalysis',
      'getClipTranscript',
      'findSilentSections',
      'findLowQualitySections',
      'startClipAnalysis',
      'startClipTranscription',
    ]);
  });

  it('mediaToolDefinitions contains the expected 7 media tools', () => {
    const names = mediaToolDefinitions.map((t) => t.function.name);
    expect(names).toEqual([
      'getMediaItems',
      'createMediaFolder',
      'renameMediaItem',
      'deleteMediaItem',
      'moveMediaItems',
      'createComposition',
      'selectMediaItems',
    ]);
  });
});

// ─── OpenAI function calling format validation ──────────────────────────────

describe('OpenAI function calling format', () => {
  it.each(AI_TOOLS.map((t) => [t.function.name, t]))(
    '%s has type "function"',
    (_name, tool) => {
      expect((tool as ToolDefinition).type).toBe('function');
    }
  );

  it('every tool has a non-empty name', () => {
    for (const tool of AI_TOOLS) {
      expect(tool.function.name).toBeTruthy();
      expect(typeof tool.function.name).toBe('string');
      expect(tool.function.name.length).toBeGreaterThan(0);
    }
  });

  it('every tool has a non-empty description', () => {
    for (const tool of AI_TOOLS) {
      expect(tool.function.description).toBeTruthy();
      expect(typeof tool.function.description).toBe('string');
      expect(tool.function.description.length).toBeGreaterThan(0);
    }
  });

  it('every tool has a parameters object with type "object"', () => {
    for (const tool of AI_TOOLS) {
      expect(tool.function.parameters).toBeDefined();
      expect(tool.function.parameters.type).toBe('object');
    }
  });

  it('every tool parameters has a properties object', () => {
    for (const tool of AI_TOOLS) {
      expect(tool.function.parameters.properties).toBeDefined();
      expect(typeof tool.function.parameters.properties).toBe('object');
    }
  });

  it('every tool parameters has a required array', () => {
    for (const tool of AI_TOOLS) {
      expect(Array.isArray(tool.function.parameters.required)).toBe(true);
    }
  });

  it('required fields reference existing properties', () => {
    for (const tool of AI_TOOLS) {
      const propKeys = Object.keys(tool.function.parameters.properties);
      for (const req of tool.function.parameters.required) {
        expect(propKeys).toContain(req);
      }
    }
  });

  it('every property definition has a type field', () => {
    for (const tool of AI_TOOLS) {
      const props = tool.function.parameters.properties;
      for (const [key, value] of Object.entries(props)) {
        const prop = value as Record<string, unknown>;
        expect(prop.type).toBeDefined();
        expect(typeof prop.type).toBe('string');
        // Provide helpful error context
        if (!prop.type) {
          throw new Error(`Property "${key}" in tool "${tool.function.name}" is missing a type`);
        }
      }
    }
  });

  it('every property definition has a description field', () => {
    for (const tool of AI_TOOLS) {
      const props = tool.function.parameters.properties;
      for (const [key, value] of Object.entries(props)) {
        const prop = value as Record<string, unknown>;
        expect(prop.description).toBeDefined();
        expect(typeof prop.description).toBe('string');
        expect((prop.description as string).length).toBeGreaterThan(0);
        if (!prop.description) {
          throw new Error(`Property "${key}" in tool "${tool.function.name}" is missing a description`);
        }
      }
    }
  });

  it('property types are valid JSON Schema types', () => {
    const validTypes = ['string', 'number', 'boolean', 'array', 'object', 'integer', 'null'];
    for (const tool of AI_TOOLS) {
      const props = tool.function.parameters.properties;
      for (const [key, value] of Object.entries(props)) {
        const prop = value as Record<string, unknown>;
        expect(validTypes).toContain(prop.type);
        if (!validTypes.includes(prop.type as string)) {
          throw new Error(
            `Property "${key}" in tool "${tool.function.name}" has invalid type "${prop.type}"`
          );
        }
      }
    }
  });

  it('description does not end with a trailing space', () => {
    for (const tool of AI_TOOLS) {
      const desc = tool.function.description;
      expect(desc).toBe(desc.trim());
    }
  });
});

// ─── No duplicate tool names ────────────────────────────────────────────────

describe('uniqueness', () => {
  it('has no duplicate tool names', () => {
    const names = AI_TOOLS.map((t) => t.function.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('has no duplicate tool names within categories', () => {
    const categories = [
      { name: 'timeline', tools: timelineToolDefinitions },
      { name: 'clip', tools: clipToolDefinitions },
      { name: 'track', tools: trackToolDefinitions },
      { name: 'preview', tools: previewToolDefinitions },
      { name: 'analysis', tools: analysisToolDefinitions },
      { name: 'media', tools: mediaToolDefinitions },
      { name: 'batch', tools: batchToolDefinitions },
    ];

    for (const cat of categories) {
      const names = cat.tools.map((t) => t.function.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    }
  });
});

// ─── Naming convention ──────────────────────────────────────────────────────

describe('naming convention', () => {
  it('all tool names use camelCase (start with lowercase, no underscores or hyphens)', () => {
    for (const tool of AI_TOOLS) {
      const name = tool.function.name;
      // camelCase: starts with lowercase letter, no underscores or hyphens
      expect(name).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
  });

  it('tool names are reasonably short (under 30 characters)', () => {
    for (const tool of AI_TOOLS) {
      expect(tool.function.name.length).toBeLessThanOrEqual(30);
    }
  });
});

// ─── Specific tool existence checks ─────────────────────────────────────────

describe('expected tools exist', () => {
  const toolNames = AI_TOOLS.map((t) => t.function.name);

  it('includes core timeline tools', () => {
    expect(toolNames).toContain('getTimelineState');
    expect(toolNames).toContain('setPlayhead');
    expect(toolNames).toContain('setInOutPoints');
  });

  it('includes core clip editing tools', () => {
    expect(toolNames).toContain('splitClip');
    expect(toolNames).toContain('splitClipEvenly');
    expect(toolNames).toContain('splitClipAtTimes');
    expect(toolNames).toContain('deleteClip');
    expect(toolNames).toContain('moveClip');
    expect(toolNames).toContain('trimClip');
    expect(toolNames).toContain('cutRangesFromClip');
  });

  it('includes clip query tools', () => {
    expect(toolNames).toContain('getClipDetails');
    expect(toolNames).toContain('getClipsInTimeRange');
  });

  it('includes multi-clip tools', () => {
    expect(toolNames).toContain('deleteClips');
    expect(toolNames).toContain('selectClips');
    expect(toolNames).toContain('clearSelection');
  });

  it('includes core track tools', () => {
    expect(toolNames).toContain('createTrack');
    expect(toolNames).toContain('deleteTrack');
    expect(toolNames).toContain('setTrackVisibility');
    expect(toolNames).toContain('setTrackMuted');
  });

  it('includes preview tools', () => {
    expect(toolNames).toContain('captureFrame');
    expect(toolNames).toContain('getCutPreviewQuad');
    expect(toolNames).toContain('getFramesAtTimes');
  });

  it('includes analysis tools', () => {
    expect(toolNames).toContain('getClipAnalysis');
    expect(toolNames).toContain('getClipTranscript');
    expect(toolNames).toContain('findSilentSections');
    expect(toolNames).toContain('findLowQualitySections');
    expect(toolNames).toContain('startClipAnalysis');
    expect(toolNames).toContain('startClipTranscription');
  });

  it('includes media tools', () => {
    expect(toolNames).toContain('getMediaItems');
    expect(toolNames).toContain('createMediaFolder');
    expect(toolNames).toContain('createComposition');
    expect(toolNames).toContain('selectMediaItems');
  });

  it('includes media management tools', () => {
    expect(toolNames).toContain('renameMediaItem');
    expect(toolNames).toContain('deleteMediaItem');
    expect(toolNames).toContain('moveMediaItems');
  });

  it('includes batch tool', () => {
    expect(toolNames).toContain('executeBatch');
  });

  it('has exactly 36 expected tool names covering all tools', () => {
    const allExpectedNames = [
      // Timeline (3)
      'getTimelineState', 'setPlayhead', 'setInOutPoints',
      // Clips (12)
      'getClipDetails', 'getClipsInTimeRange', 'splitClip', 'deleteClip', 'deleteClips',
      'moveClip', 'trimClip', 'cutRangesFromClip', 'splitClipEvenly', 'splitClipAtTimes',
      'selectClips', 'clearSelection',
      // Tracks (4)
      'createTrack', 'deleteTrack', 'setTrackVisibility', 'setTrackMuted',
      // Preview (3)
      'captureFrame', 'getCutPreviewQuad', 'getFramesAtTimes',
      // Analysis (6)
      'getClipAnalysis', 'getClipTranscript', 'findSilentSections',
      'findLowQualitySections', 'startClipAnalysis', 'startClipTranscription',
      // Media (7)
      'getMediaItems', 'createMediaFolder', 'renameMediaItem', 'deleteMediaItem',
      'moveMediaItems', 'createComposition', 'selectMediaItems',
      // Batch (1)
      'executeBatch',
    ];
    const actualNames = AI_TOOLS.map((t) => t.function.name);
    expect(actualNames.sort()).toEqual(allExpectedNames.sort());
  });
});

// ─── MODIFYING_TOOLS validation ─────────────────────────────────────────────

describe('MODIFYING_TOOLS set', () => {
  it('is a Set', () => {
    expect(MODIFYING_TOOLS).toBeInstanceOf(Set);
  });

  it('contains all destructive clip operations', () => {
    expect(MODIFYING_TOOLS.has('splitClip')).toBe(true);
    expect(MODIFYING_TOOLS.has('splitClipEvenly')).toBe(true);
    expect(MODIFYING_TOOLS.has('splitClipAtTimes')).toBe(true);
    expect(MODIFYING_TOOLS.has('deleteClip')).toBe(true);
    expect(MODIFYING_TOOLS.has('deleteClips')).toBe(true);
    expect(MODIFYING_TOOLS.has('moveClip')).toBe(true);
    expect(MODIFYING_TOOLS.has('trimClip')).toBe(true);
    expect(MODIFYING_TOOLS.has('cutRangesFromClip')).toBe(true);
  });

  it('contains batch execution tool', () => {
    expect(MODIFYING_TOOLS.has('executeBatch')).toBe(true);
  });

  it('contains all destructive track operations', () => {
    expect(MODIFYING_TOOLS.has('createTrack')).toBe(true);
    expect(MODIFYING_TOOLS.has('deleteTrack')).toBe(true);
    expect(MODIFYING_TOOLS.has('setTrackVisibility')).toBe(true);
    expect(MODIFYING_TOOLS.has('setTrackMuted')).toBe(true);
  });

  it('contains all modifying media operations', () => {
    expect(MODIFYING_TOOLS.has('createMediaFolder')).toBe(true);
    expect(MODIFYING_TOOLS.has('renameMediaItem')).toBe(true);
    expect(MODIFYING_TOOLS.has('deleteMediaItem')).toBe(true);
    expect(MODIFYING_TOOLS.has('moveMediaItems')).toBe(true);
    expect(MODIFYING_TOOLS.has('createComposition')).toBe(true);
  });

  it('does NOT contain read-only tools', () => {
    expect(MODIFYING_TOOLS.has('getTimelineState')).toBe(false);
    expect(MODIFYING_TOOLS.has('getClipDetails')).toBe(false);
    expect(MODIFYING_TOOLS.has('getClipsInTimeRange')).toBe(false);
    expect(MODIFYING_TOOLS.has('getClipAnalysis')).toBe(false);
    expect(MODIFYING_TOOLS.has('getClipTranscript')).toBe(false);
    expect(MODIFYING_TOOLS.has('getMediaItems')).toBe(false);
    expect(MODIFYING_TOOLS.has('captureFrame')).toBe(false);
    expect(MODIFYING_TOOLS.has('getCutPreviewQuad')).toBe(false);
    expect(MODIFYING_TOOLS.has('getFramesAtTimes')).toBe(false);
    expect(MODIFYING_TOOLS.has('findSilentSections')).toBe(false);
    expect(MODIFYING_TOOLS.has('findLowQualitySections')).toBe(false);
    expect(MODIFYING_TOOLS.has('selectMediaItems')).toBe(false);
  });

  it('does NOT contain selection/playback tools', () => {
    expect(MODIFYING_TOOLS.has('setPlayhead')).toBe(false);
    expect(MODIFYING_TOOLS.has('setInOutPoints')).toBe(false);
    expect(MODIFYING_TOOLS.has('selectClips')).toBe(false);
    expect(MODIFYING_TOOLS.has('clearSelection')).toBe(false);
  });

  it('does NOT contain analysis trigger tools', () => {
    expect(MODIFYING_TOOLS.has('startClipAnalysis')).toBe(false);
    expect(MODIFYING_TOOLS.has('startClipTranscription')).toBe(false);
  });

  it('every modifying tool has a matching tool definition', () => {
    const definedNames = new Set(AI_TOOLS.map((t) => t.function.name));
    for (const name of MODIFYING_TOOLS) {
      expect(definedNames.has(name)).toBe(true);
    }
  });

  it('has the expected total count of modifying tools', () => {
    // 8 clip + 4 track + 5 media + 1 batch = 18
    expect(MODIFYING_TOOLS.size).toBe(18);
  });
});

// ─── Parameter schema details for key tools ─────────────────────────────────

describe('parameter schemas for key tools', () => {
  it('splitClip requires clipId and splitTime', () => {
    const tool = findTool('splitClip');
    expect(tool.function.parameters.required).toEqual(['clipId', 'splitTime']);
    expect(tool.function.parameters.properties).toHaveProperty('clipId');
    expect(tool.function.parameters.properties).toHaveProperty('splitTime');
  });

  it('cutRangesFromClip requires clipId and ranges (array)', () => {
    const tool = findTool('cutRangesFromClip');
    expect(tool.function.parameters.required).toEqual(['clipId', 'ranges']);
    const rangesProp = tool.function.parameters.properties['ranges'] as Record<string, unknown>;
    expect(rangesProp.type).toBe('array');
  });

  it('createComposition requires only name, has optional width/height/frameRate/duration', () => {
    const tool = findTool('createComposition');
    expect(tool.function.parameters.required).toEqual(['name']);
    const props = Object.keys(tool.function.parameters.properties);
    expect(props).toContain('name');
    expect(props).toContain('width');
    expect(props).toContain('height');
    expect(props).toContain('frameRate');
    expect(props).toContain('duration');
  });

  it('getTimelineState has no required parameters', () => {
    const tool = findTool('getTimelineState');
    expect(tool.function.parameters.required).toEqual([]);
  });

  it('moveClip requires clipId and newStartTime, newTrackId is optional', () => {
    const tool = findTool('moveClip');
    expect(tool.function.parameters.required).toEqual(['clipId', 'newStartTime']);
    expect(Object.keys(tool.function.parameters.properties)).toContain('newTrackId');
  });
});

// ─── Tools with no required parameters ──────────────────────────────────────

describe('tools with no required parameters', () => {
  it('getTimelineState has empty properties and no required fields', () => {
    const tool = findTool('getTimelineState');
    expect(tool.function.parameters.required).toEqual([]);
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(0);
  });

  it('clearSelection has empty properties and no required fields', () => {
    const tool = findTool('clearSelection');
    expect(tool.function.parameters.required).toEqual([]);
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(0);
  });

  it('captureFrame has optional time parameter only', () => {
    const tool = findTool('captureFrame');
    expect(tool.function.parameters.required).toEqual([]);
    expect(Object.keys(tool.function.parameters.properties)).toEqual(['time']);
    expect(getProp(tool, 'time').type).toBe('number');
  });

  it('setInOutPoints has optional inPoint and outPoint parameters', () => {
    const tool = findTool('setInOutPoints');
    expect(tool.function.parameters.required).toEqual([]);
    expect(Object.keys(tool.function.parameters.properties)).toContain('inPoint');
    expect(Object.keys(tool.function.parameters.properties)).toContain('outPoint');
    expect(getProp(tool, 'inPoint').type).toBe('number');
    expect(getProp(tool, 'outPoint').type).toBe('number');
  });

  it('getMediaItems has optional folderId parameter only', () => {
    const tool = findTool('getMediaItems');
    expect(tool.function.parameters.required).toEqual([]);
    expect(Object.keys(tool.function.parameters.properties)).toEqual(['folderId']);
    expect(getProp(tool, 'folderId').type).toBe('string');
  });
});

// ─── Detailed schema validation per tool category ───────────────────────────

describe('timeline tool schemas', () => {
  it('setPlayhead requires time (number)', () => {
    const tool = findTool('setPlayhead');
    expect(tool.function.parameters.required).toEqual(['time']);
    expect(getProp(tool, 'time').type).toBe('number');
  });
});

describe('clip tool schemas', () => {
  it('getClipDetails requires clipId (string)', () => {
    const tool = findTool('getClipDetails');
    expect(tool.function.parameters.required).toEqual(['clipId']);
    expect(getProp(tool, 'clipId').type).toBe('string');
  });

  it('getClipsInTimeRange requires startTime and endTime, has optional trackType with enum', () => {
    const tool = findTool('getClipsInTimeRange');
    expect(tool.function.parameters.required).toEqual(['startTime', 'endTime']);
    expect(getProp(tool, 'startTime').type).toBe('number');
    expect(getProp(tool, 'endTime').type).toBe('number');
    const trackTypeProp = getProp(tool, 'trackType');
    expect(trackTypeProp.type).toBe('string');
    expect(trackTypeProp.enum).toEqual(['video', 'audio', 'all']);
  });

  it('deleteClip requires clipId (string)', () => {
    const tool = findTool('deleteClip');
    expect(tool.function.parameters.required).toEqual(['clipId']);
    expect(getProp(tool, 'clipId').type).toBe('string');
  });

  it('deleteClips requires clipIds (array of strings)', () => {
    const tool = findTool('deleteClips');
    expect(tool.function.parameters.required).toEqual(['clipIds']);
    const clipIdsProp = getProp(tool, 'clipIds');
    expect(clipIdsProp.type).toBe('array');
    expect((clipIdsProp.items as Record<string, unknown>).type).toBe('string');
  });

  it('trimClip requires clipId, inPoint, and outPoint', () => {
    const tool = findTool('trimClip');
    expect(tool.function.parameters.required).toEqual(['clipId', 'inPoint', 'outPoint']);
    expect(getProp(tool, 'clipId').type).toBe('string');
    expect(getProp(tool, 'inPoint').type).toBe('number');
    expect(getProp(tool, 'outPoint').type).toBe('number');
  });

  it('selectClips requires clipIds (array of strings)', () => {
    const tool = findTool('selectClips');
    expect(tool.function.parameters.required).toEqual(['clipIds']);
    const clipIdsProp = getProp(tool, 'clipIds');
    expect(clipIdsProp.type).toBe('array');
    expect((clipIdsProp.items as Record<string, unknown>).type).toBe('string');
  });

  it('cutRangesFromClip ranges items have nested object schema with timelineStart/timelineEnd', () => {
    const tool = findTool('cutRangesFromClip');
    const rangesProp = getProp(tool, 'ranges');
    expect(rangesProp.type).toBe('array');
    const items = rangesProp.items as Record<string, unknown>;
    expect(items.type).toBe('object');
    const itemProps = items.properties as Record<string, Record<string, unknown>>;
    expect(itemProps.timelineStart).toBeDefined();
    expect(itemProps.timelineStart.type).toBe('number');
    expect(itemProps.timelineEnd).toBeDefined();
    expect(itemProps.timelineEnd.type).toBe('number');
    expect(items.required).toEqual(['timelineStart', 'timelineEnd']);
  });

  it('splitClip clipId is string and splitTime is number', () => {
    const tool = findTool('splitClip');
    expect(getProp(tool, 'clipId').type).toBe('string');
    expect(getProp(tool, 'splitTime').type).toBe('number');
  });

  it('moveClip has exactly 3 properties: clipId, newStartTime, newTrackId', () => {
    const tool = findTool('moveClip');
    const propNames = Object.keys(tool.function.parameters.properties);
    expect(propNames).toHaveLength(3);
    expect(propNames).toContain('clipId');
    expect(propNames).toContain('newStartTime');
    expect(propNames).toContain('newTrackId');
    expect(getProp(tool, 'clipId').type).toBe('string');
    expect(getProp(tool, 'newStartTime').type).toBe('number');
    expect(getProp(tool, 'newTrackId').type).toBe('string');
  });
});

describe('track tool schemas', () => {
  it('createTrack requires type with enum [video, audio]', () => {
    const tool = findTool('createTrack');
    expect(tool.function.parameters.required).toEqual(['type']);
    const typeProp = getProp(tool, 'type');
    expect(typeProp.type).toBe('string');
    expect(typeProp.enum).toEqual(['video', 'audio']);
  });

  it('deleteTrack requires trackId (string)', () => {
    const tool = findTool('deleteTrack');
    expect(tool.function.parameters.required).toEqual(['trackId']);
    expect(getProp(tool, 'trackId').type).toBe('string');
  });

  it('setTrackVisibility requires trackId (string) and visible (boolean)', () => {
    const tool = findTool('setTrackVisibility');
    expect(tool.function.parameters.required).toEqual(['trackId', 'visible']);
    expect(getProp(tool, 'trackId').type).toBe('string');
    expect(getProp(tool, 'visible').type).toBe('boolean');
  });

  it('setTrackMuted requires trackId (string) and muted (boolean)', () => {
    const tool = findTool('setTrackMuted');
    expect(tool.function.parameters.required).toEqual(['trackId', 'muted']);
    expect(getProp(tool, 'trackId').type).toBe('string');
    expect(getProp(tool, 'muted').type).toBe('boolean');
  });
});

describe('preview tool schemas', () => {
  it('getCutPreviewQuad requires cutTime, has optional frameSpacing', () => {
    const tool = findTool('getCutPreviewQuad');
    expect(tool.function.parameters.required).toEqual(['cutTime']);
    expect(getProp(tool, 'cutTime').type).toBe('number');
    expect(getProp(tool, 'frameSpacing').type).toBe('number');
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(2);
  });

  it('getFramesAtTimes requires times (array of numbers), has optional columns', () => {
    const tool = findTool('getFramesAtTimes');
    expect(tool.function.parameters.required).toEqual(['times']);
    const timesProp = getProp(tool, 'times');
    expect(timesProp.type).toBe('array');
    expect((timesProp.items as Record<string, unknown>).type).toBe('number');
    expect(getProp(tool, 'columns').type).toBe('number');
  });
});

describe('analysis tool schemas', () => {
  it('getClipAnalysis requires clipId (string)', () => {
    const tool = findTool('getClipAnalysis');
    expect(tool.function.parameters.required).toEqual(['clipId']);
    expect(getProp(tool, 'clipId').type).toBe('string');
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(1);
  });

  it('getClipTranscript requires clipId (string)', () => {
    const tool = findTool('getClipTranscript');
    expect(tool.function.parameters.required).toEqual(['clipId']);
    expect(getProp(tool, 'clipId').type).toBe('string');
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(1);
  });

  it('findSilentSections requires clipId, has optional minDuration', () => {
    const tool = findTool('findSilentSections');
    expect(tool.function.parameters.required).toEqual(['clipId']);
    expect(getProp(tool, 'clipId').type).toBe('string');
    expect(getProp(tool, 'minDuration').type).toBe('number');
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(2);
  });

  it('findLowQualitySections requires clipId, has optional metric (enum), threshold, minDuration', () => {
    const tool = findTool('findLowQualitySections');
    expect(tool.function.parameters.required).toEqual(['clipId']);
    expect(getProp(tool, 'clipId').type).toBe('string');
    const metricProp = getProp(tool, 'metric');
    expect(metricProp.type).toBe('string');
    expect(metricProp.enum).toEqual(['focus', 'motion', 'brightness']);
    expect(getProp(tool, 'threshold').type).toBe('number');
    expect(getProp(tool, 'minDuration').type).toBe('number');
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(4);
  });

  it('startClipAnalysis requires clipId (string)', () => {
    const tool = findTool('startClipAnalysis');
    expect(tool.function.parameters.required).toEqual(['clipId']);
    expect(getProp(tool, 'clipId').type).toBe('string');
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(1);
  });

  it('startClipTranscription requires clipId (string)', () => {
    const tool = findTool('startClipTranscription');
    expect(tool.function.parameters.required).toEqual(['clipId']);
    expect(getProp(tool, 'clipId').type).toBe('string');
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(1);
  });
});

describe('media tool schemas', () => {
  it('createMediaFolder requires name (string), has optional parentFolderId', () => {
    const tool = findTool('createMediaFolder');
    expect(tool.function.parameters.required).toEqual(['name']);
    expect(getProp(tool, 'name').type).toBe('string');
    expect(getProp(tool, 'parentFolderId').type).toBe('string');
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(2);
  });

  it('renameMediaItem requires itemId and newName (both strings)', () => {
    const tool = findTool('renameMediaItem');
    expect(tool.function.parameters.required).toEqual(['itemId', 'newName']);
    expect(getProp(tool, 'itemId').type).toBe('string');
    expect(getProp(tool, 'newName').type).toBe('string');
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(2);
  });

  it('deleteMediaItem requires itemId (string)', () => {
    const tool = findTool('deleteMediaItem');
    expect(tool.function.parameters.required).toEqual(['itemId']);
    expect(getProp(tool, 'itemId').type).toBe('string');
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(1);
  });

  it('moveMediaItems requires itemIds (array of strings), has optional targetFolderId', () => {
    const tool = findTool('moveMediaItems');
    expect(tool.function.parameters.required).toEqual(['itemIds']);
    const itemIdsProp = getProp(tool, 'itemIds');
    expect(itemIdsProp.type).toBe('array');
    expect((itemIdsProp.items as Record<string, unknown>).type).toBe('string');
    expect(getProp(tool, 'targetFolderId').type).toBe('string');
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(2);
  });

  it('selectMediaItems requires itemIds (array of strings)', () => {
    const tool = findTool('selectMediaItems');
    expect(tool.function.parameters.required).toEqual(['itemIds']);
    const itemIdsProp = getProp(tool, 'itemIds');
    expect(itemIdsProp.type).toBe('array');
    expect((itemIdsProp.items as Record<string, unknown>).type).toBe('string');
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(1);
  });

  it('createComposition has exactly 5 properties with correct types', () => {
    const tool = findTool('createComposition');
    expect(Object.keys(tool.function.parameters.properties)).toHaveLength(5);
    expect(getProp(tool, 'name').type).toBe('string');
    expect(getProp(tool, 'width').type).toBe('number');
    expect(getProp(tool, 'height').type).toBe('number');
    expect(getProp(tool, 'frameRate').type).toBe('number');
    expect(getProp(tool, 'duration').type).toBe('number');
  });
});

// ─── Enum property validation across all tools ──────────────────────────────

describe('enum constraints', () => {
  it('only createTrack type and getClipsInTimeRange trackType and findLowQualitySections metric use enums', () => {
    const toolsWithEnums: { toolName: string; propName: string; values: string[] }[] = [];

    for (const tool of AI_TOOLS) {
      const props = tool.function.parameters.properties;
      for (const [key, value] of Object.entries(props)) {
        const prop = value as Record<string, unknown>;
        if (prop.enum) {
          toolsWithEnums.push({
            toolName: tool.function.name,
            propName: key,
            values: prop.enum as string[],
          });
        }
      }
    }

    expect(toolsWithEnums).toHaveLength(3);
    expect(toolsWithEnums).toContainEqual({
      toolName: 'createTrack',
      propName: 'type',
      values: ['video', 'audio'],
    });
    expect(toolsWithEnums).toContainEqual({
      toolName: 'getClipsInTimeRange',
      propName: 'trackType',
      values: ['video', 'audio', 'all'],
    });
    expect(toolsWithEnums).toContainEqual({
      toolName: 'findLowQualitySections',
      propName: 'metric',
      values: ['focus', 'motion', 'brightness'],
    });
  });

  it('all enum values are non-empty strings', () => {
    for (const tool of AI_TOOLS) {
      const props = tool.function.parameters.properties;
      for (const [, value] of Object.entries(props)) {
        const prop = value as Record<string, unknown>;
        if (prop.enum) {
          const enumValues = prop.enum as unknown[];
          expect(enumValues.length).toBeGreaterThan(0);
          for (const v of enumValues) {
            expect(typeof v).toBe('string');
            expect((v as string).length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

// ─── Array parameter validation ─────────────────────────────────────────────

describe('array parameter schemas', () => {
  it('every array-type property has an items definition', () => {
    for (const tool of AI_TOOLS) {
      const props = tool.function.parameters.properties;
      for (const [key, value] of Object.entries(props)) {
        const prop = value as Record<string, unknown>;
        if (prop.type === 'array') {
          expect(prop.items).toBeDefined();
          if (!prop.items) {
            throw new Error(
              `Array property "${key}" in tool "${tool.function.name}" is missing items definition`
            );
          }
        }
      }
    }
  });

  it('all array properties across tools have the expected item types', () => {
    const arrayProps: { toolName: string; propName: string; itemType: string }[] = [];

    for (const tool of AI_TOOLS) {
      const props = tool.function.parameters.properties;
      for (const [key, value] of Object.entries(props)) {
        const prop = value as Record<string, unknown>;
        if (prop.type === 'array') {
          const items = prop.items as Record<string, unknown>;
          arrayProps.push({
            toolName: tool.function.name,
            propName: key,
            itemType: items.type as string,
          });
        }
      }
    }

    // There should be exactly 8 array properties across all tools
    // deleteClips.clipIds, selectClips.clipIds, cutRangesFromClip.ranges,
    // splitClipAtTimes.times, getFramesAtTimes.times, moveMediaItems.itemIds,
    // selectMediaItems.itemIds, executeBatch.actions
    expect(arrayProps.length).toBe(8);

    // Verify string arrays
    for (const name of ['deleteClips', 'selectClips']) {
      const match = arrayProps.find((a) => a.toolName === name && a.propName === 'clipIds');
      expect(match).toBeDefined();
      expect(match!.itemType).toBe('string');
    }

    // Verify ranges is object array
    const rangesMatch = arrayProps.find(
      (a) => a.toolName === 'cutRangesFromClip' && a.propName === 'ranges'
    );
    expect(rangesMatch).toBeDefined();
    expect(rangesMatch!.itemType).toBe('object');

    // Verify times is number array (getFramesAtTimes and splitClipAtTimes)
    for (const name of ['getFramesAtTimes', 'splitClipAtTimes']) {
      const timesMatch = arrayProps.find(
        (a) => a.toolName === name && a.propName === 'times'
      );
      expect(timesMatch).toBeDefined();
      expect(timesMatch!.itemType).toBe('number');
    }

    // Verify media array properties
    for (const name of ['moveMediaItems', 'selectMediaItems']) {
      const match = arrayProps.find((a) => a.toolName === name && a.propName === 'itemIds');
      expect(match).toBeDefined();
      expect(match!.itemType).toBe('string');
    }

    // Verify batch actions is object array
    const batchMatch = arrayProps.find(
      (a) => a.toolName === 'executeBatch' && a.propName === 'actions'
    );
    expect(batchMatch).toBeDefined();
    expect(batchMatch!.itemType).toBe('object');
  });
});

// ─── Description quality checks ─────────────────────────────────────────────

describe('description quality', () => {
  it('descriptions are at least 10 characters long (meaningful)', () => {
    for (const tool of AI_TOOLS) {
      expect(tool.function.description.length).toBeGreaterThanOrEqual(10);
    }
  });

  it('descriptions end with a period or closing parenthesis', () => {
    for (const tool of AI_TOOLS) {
      const desc = tool.function.description;
      const lastChar = desc[desc.length - 1];
      expect(lastChar === '.' || lastChar === ')').toBe(true);
    }
  });

  it('descriptions do not contain consecutive spaces', () => {
    for (const tool of AI_TOOLS) {
      expect(tool.function.description).not.toMatch(/  /);
    }
  });

  it('property descriptions are non-empty strings', () => {
    for (const tool of AI_TOOLS) {
      const props = tool.function.parameters.properties;
      for (const [, value] of Object.entries(props)) {
        const prop = value as Record<string, unknown>;
        expect(typeof prop.description).toBe('string');
        expect((prop.description as string).length).toBeGreaterThan(0);
      }
    }
  });
});

// ─── ToolDefinition type structural compliance ──────────────────────────────

describe('ToolDefinition type compliance', () => {
  it('every tool satisfies the ToolDefinition interface shape', () => {
    for (const tool of AI_TOOLS) {
      // Check top-level shape
      const td = tool as ToolDefinition;
      expect(td.type).toBe('function');
      expect(typeof td.function).toBe('object');
      expect(typeof td.function.name).toBe('string');
      expect(typeof td.function.description).toBe('string');
      expect(typeof td.function.parameters).toBe('object');
      expect(td.function.parameters.type).toBe('object');
      expect(typeof td.function.parameters.properties).toBe('object');
      expect(Array.isArray(td.function.parameters.required)).toBe(true);
    }
  });

  it('tools have exactly the expected top-level keys (type, function)', () => {
    for (const tool of AI_TOOLS) {
      const keys = Object.keys(tool);
      expect(keys).toHaveLength(2);
      expect(keys).toContain('type');
      expect(keys).toContain('function');
    }
  });

  it('function objects have exactly the expected keys (name, description, parameters)', () => {
    for (const tool of AI_TOOLS) {
      const keys = Object.keys(tool.function);
      expect(keys).toHaveLength(3);
      expect(keys).toContain('name');
      expect(keys).toContain('description');
      expect(keys).toContain('parameters');
    }
  });

  it('parameters objects have exactly the expected keys (type, properties, required)', () => {
    for (const tool of AI_TOOLS) {
      const keys = Object.keys(tool.function.parameters);
      expect(keys).toHaveLength(3);
      expect(keys).toContain('type');
      expect(keys).toContain('properties');
      expect(keys).toContain('required');
    }
  });
});
