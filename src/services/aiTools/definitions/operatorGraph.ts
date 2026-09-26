import type { ToolDefinition } from '../types';

const id = { type: 'string', minLength: 1, maxLength: 200 };
/** Node IDs start with a letter and use letters, digits, _ and - (no dots); `@compound-<id>` handles are accepted. */
const nodeRef = { type: 'string', minLength: 1, maxLength: 200, pattern: '^@?[A-Za-z0-9_-]+$' };
/** `node` or `node.port`; the last dot separates the port. */
const sourceRef = { type: 'string', minLength: 1, maxLength: 200 };
const value = { anyOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'string' }, { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 4 }] };
const position = { type: 'object', additionalProperties: false, properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] };
export const operatorGraphToolDefinitions: ToolDefinition[] = [
  { type: 'function', function: { name: 'createImageNodeGraph',
    description: 'Create an editable image operator graph on an existing clip. Starts as neutral image.frame -> image.output. Returns effectId, sourceNodeId and outputNodeId. Compose registered operators with editOperatorGraph; no UI interaction or second AI is needed.',
    parameters: { type: 'object', additionalProperties: false, properties: { clipId: id, name: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['clipId'] } } },
  { type: 'function', function: { name: 'getOperatorGraph',
    description: 'Read current node state. With only clipId, list editable effect graph owners. With effectId, return current local nodes, typed ports, values, connections and incomplete status. Optionally limit to nodeIds and neighbor hops, following upstream/downstream/both. Boundary edges remain visible; nodes outside the requested area are omitted. Supports editable visual effects and audio-math.',
    parameters: { type: 'object', additionalProperties: false, properties: { clipId: id, effectId: id,
      nodeIds: { type: 'array', minItems: 1, uniqueItems: true, items: nodeRef },
      hops: { type: 'integer', minimum: 0 },
      direction: { type: 'string', enum: ['upstream', 'downstream', 'both'] },
    }, required: ['clipId'] } } },
  { type: 'function', function: { name: 'editOperatorGraph',
    description: 'Perform ONE undoable atomic edit in an effect-owned operator graph. Build in dataflow order: '
      + 'add each node together with its wiring and values, so it only references nodes that already exist. '
      + 'add uses operatorId from the supplied node catalog and returns nodeId, connected cables and openInputs; optional inputs wires sources into the new node in the same step, '
      + 'either as { targetPortId: "sourceNodeId" | "sourceNodeId.outputPortId" } or as an ordered list of sources that fill the first free compatible inputs; '
      + 'a source port may be omitted when the source has one output or exactly one output fits. params sets parameter values ({ value: 0.2 }); min, max, step (and label) configure a values.number/integer slider. '
      + 'Without position, a node with inputs is placed right of its sources. The whole add changes nothing when any part fails. '
      + 'set uses nodeId, parameter and value; connect uses fromNodeId/toNodeId (fromPortId/toPortId optional with the same inference; a missing toPortId takes the first free compatible input) and replaces an existing single-input cable, for later rewiring and feedback; '
      + 'disconnect uses edgeId; remove and move use nodeId; slider configures a values.number/integer node with label, min, max, step (for an exposed node it sets the Effects tab row range); '
      + 'group with nodeIds (nodes or compound nodes of this graph) and label wraps them in a named, collapsible stage frame (for example one frame per build step); it does not change the processing; '
      + 'expose with nodeId and exposed true/false toggles whether a values.number/integer node appears as a keyframeable parameter row (optional label) in the clip Effects tab, and its keyframes then drive the node output; add with exposed true exposes the new value node immediately. '
      + 'Explicit caller-chosen nodeId is optional for add (start with a letter; only letters, digits, _ and -, no dots), allowing streamed later references; this includes compound nodes, whose public input/output port IDs (from getNodeDefinitions) are used directly with the compound nodeId. '
      + 'Intermediate incomplete wiring is saved and paused until repaired; inspect incomplete in results. Existing tools remain available.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      clipId: id, effectId: id, action: { type: 'string', enum: ['add', 'set', 'connect', 'disconnect', 'remove', 'move', 'slider', 'expose', 'group'] },
      exposed: { type: 'boolean' },
      nodeId: nodeRef, nodeIds: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: nodeRef }, operatorId: id, parameter: id,
      value,
      position, fromNodeId: nodeRef, fromPortId: id, toNodeId: nodeRef, toPortId: id, edgeId: id,
      label: { type: 'string', minLength: 1, maxLength: 80 }, min: { type: 'number' }, max: { type: 'number' }, step: { type: 'number', exclusiveMinimum: 0 },
      inputs: { anyOf: [
        { type: 'object', minProperties: 1, maxProperties: 16, additionalProperties: sourceRef },
        { type: 'array', minItems: 1, maxItems: 16, items: sourceRef },
      ] },
      params: { type: 'object', additionalProperties: value },
    }, required: ['clipId', 'effectId', 'action'] } } },
];
