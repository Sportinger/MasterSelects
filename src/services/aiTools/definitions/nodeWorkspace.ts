import type { ToolDefinition } from '../types';

export const nodeWorkspaceToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getNodeWorkspaceDebugState',
      description: 'Inspect clip node graphs and AI node authoring/debug state. Returns custom nodes, conversations, active generated code, exposed params, graph links, and optionally the full AI authoring context.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'Optional clip ID. If omitted, returns clips that have AI/custom nodes.' },
          nodeId: { type: 'string', description: 'Optional AI/custom node ID to focus authoring context on.' },
          includeGraph: { type: 'boolean', description: 'Include projected graph nodes and edges. Default true.' },
          includeAuthoringContext: { type: 'boolean', description: 'Include the full prompt context sent to the AI for matching node(s). Default false.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sendAINodePrompt',
      description: 'Send a prompt to an AI custom node using the configured AI provider. Updates the node conversation and activates generated code when the AI returns an activate_code block.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'Clip ID containing the AI node. If omitted, uses the selected clip when possible.' },
          nodeId: { type: 'string', description: 'AI/custom node ID. If omitted, uses the first AI node on the clip.' },
          prompt: { type: 'string', description: 'Message to send to the AI node.' },
        },
        required: ['prompt'],
      },
    },
  },
];
