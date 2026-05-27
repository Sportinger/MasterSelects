import { describe, expect, it } from 'vitest';

import {
  TIMELINE_TOOL_DEFINITION_BY_ID,
  TIMELINE_TOOL_DEFINITIONS,
  TIMELINE_TOOL_GROUPS,
} from '../../src/components/timeline/tools/registry';
import {
  TIMELINE_TOOL_GROUP_BY_ID,
  TIMELINE_TOOL_IDS,
} from '../../src/stores/timeline/toolDefaults';

describe('timeline tool registry', () => {
  it('defines every timeline tool exactly once with icon, group, kind, and mutability', () => {
    const definitionIds = TIMELINE_TOOL_DEFINITIONS.map((definition) => definition.id);

    expect(new Set(definitionIds).size).toBe(TIMELINE_TOOL_IDS.length);
    expect(definitionIds.toSorted()).toEqual([...TIMELINE_TOOL_IDS].toSorted());

    for (const definition of TIMELINE_TOOL_DEFINITIONS) {
      expect(definition.icon).toBeTruthy();
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.groupId).toBe(TIMELINE_TOOL_GROUP_BY_ID[definition.id]);
      expect(['mode', 'command']).toContain(definition.kind);
      expect(definition.mutatesTimeline).toBeTypeOf('boolean');
    }
  });

  it('keeps group tool lists in registry order and points at existing definitions', () => {
    const groupedToolIds = TIMELINE_TOOL_GROUPS.flatMap((group) => group.tools);

    expect(new Set(groupedToolIds).size).toBe(TIMELINE_TOOL_IDS.length);
    expect(groupedToolIds.toSorted()).toEqual([...TIMELINE_TOOL_IDS].toSorted());

    for (const group of TIMELINE_TOOL_GROUPS) {
      expect(group.icon).toBeTruthy();
      expect(group.tools).toContain(group.defaultToolId);

      for (const toolId of group.tools) {
        const definition = TIMELINE_TOOL_DEFINITION_BY_ID[toolId];
        expect(definition).toBeDefined();
        expect(definition.groupId).toBe(group.id);
      }
    }
  });
});
