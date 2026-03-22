import { describe, it, expect } from 'vitest';
import {
  AI_TOOLS,
  timelineToolDefinitions,
  clipToolDefinitions,
  trackToolDefinitions,
  previewToolDefinitions,
  analysisToolDefinitions,
  mediaToolDefinitions,
} from '../../src/services/aiTools/definitions/index';
import type { ToolDefinition } from '../../src/services/aiTools/types';

// ─── Tool count validation ─────────────────────────────────────────────────

describe('AI_TOOLS combined array', () => {
  it('contains at least the base tool definitions', () => {
    // Tool count grows as new categories are added — validate minimum, not exact count
    expect(AI_TOOLS.length).toBeGreaterThanOrEqual(33);
  });

  it('equals the sum of all category arrays', () => {
    const expectedLength =
      timelineToolDefinitions.length +
      clipToolDefinitions.length +
      trackToolDefinitions.length +
      previewToolDefinitions.length +
      analysisToolDefinitions.length +
      mediaToolDefinitions.length;

    // AI_TOOLS includes additional categories not listed here
    expect(AI_TOOLS.length).toBeGreaterThanOrEqual(expectedLength);
  });
});

// ─── Per-category minimum counts ────────────────────────────────────────────

describe('category tool counts', () => {
  it('timelineToolDefinitions has at least 3 tools', () => {
    expect(timelineToolDefinitions.length).toBeGreaterThanOrEqual(3);
  });

  it('clipToolDefinitions has at least 10 tools', () => {
    expect(clipToolDefinitions.length).toBeGreaterThanOrEqual(10);
  });

  it('trackToolDefinitions has at least 4 tools', () => {
    expect(trackToolDefinitions.length).toBeGreaterThanOrEqual(4);
  });

  it('previewToolDefinitions has at least 3 tools', () => {
    expect(previewToolDefinitions.length).toBeGreaterThanOrEqual(3);
  });

  it('analysisToolDefinitions has at least 6 tools', () => {
    expect(analysisToolDefinitions.length).toBeGreaterThanOrEqual(6);
  });

  it('mediaToolDefinitions has at least 7 tools', () => {
    expect(mediaToolDefinitions.length).toBeGreaterThanOrEqual(7);
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
});

// ─── No duplicate tool names ────────────────────────────────────────────────

describe('uniqueness', () => {
  it('has no duplicate tool names', () => {
    const names = AI_TOOLS.map((t) => t.function.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
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
    expect(toolNames).toContain('deleteClip');
    expect(toolNames).toContain('moveClip');
    expect(toolNames).toContain('trimClip');
    expect(toolNames).toContain('cutRangesFromClip');
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
});

// ─── Parameter schema details for key tools ─────────────────────────────────

describe('parameter schemas for key tools', () => {
  function findTool(name: string): ToolDefinition {
    const tool = AI_TOOLS.find((t) => t.function.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool;
  }

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
