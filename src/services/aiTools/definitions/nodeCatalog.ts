import type { ToolDefinition } from '../types';

export const nodeCatalogToolDefinitions: ToolDefinition[] = [
  { type: 'function', function: {
    name: 'focusNodeGraph',
    description: 'Select an existing timeline clip and pin a Nodes panel to its general graph beside Preview. This panel keeps showing the clip when selection changes. Reuses an unassigned or matching panel; preserves panels assigned to other clips and detached windows. Keeps a separately docked AI Studio visible. Requires the editor and a docked Preview. Does not create clips or nodes.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      clipId: { type: 'string', minLength: 1, maxLength: 200, description: 'Existing clip in the active timeline that owns the graph.' },
    }, required: ['clipId'] },
  } },
  { type: 'function', function: {
    name: 'searchNodeCatalog',
    description: 'Search registered nodes and visual/audio effects by ID, name, description or signal type. The complete compact base inventory is already in editorNodeCatalog at turn start. Returns paginated summaries; getNodeDefinitions reads exact contracts for selected IDs. Availability depends on the graph owner; signal-type filters do not validate a connection.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      query: { type: 'string', maxLength: 200, description: 'Case-insensitive search terms; all terms must match. Omit to browse.' },
      kind: { type: 'string', enum: ['operator', 'effect', 'audio-effect', 'flock', 'control', 'color', 'builtin'] },
      context: { type: 'string', maxLength: 100, description: 'Substring of the owning context, e.g. Audio or Parameter sources.' },
      inputType: { type: 'string', maxLength: 80 }, outputType: { type: 'string', maxLength: 80 },
      offset: { type: 'integer', minimum: 0, description: 'Pagination offset. Default 0.' },
      limit: { type: 'integer', minimum: 1, description: 'Maximum results. Default 12.' },
    }, required: [] },
  } },
  { type: 'function', function: {
    name: 'getNodeDefinitions',
    description: 'Read public authoring contracts for exact node/effect catalog IDs: underlying type IDs, owner contexts, ports, parameter defaults, bounds and choices. Missing IDs are reported. Does not create nodes or establish connection compatibility. Built-in clip stages have source-dependent contracts.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      ids: { type: 'array', minItems: 1, uniqueItems: true,
        items: { type: 'string', minLength: 1, maxLength: 160 }, description: 'Exact IDs from editorNodeCatalog or searchNodeCatalog.' },
    }, required: ['ids'] },
  } },
];
