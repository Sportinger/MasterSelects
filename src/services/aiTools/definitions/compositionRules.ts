import type { ToolDefinition } from '../types';

const id = { type: 'string', minLength: 1, maxLength: 500 };
const ids = { type: 'array', items: id, minItems: 1, maxItems: 1000, uniqueItems: true };
const source = {
  oneOf: [
    { type: 'object', additionalProperties: false, properties: { kind: { const: 'tempo-map' } }, required: ['kind'] },
    { type: 'object', additionalProperties: false, properties: {
      kind: { const: 'clip-beat-grid' }, clipId: id, provenance: { type: 'string', enum: ['source', 'processed'] },
    }, required: ['kind', 'clipId', 'provenance'] },
  ],
};
const params = {
  type: 'object', additionalProperties: false, minProperties: 1,
  properties: {
    firstBeat: { type: 'integer', minimum: 0 }, beatStep: { type: 'integer', minimum: 1 },
    offset: { type: 'number' }, targetTrackId: id,
  },
};

export const compositionRuleToolDefinitions: ToolDefinition[] = [
  { type: 'function', function: { name: 'startClipBeatAnalysis',
    description: 'Start background beat/onset analysis for an audio clip or the linked audio of a video clip. Returns requested and analyzed clip IDs plus existing beat-grid IDs without waiting for completion. Poll getCompositionGraph for beatGrid availability and progress on analyzedClipId. The analysis action reuses available artifacts unless force is true.',
    parameters: { type: 'object', additionalProperties: false,
      properties: { clipId: id, force: { type: 'boolean' } }, required: ['clipId'] } } },
  { type: 'function', function: { name: 'getCompositionGraph',
    description: 'Read a bounded level-0 projection of the active composition: tracks, clips, media, transitions and beat rules. Never creates graph or transition state. Filters use timeline seconds; truncation reports omitted records and rule members.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      trackIds: ids,
      timeRange: { type: 'object', additionalProperties: false,
        properties: { start: { type: 'number', minimum: 0 }, end: { type: 'number', minimum: 0 } }, required: ['start', 'end'] },
      limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
    }, required: [] } } },
  { type: 'function', function: { name: 'createBeatRule',
    description: 'Atomically distribute ordered existing clips on beats and persist one beat rule. Uses the tempo map or an existing clip beat artifact; returns structured conflicts without partial clip edits.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      clipIds: ids, source, params, label: { type: 'string', minLength: 1, maxLength: 200 },
    }, required: ['clipIds', 'source'] } } },
  { type: 'function', function: { name: 'updateBeatRule',
    description: 'Apply exactly one beat-rule change atomically: params patch, complete memberOrder, source replacement, refreshSource:true, or resetCorrection member ID. Existing clip IDs and other member corrections are preserved.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      ruleId: id, params, memberOrder: ids, source, refreshSource: { type: 'boolean', const: true }, resetCorrection: id,
    }, required: ['ruleId'],
    // Keep the exclusive alternatives in the schema as well as runtime validation.
    ...{ oneOf: ['params', 'memberOrder', 'source', 'refreshSource', 'resetCorrection'].map(key => ({ required: [key] })) },
    } } },
  { type: 'function', function: { name: 'releaseBeatRuleMember',
    description: 'Release one stable member from a beat rule in one undo step, preserving all current clip values. Multi-member release is not supported by this atomic action.',
    parameters: { type: 'object', additionalProperties: false,
      properties: { ruleId: id, memberId: id }, required: ['ruleId', 'memberId'] } } },
  { type: 'function', function: { name: 'materializeBeatRule',
    description: 'Remove a beat rule and keep its clips at their current values as ordinary clips. Undo restores the rule.',
    parameters: { type: 'object', additionalProperties: false, properties: { ruleId: id }, required: ['ruleId'] } } },
];
