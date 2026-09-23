import type { ToolDefinition } from '../types';

const id = { type: 'string', minLength: 1, maxLength: 200 };
const position = { type: 'object', additionalProperties: false, properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] };
export const operatorGraphToolDefinitions: ToolDefinition[] = [
  { type: 'function', function: { name: 'createImageNodeGraph',
    description: 'Create an editable image operator graph on an existing clip. Starts as neutral image.frame -> image.output. Returns effectId, sourceNodeId and outputNodeId. Compose registered operators with editOperatorGraph; no UI interaction or second AI is needed.',
    parameters: { type: 'object', additionalProperties: false, properties: { clipId: id, name: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['clipId'] } } },
  { type: 'function', function: { name: 'getOperatorGraph',
    description: 'Read current node state. With only clipId, list editable effect graph owners. With effectId, return current local nodes, typed ports, values, connections and incomplete status. Optionally limit to nodeIds and up to 4 neighbor hops, following upstream/downstream/both. Boundary edges remain visible; nodes outside the requested area are omitted. Supports editable visual effects and audio-math.',
    parameters: { type: 'object', additionalProperties: false, properties: { clipId: id, effectId: id,
      nodeIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: id },
      hops: { type: 'integer', minimum: 0, maximum: 4 },
      direction: { type: 'string', enum: ['upstream', 'downstream', 'both'] },
    }, required: ['clipId'] } } },
  { type: 'function', function: { name: 'editOperatorGraph',
    description: 'Perform ONE undoable atomic edit in an effect-owned operator graph. add uses operatorId from the supplied node catalog and returns nodeId; set uses nodeId, parameter and value; connect uses fromNodeId/fromPortId/toNodeId/toPortId and replaces an existing single-input cable; disconnect uses edgeId; remove and move use nodeId; slider configures a local values.number/integer node with label, min, max, step. Explicit caller-chosen nodeId is optional for add, allowing streamed later references. Intermediate incomplete wiring is saved and paused until repaired; inspect incomplete in results. Existing tools remain available.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      clipId: id, effectId: id, action: { type: 'string', enum: ['add', 'set', 'connect', 'disconnect', 'remove', 'move', 'slider'] },
      nodeId: id, operatorId: id, parameter: id,
      value: { anyOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'string' }, { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 4 }] },
      position, fromNodeId: id, fromPortId: id, toNodeId: id, toPortId: id, edgeId: id,
      label: { type: 'string', minLength: 1, maxLength: 80 }, min: { type: 'number' }, max: { type: 'number' }, step: { type: 'number', exclusiveMinimum: 0 },
    }, required: ['clipId', 'effectId', 'action'] } } },
];
