import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useAccountStore } from '../../../stores/accountStore';
import {
  buildAINodeAuthoringContext,
  extractAINodeGeneratedCode,
  extractAINodeParameterSchemaFromCode,
  mergeAINodeParamDefaults,
} from '../../../services/nodeGraph';
import type { NodeGraphLayout, NodeGraphNode, NodeGraphPort } from '../../../services/nodeGraph';
import { EFFECT_REGISTRY, getCategoriesWithEffects } from '../../../effects';
import type { EffectParam } from '../../../effects';
import { useDockStore } from '../../../stores/dockStore';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { useTimelineStore } from '../../../stores/timeline';
import { useSettingsStore } from '../../../stores/settingsStore';
import { cloudAiService } from '../../../services/cloudAiService';
import {
  createLemonadeChatCompletionStream,
  DEFAULT_LEMONADE_ENDPOINT,
  DEFAULT_LEMONADE_MODEL,
  type LemonadeMessage,
} from '../../../services/lemonadeProvider';
import { createEffectProperty, createNodeGraphParamProperty } from '../../../types';
import type {
  AnimatableProperty,
  BlendMode,
  ClipCustomNodeConversationKind,
  ClipCustomNodeConversationMessage,
  ClipCustomNodeDefinition,
  ClipCustomNodeParamDefinition,
  ClipCustomNodeParamValue,
  Effect,
  TimelineClip,
  TimelineTrack,
} from '../../../types';
import { EditableDraggableNumber as DraggableNumber } from '../../common/EditableDraggableNumber';
import { KeyframeToggle, MultiKeyframeToggle } from '../properties/shared';
import { BLEND_MODE_GROUPS, formatBlendModeName } from '../properties/sharedConstants';
import { handleSubmenuHover, handleSubmenuLeave } from '../media/submenuPosition';
import { NodeGraphCanvas } from './NodeGraphCanvas';
import { useNodeGraphSubject } from './useNodeGraphSubject';
import './NodeWorkspacePanel.css';
import { hexColorToRgb, normalizeHexColor } from '../../../utils/colorParam';

const CLIP_SPEED_MIN_PERCENT = -10000;
const CLIP_SPEED_MAX_PERCENT = 10000;
const AI_NODE_OPENAI_MODEL = 'gpt-5.1';
const AI_NODE_MAX_TOKENS = 100_000;
const AI_NODE_TIMEOUT_MS = 90_000;
const AI_NODE_STREAM_IDLE_TIMEOUT_MS = 20_000;
const AI_NODE_MAX_CONVERSATION_MESSAGES = 10;
const AI_NODE_MAX_STORED_CONVERSATION_MESSAGES = 48;
const AI_NODE_CONTEXT_MAX_CHARS = 12_000;
const AI_NODE_CONVERSATION_MESSAGE_MAX_CHARS = 2_000;
const AI_NODE_SUMMARY_MAX_CHARS = 2_400;
const NODE_WORKSPACE_INSPECTOR_WIDTH_KEY = 'masterselects.nodeWorkspace.inspectorWidth';
const NODE_WORKSPACE_INSPECTOR_DEFAULT_WIDTH = 320;
const NODE_WORKSPACE_INSPECTOR_MIN_WIDTH = 280;
const NODE_WORKSPACE_INSPECTOR_MAX_WIDTH = 760;

interface NodeWorkspaceContextMenuState {
  x: number;
  y: number;
  layout: NodeGraphLayout;
  nodeId?: string | null;
}

interface AINodeProjectContext {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
}

function clampNodeWorkspaceInspectorWidth(width: number, panelWidth?: number): number {
  const maxForPanel = panelWidth
    ? Math.max(NODE_WORKSPACE_INSPECTOR_MIN_WIDTH, Math.min(NODE_WORKSPACE_INSPECTOR_MAX_WIDTH, panelWidth - 260))
    : NODE_WORKSPACE_INSPECTOR_MAX_WIDTH;
  return Math.min(maxForPanel, Math.max(NODE_WORKSPACE_INSPECTOR_MIN_WIDTH, width));
}

type NodeAIGenerationAccess =
  | {
      kind: 'hosted';
      label: 'Cloud';
    }
  | {
      apiKey: string;
      kind: 'openai';
      label: 'OpenAI key';
    }
  | {
      endpoint: string;
      kind: 'lemonade';
      label: 'Local';
      model: string;
    }
  | {
      kind: 'none';
      label: 'No AI';
    };

function formatParamValue(value: string | number | boolean): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
  }
  return String(value);
}

function clampAINodeNumber(value: number, param: ClipCustomNodeParamDefinition): number {
  return Math.min(param.max ?? Number.POSITIVE_INFINITY, Math.max(param.min ?? Number.NEGATIVE_INFINITY, value));
}

function getAINodeNumberDecimals(param: ClipCustomNodeParamDefinition): number {
  return param.step && param.step >= 1 ? 0 : param.step && param.step >= 0.1 ? 1 : 2;
}

function getAINodeParamValue(
  definition: ClipCustomNodeDefinition,
  param: ClipCustomNodeParamDefinition,
  interpolatedParams?: Record<string, ClipCustomNodeParamValue>,
): ClipCustomNodeParamValue {
  return interpolatedParams?.[param.id] ?? definition.params?.[param.id] ?? param.default;
}

function coerceAINodeParamValue(value: string, param: ClipCustomNodeParamDefinition): ClipCustomNodeParamValue {
  if (param.type === 'number') {
    return clampAINodeNumber(Number(value) || 0, param);
  }
  if (param.type === 'boolean') {
    return value === 'true';
  }
  if (param.type === 'color') {
    return normalizeHexColor(value, String(param.default));
  }
  const matchingOption = param.options?.find((option) => String(option.value) === value);
  return matchingOption?.value ?? value;
}

function isForcedBuiltInNode(nodeId: string): nodeId is 'transform' | 'mask' | 'color' {
  return nodeId === 'transform' || nodeId === 'mask' || nodeId === 'color';
}

function canDeleteNodeFromClip(clip: TimelineClip, node: NodeGraphNode | null | undefined): boolean {
  if (!node) return false;
  if (node.kind === 'custom' || node.kind === 'effect') {
    return true;
  }
  if (isForcedBuiltInNode(node.id)) {
    return clip.nodeGraph?.forcedBuiltIns?.includes(node.id) ?? false;
  }
  return false;
}

function extractGeneratedNodeCode(value: string): string | null {
  return extractAINodeGeneratedCode(value);
}

function createAssistantChatContent(response: string, generatedCode: string | null): string {
  if (!generatedCode) {
    return response;
  }

  const responseWithoutCode = response
    .replace(/<activate[_-](?:node[_-])?code>\s*[\s\S]*?\s*<\/activate[_-](?:node[_-])?code>/gi, '')
    .replace(/```(?:ts|tsx|typescript|js|javascript)?\s*[\s\S]*?defineNode\s*\([\s\S]*?```/gi, '')
    .trim();
  if (!responseWithoutCode || response.trim().startsWith('defineNode')) {
    return 'Activated code.';
  }
  return responseWithoutCode;
}

function parseAITextPayload(data: unknown): string {
  const payload = data as {
    choices?: Array<{
      finish_reason?: string | null;
      message?: {
        content?: string | null;
      };
    }>;
  };
  const choice = payload.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw new Error(`AI response hit the ${AI_NODE_MAX_TOKENS} token output cap before finishing. Ask for a smaller node or simplify the generated code.`);
  }
  return (choice?.message?.content ?? '').trim();
}

function truncateForAI(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n[truncated ${value.length - maxLength} chars]`;
}

function createConversationMessage(
  role: ClipCustomNodeConversationMessage['role'],
  kind: ClipCustomNodeConversationKind,
  content: string,
): ClipCustomNodeConversationMessage {
  return {
    id: `node-ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    kind,
    content,
    createdAt: Date.now(),
  };
}

function appendConversationTurn(
  definition: ClipCustomNodeDefinition,
  userPrompt: string,
  assistantResponse: string,
  kind: ClipCustomNodeConversationKind,
): {
  conversation: ClipCustomNodeConversationMessage[];
  conversationSummary: string;
} {
  const nextConversation = [
    ...(definition.ai.conversation ?? []),
    createConversationMessage('user', 'message', userPrompt),
    createConversationMessage('assistant', kind, assistantResponse),
  ].slice(-AI_NODE_MAX_STORED_CONVERSATION_MESSAGES);
  const summaryLine = [
    `${kind}:`,
    `user=${truncateForAI(userPrompt.replace(/\s+/g, ' '), 180)}`,
    `assistant=${truncateForAI(assistantResponse.replace(/\s+/g, ' '), 260)}`,
  ].join(' ');

  return {
    conversation: nextConversation,
    conversationSummary: truncateForAI(
      [definition.ai.conversationSummary, summaryLine].filter(Boolean).join('\n'),
      AI_NODE_SUMMARY_MAX_CHARS,
    ),
  };
}

function buildAINodeMessages(
  clip: TimelineClip,
  definition: ClipCustomNodeDefinition,
  projectContext: AINodeProjectContext,
): LemonadeMessage[] {
  const authoringContext = buildAINodeAuthoringContext(clip, definition, projectContext);
  const recentConversation = (definition.ai.conversation ?? [])
    .slice(-AI_NODE_MAX_CONVERSATION_MESSAGES)
    .map<LemonadeMessage>((message) => ({
      role: message.role,
      content: `[node memory:${message.kind}] ${truncateForAI(message.content, AI_NODE_CONVERSATION_MESSAGE_MAX_CHARS)}`,
    }));

  return [
    {
      role: 'system',
      content: [
        'You are the authoring agent for one MasterSelects custom node.',
        'Use the supplied authoring context, graph links, direct connections, node memory, saved plan, and current user request.',
        'Current runtime capabilities override stale node memory and older assistant replies.',
        'If node memory says color params are unsupported, ignore that stale statement: color params are supported now.',
        'Decide what is appropriate:',
        '- If the user is exploring, unclear, or asking for a plan, respond with a concise plan/question in normal text.',
        '- If the user asks for behavior that is implementable from the available node inputs and you are ready to change the live node, use the activate_code tool.',
        'Virtual tool syntax:',
        '<activate_code>',
        'defineNode({ name, inputs, outputs, params, process(input, context) { ... } })',
        '</activate_code>',
        'Do not put planning text inside the activate_code block. Only use it for code that should become the active node code now.',
        'Code must be plain JavaScript with this shape: defineNode({ name, inputs, outputs, params, process(input, context) { ... } }).',
        'Expose user-adjustable values in params, e.g. [{ id: "amount", label: "Amount", type: "number", default: 0.5, min: 0, max: 1, step: 0.01 }].',
        'Supported param types are number, boolean, string, select, and color.',
        'Color params must use a hex string default like "#008cff"; read them from context.params as "#rrggbb" strings. The UI keyframes color params through internal RGB channels.',
        'Read exposed parameter values from context.params or input.params inside process.',
        'input.time is a time object with currentTime/clipLocalTime/seconds and also behaves like a number in numeric expressions.',
        'input.input is a pixel texture { data, width, height }; for text sources, read current text data from input.text, input.metadata.text, or context.text.',
        'For text sources, context.text includes content, typography, color, spacing, text box dimensions, contentBounds, layout.lines, and layout.characters with per-character pixel boxes.',
        'Each layout character has char, index, lineIndex, rect=[x,y,width,height], left, top, right, bottom, x, y, width, and height.',
        'For text write-on, line reveals, or per-line masks, use context.text.layout.lines / input.metadata.text.layout.lines; never divide canvas height into guessed equal lines.',
        'For single-letter effects such as blinking every "g", filter context.text.layout.characters by char and edit output.data inside those rectangles; do not guess character positions.',
        'For whole-text animation/editing, return output.text or top-level text as a patch, e.g. { content, text, color, fontSize, letterSpacing }, to rerender text without editing pixels.',
        'Runtime code must be pure and deterministic: no network, no DOM, no randomness, no wall-clock time.',
        'If implementation is impossible from available signals, explain what input or connection is missing instead of inventing it.',
        'For discussion, return normal chat text. For implementation, return the activate_code tool block.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        truncateForAI(authoringContext, AI_NODE_CONTEXT_MAX_CHARS),
      ].join('\n'),
    },
    ...recentConversation,
    {
      role: 'user',
      content: [
        'Current user request:',
        definition.ai.prompt.trim(),
        '',
        'Respond now. Either chat/plan briefly, or use activate_code when code should go live now.',
      ].join('\n'),
    },
  ];
}

async function generateAINodeResponse(
  clip: TimelineClip,
  definition: ClipCustomNodeDefinition,
  access: NodeAIGenerationAccess,
  projectContext: AINodeProjectContext,
): Promise<string> {
  const messages = buildAINodeMessages(clip, definition, projectContext);

  if (access.kind === 'lemonade') {
    const result = await createLemonadeChatCompletionStream({
      endpoint: access.endpoint,
      model: access.model,
      messages,
      maxTokens: AI_NODE_MAX_TOKENS,
      streamIdleTimeoutMs: AI_NODE_STREAM_IDLE_TIMEOUT_MS,
      timeoutMs: AI_NODE_TIMEOUT_MS,
    });
    return (result.content ?? '').trim();
  }

  const requestBody: Record<string, unknown> = {
    model: AI_NODE_OPENAI_MODEL,
    messages,
    max_completion_tokens: AI_NODE_MAX_TOKENS,
  };

  if (access.kind === 'hosted') {
    const response = await cloudAiService.createChatCompletion(requestBody);
    return parseAITextPayload(response);
  }

  if (access.kind === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `AI request failed: ${response.status}`);
    }

    return parseAITextPayload(await response.json());
  }

  throw new Error('No AI provider is configured.');
}

interface NumericParamEditorProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  defaultValue: number;
  decimals?: number;
  suffix?: string;
  min?: number;
  max?: number;
  sensitivity?: number;
  persistenceKey?: string;
  onContextMenu?: () => void;
}

function NumericParamEditor({
  label,
  value,
  onChange,
  defaultValue,
  decimals = 2,
  suffix,
  min,
  max,
  sensitivity = 1,
  persistenceKey,
  onContextMenu,
}: NumericParamEditorProps) {
  return (
    <div
      className="node-workspace-param node-workspace-param-editable"
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onContextMenu();
      }}
    >
      <span>{label}</span>
      <DraggableNumber
        value={value}
        onChange={onChange}
        defaultValue={defaultValue}
        decimals={decimals}
        suffix={suffix}
        min={min}
        max={max}
        sensitivity={sensitivity}
        persistenceKey={persistenceKey}
        onDragStart={() => startBatch('Adjust node parameter')}
        onDragEnd={() => endBatch()}
      />
    </div>
  );
}

function EffectParamEditor({
  clip,
  effect,
  paramName,
  paramDef,
  value,
}: {
  clip: TimelineClip;
  effect: Effect;
  paramName: string;
  paramDef: EffectParam;
  value: number | boolean | string;
}) {
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const updateClipEffect = useTimelineStore((state) => state.updateClipEffect);

  if (paramDef.type === 'number') {
    const min = paramDef.min ?? 0;
    const max = paramDef.max ?? 1;
    const range = max - min;
    const decimals = paramDef.step && paramDef.step >= 1 ? 0 : paramDef.step && paramDef.step >= 0.1 ? 1 : 2;
    const numericValue = typeof value === 'number' ? value : Number(paramDef.default);
    const defaultValue = typeof paramDef.default === 'number' ? paramDef.default : 0;

    return (
      <NumericParamEditor
        label={paramDef.label}
        value={numericValue}
        onChange={(nextValue) => {
          setPropertyValue(clip.id, createEffectProperty(effect.id, paramName) as AnimatableProperty, Math.max(min, nextValue));
        }}
        onContextMenu={() => setPropertyValue(clip.id, createEffectProperty(effect.id, paramName) as AnimatableProperty, defaultValue)}
        defaultValue={defaultValue}
        decimals={decimals}
        min={min}
        max={paramDef.quality ? undefined : max}
        sensitivity={Math.max(0.5, range / 100)}
        persistenceKey={`node.effect.${clip.id}.${effect.id}.${paramName}`}
      />
    );
  }

  if (paramDef.type === 'boolean') {
    const checked = typeof value === 'boolean' ? value : Boolean(paramDef.default);
    return (
      <label className="node-workspace-param node-workspace-param-editable node-workspace-param-checkbox">
        <span>{paramDef.label}</span>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => updateClipEffect(clip.id, effect.id, { [paramName]: event.target.checked })}
        />
      </label>
    );
  }

  if (paramDef.type === 'select') {
    return (
      <label className="node-workspace-param node-workspace-param-editable">
        <span>{paramDef.label}</span>
        <select
          value={String(value ?? paramDef.default)}
          onChange={(event) => updateClipEffect(clip.id, effect.id, { [paramName]: event.target.value })}
        >
          {paramDef.options?.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="node-workspace-param">
      <span>{paramDef.label}</span>
      <strong>{formatParamValue(value)}</strong>
    </div>
  );
}

function EffectNodeParameters({ clip, node }: { clip: TimelineClip; node: NodeGraphNode }) {
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const getInterpolatedEffects = useTimelineStore((state) => state.getInterpolatedEffects);
  const setClipEffectEnabled = useTimelineStore((state) => state.setClipEffectEnabled);
  const effectId = node.id.startsWith('effect-') ? node.id.slice('effect-'.length) : '';
  const effect = clip.effects.find((candidate) => candidate.id === effectId);

  if (!effect) {
    return <div className="node-workspace-inspector-empty">Effect not found</div>;
  }

  const clipLocalTime = playheadPosition - clip.startTime;
  const interpolatedEffect = getInterpolatedEffects(clip.id, clipLocalTime).find((candidate) => candidate.id === effect.id) ?? effect;
  const effectDef = EFFECT_REGISTRY.get(effect.type);
  const params = Object.entries(effectDef?.params ?? {});

  return (
    <div className="node-workspace-param-list">
      <label className="node-workspace-param node-workspace-param-editable node-workspace-param-checkbox">
        <span>Enabled</span>
        <input
          type="checkbox"
          checked={effect.enabled !== false}
          onChange={(event) => setClipEffectEnabled(clip.id, effect.id, event.target.checked)}
        />
      </label>
      {effectDef ? (
        params.length > 0 ? (
          params.map(([paramName, paramDef]) => (
            <EffectParamEditor
              key={paramName}
              clip={clip}
              effect={effect}
              paramName={paramName}
              paramDef={paramDef}
              value={interpolatedEffect.params[paramName] ?? paramDef.default}
            />
          ))
        ) : (
          <div className="node-workspace-inspector-empty">No parameters</div>
        )
      ) : (
        <div className="node-workspace-inspector-empty">Unknown effect type: {effect.type}</div>
      )}
    </div>
  );
}

function AINodeExposedParameters({
  clip,
  definition,
}: {
  clip: TimelineClip;
  definition: ClipCustomNodeDefinition;
}) {
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const getInterpolatedNodeGraphParams = useTimelineStore((state) => state.getInterpolatedNodeGraphParams);
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const updateClipAICustomNode = useTimelineStore((state) => state.updateClipAICustomNode);
  const isRecording = useTimelineStore((state) => state.isRecording);
  const hasKeyframes = useTimelineStore((state) => state.hasKeyframes);
  const schema = definition.parameterSchema ?? [];

  if (schema.length === 0) {
    return null;
  }

  const clipLocalTime = playheadPosition - clip.startTime;
  const interpolatedParams = getInterpolatedNodeGraphParams(clip.id, definition.id, clipLocalTime);
  const updateStaticParam = (paramId: string, value: ClipCustomNodeParamValue) => {
    updateClipAICustomNode(clip.id, definition.id, {
      params: {
        ...(definition.params ?? {}),
        [paramId]: value,
      },
    });
  };

  return (
    <div className="node-workspace-ai-exposed">
      <div className="node-workspace-ai-exposed-title">Parameters</div>
      <div className="node-workspace-ai-exposed-list">
        {schema.map((param) => {
          const value = getAINodeParamValue(definition, param, interpolatedParams);

          if (param.type === 'number') {
            const numericValue = typeof value === 'number' ? value : Number(param.default) || 0;
            const defaultValue = typeof param.default === 'number' ? param.default : 0;
            const property = createNodeGraphParamProperty(definition.id, param.id) as AnimatableProperty;
            const range = (param.max ?? 1) - (param.min ?? 0);

            return (
              <div
                key={param.id}
                className="node-workspace-ai-param-row"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setPropertyValue(clip.id, property, defaultValue);
                }}
              >
                <KeyframeToggle clipId={clip.id} property={property} value={numericValue} />
                <span className="node-workspace-ai-param-label">{param.label}</span>
                <DraggableNumber
                  value={numericValue}
                  onChange={(nextValue) => setPropertyValue(clip.id, property, clampAINodeNumber(nextValue, param))}
                  defaultValue={defaultValue}
                  decimals={getAINodeNumberDecimals(param)}
                  min={param.min}
                  max={param.max}
                  sensitivity={Math.max(0.1, Math.abs(range) / 100)}
                  persistenceKey={`node.ai.${clip.id}.${definition.id}.${param.id}`}
                  onDragStart={() => startBatch('Adjust AI node parameter')}
                  onDragEnd={() => endBatch()}
                />
              </div>
            );
          }

          if (param.type === 'boolean') {
            return (
              <label key={param.id} className="node-workspace-ai-param-row node-workspace-ai-param-row-static">
                <span className="node-workspace-ai-param-spacer" />
                <span className="node-workspace-ai-param-label">{param.label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(event) => updateStaticParam(param.id, event.target.checked)}
                />
              </label>
            );
          }

          if (param.type === 'select') {
            return (
              <label key={param.id} className="node-workspace-ai-param-row node-workspace-ai-param-row-static">
                <span className="node-workspace-ai-param-spacer" />
                <span className="node-workspace-ai-param-label">{param.label}</span>
                <select
                  value={String(value)}
                  onChange={(event) => updateStaticParam(param.id, coerceAINodeParamValue(event.target.value, param))}
                >
                  {param.options?.map((option) => (
                    <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
                  ))}
                </select>
              </label>
            );
          }

          if (param.type === 'color') {
            const colorValue = normalizeHexColor(value, String(param.default));
            const color = hexColorToRgb(colorValue, String(param.default));
            const channelEntries = ([
              ['r', color.r],
              ['g', color.g],
              ['b', color.b],
            ] as const).map(([channel, channelValue]) => ({
              property: createNodeGraphParamProperty(definition.id, `${param.id}.${channel}`) as AnimatableProperty,
              value: channelValue,
            }));
            const isKeyedColor = channelEntries.some(({ property }) => (
              isRecording(clip.id, property) || hasKeyframes(clip.id, property)
            ));
            const updateColor = (nextColor: string) => {
              const normalized = normalizeHexColor(nextColor, colorValue);
              const nextRgb = hexColorToRgb(normalized, colorValue);

              if (isKeyedColor) {
                startBatch('Adjust AI node color');
                try {
                  setPropertyValue(clip.id, channelEntries[0].property, nextRgb.r);
                  setPropertyValue(clip.id, channelEntries[1].property, nextRgb.g);
                  setPropertyValue(clip.id, channelEntries[2].property, nextRgb.b);
                } finally {
                  endBatch();
                }
                return;
              }

              updateStaticParam(param.id, normalized);
            };

            return (
              <label key={param.id} className="node-workspace-ai-param-row node-workspace-ai-param-row-color">
                <MultiKeyframeToggle
                  clipId={clip.id}
                  entries={channelEntries}
                  dragId={`${clip.id}:node:${definition.id}:${param.id}:color`}
                  title="Add color keyframes"
                />
                <span className="node-workspace-ai-param-label">{param.label}</span>
                <span className="node-workspace-ai-color-control">
                  <input
                    type="color"
                    value={colorValue}
                    onChange={(event) => updateColor(event.target.value)}
                  />
                  <span>{colorValue}</span>
                </span>
              </label>
            );
          }

          return (
            <label key={param.id} className="node-workspace-ai-param-row node-workspace-ai-param-row-static">
              <span className="node-workspace-ai-param-spacer" />
              <span className="node-workspace-ai-param-label">{param.label}</span>
              <input
                type="text"
                value={String(value)}
                onChange={(event) => updateStaticParam(param.id, event.target.value)}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

function TransformNodeParameters({ clip }: { clip: TimelineClip }) {
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const updateClipTransform = useTimelineStore((state) => state.updateClipTransform);
  const toggleClipReverse = useTimelineStore((state) => state.toggleClipReverse);

  const setTransformProperty = useCallback((property: AnimatableProperty, value: number) => {
    setPropertyValue(clip.id, property, value);
  }, [clip.id, setPropertyValue]);

  const opacityPct = clip.transform.opacity * 100;
  const speedPct = (clip.speed ?? 1) * 100;
  const scaleXPct = clip.transform.scale.x * 100;
  const scaleYPct = clip.transform.scale.y * 100;
  const reversed = clip.reversed === true;

  return (
    <div className="node-workspace-param-list">
      <NumericParamEditor
        label="Opacity"
        value={opacityPct}
        onChange={(value) => setTransformProperty('opacity', Math.max(0, Math.min(100, value)) / 100)}
        defaultValue={100}
        decimals={1}
        suffix="%"
        min={0}
        max={100}
      />
      <NumericParamEditor
        label="Position X"
        value={clip.transform.position.x}
        onChange={(value) => setTransformProperty('position.x', value)}
        defaultValue={0}
        decimals={3}
        sensitivity={0.2}
      />
      <NumericParamEditor
        label="Position Y"
        value={clip.transform.position.y}
        onChange={(value) => setTransformProperty('position.y', value)}
        defaultValue={0}
        decimals={3}
        sensitivity={0.2}
      />
      <NumericParamEditor
        label="Scale X"
        value={scaleXPct}
        onChange={(value) => setTransformProperty('scale.x', value / 100)}
        defaultValue={100}
        decimals={1}
        suffix="%"
        min={0}
      />
      <NumericParamEditor
        label="Scale Y"
        value={scaleYPct}
        onChange={(value) => setTransformProperty('scale.y', value / 100)}
        defaultValue={100}
        decimals={1}
        suffix="%"
        min={0}
      />
      <NumericParamEditor
        label="Rotation"
        value={clip.transform.rotation.z}
        onChange={(value) => setTransformProperty('rotation.z', value)}
        defaultValue={0}
        decimals={1}
        suffix="deg"
        sensitivity={0.5}
      />
      <NumericParamEditor
        label="Speed"
        value={speedPct}
        onChange={(value) => setTransformProperty('speed', value / 100)}
        defaultValue={100}
        decimals={0}
        suffix="%"
        min={CLIP_SPEED_MIN_PERCENT}
        max={CLIP_SPEED_MAX_PERCENT}
      />
      <label className="node-workspace-param node-workspace-param-editable">
        <span>Blend</span>
        <select
          value={clip.transform.blendMode}
          onChange={(event) => updateClipTransform(clip.id, { blendMode: event.target.value as BlendMode })}
        >
          {BLEND_MODE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.modes.map((mode) => (
                <option key={mode} value={mode}>{formatBlendModeName(mode)}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="node-workspace-param node-workspace-param-editable node-workspace-param-checkbox">
        <span>Reversed</span>
        <input
          type="checkbox"
          checked={reversed}
          onChange={(event) => {
            if (event.target.checked !== reversed) {
              toggleClipReverse(clip.id);
            }
          }}
        />
      </label>
    </div>
  );
}

function PortList({ title, ports }: { title: string; ports: NodeGraphPort[] }) {
  return (
    <div className="node-workspace-inspector-section">
      <div className="node-workspace-inspector-section-title">{title}</div>
      {ports.length > 0 ? (
        <div className="node-workspace-inspector-ports">
          {ports.map((port) => (
            <div key={port.id} className="node-workspace-inspector-port">
              <span>{port.label}</span>
              <span>{port.type}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="node-workspace-inspector-empty">None</div>
      )}
    </div>
  );
}

function AIPortDropdown({ title, ports }: { title: string; ports: NodeGraphPort[] }) {
  return (
    <details className="node-workspace-ai-port-dropdown">
      <summary>
        <span>{title}</span>
        <span>{ports.length}</span>
      </summary>
      <div className="node-workspace-ai-port-list">
        {ports.length > 0 ? ports.map((port) => (
          <div key={port.id} className="node-workspace-ai-port-row">
            <span>{port.label}</span>
            <span>{port.type}</span>
          </div>
        )) : (
          <div className="node-workspace-inspector-empty">None</div>
        )}
      </div>
    </details>
  );
}

function NodeInspectorShell({
  ai = false,
  children,
  width,
  onStartResize,
}: {
  ai?: boolean;
  children: ReactNode;
  width: number;
  onStartResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <aside
      className={`node-workspace-inspector${ai ? ' node-workspace-inspector-ai' : ''}`}
      style={{ width, minWidth: width, maxWidth: 'none' }}
    >
      <div
        className="node-workspace-inspector-resize-handle"
        role="separator"
        aria-orientation="vertical"
        title="Resize inspector"
        onMouseDown={onStartResize}
      />
      {children}
    </aside>
  );
}

function NodeInspector({
  node,
  clip,
  inspectorWidth,
  onSelectNode,
  onOpenProperties,
  onStartResizeInspector,
}: {
  node: NodeGraphNode | null;
  clip: TimelineClip | null;
  inspectorWidth: number;
  onSelectNode: (nodeId: string) => void;
  onOpenProperties: () => void;
  onStartResizeInspector: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const params = Object.entries(node?.params ?? {});
  const canEditTransform = !!clip && node?.id === 'transform';
  const canEditEffect = !!clip && node?.id.startsWith('effect-');
  const canEditCustom = !!clip && node?.kind === 'custom';

  if (!node) {
    return (
      <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
        <div className="node-workspace-inspector-empty">Select a node</div>
      </NodeInspectorShell>
    );
  }

  if (canEditCustom) {
    return (
      <NodeInspectorShell ai width={inspectorWidth} onStartResize={onStartResizeInspector}>
        <CustomNodeParameters clip={clip} node={node} />
      </NodeInspectorShell>
    );
  }

  return (
    <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
      <div className="node-workspace-inspector-header">
        <span>{node.kind}</span>
        <h3>{node.label}</h3>
        <p>{node.description}</p>
      </div>

      <div className="node-workspace-inspector-meta">
        <div>
          <span>Runtime</span>
          <strong>{node.runtime}</strong>
        </div>
        {node.sourceType && (
          <div>
            <span>Source</span>
            <strong>{node.sourceType}</strong>
          </div>
        )}
      </div>

      <PortList title="Inputs" ports={node.inputs} />
      <PortList title="Outputs" ports={node.outputs} />

      <div className="node-workspace-inspector-section">
        <div className="node-workspace-inspector-section-title">Parameters</div>
        {canEditTransform ? (
          <TransformNodeParameters clip={clip} />
        ) : canEditEffect ? (
          <EffectNodeParameters clip={clip} node={node} />
        ) : params.length > 0 ? (
          <div className="node-workspace-param-list">
            {params.map(([key, value]) => (
              <div key={key} className="node-workspace-param">
                <span>{key}</span>
                <strong>{formatParamValue(value)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="node-workspace-inspector-empty">None</div>
        )}
      </div>

      {clip && <ClipNodeActions clip={clip} onSelectNode={onSelectNode} />}

      <button type="button" className="node-workspace-primary-action" onClick={onOpenProperties}>
        Open Properties
      </button>
    </NodeInspectorShell>
  );
}

function CustomNodeParameters({ clip, node }: { clip: TimelineClip; node: NodeGraphNode }) {
  const updateClipAICustomNode = useTimelineStore((state) => state.updateClipAICustomNode);
  const apiKeys = useSettingsStore((state) => state.apiKeys);
  const aiProvider = useSettingsStore((state) => state.aiProvider);
  const lemonadeEndpoint = useSettingsStore((state) => state.lemonadeEndpoint);
  const lemonadeModel = useSettingsStore((state) => state.lemonadeModel);
  const openSettings = useSettingsStore((state) => state.openSettings);
  const hostedAIEnabled = useAccountStore((state) => state.hostedAIEnabled);
  const accountSession = useAccountStore((state) => state.session);
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copiedMessageTimeoutRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (copiedMessageTimeoutRef.current !== null) {
      window.clearTimeout(copiedMessageTimeoutRef.current);
    }
  }, []);

  const copyConversationMessage = useCallback(async (message: ClipCustomNodeConversationMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = message.content;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    setCopiedMessageId(message.id);
    if (copiedMessageTimeoutRef.current !== null) {
      window.clearTimeout(copiedMessageTimeoutRef.current);
    }
    copiedMessageTimeoutRef.current = window.setTimeout(() => {
      setCopiedMessageId(null);
      copiedMessageTimeoutRef.current = null;
    }, 900);
  }, []);
  const definition = clip.nodeGraph?.customNodes?.find((candidate) => candidate.id === node.id);

  if (!definition) {
    return <div className="node-workspace-inspector-empty">Custom node not found</div>;
  }

  const access: NodeAIGenerationAccess = aiProvider === 'lemonade'
    ? {
        endpoint: lemonadeEndpoint || DEFAULT_LEMONADE_ENDPOINT,
        kind: 'lemonade',
        label: 'Local',
        model: lemonadeModel || DEFAULT_LEMONADE_MODEL,
      }
    : accountSession?.authenticated && hostedAIEnabled
      ? { kind: 'hosted', label: 'Cloud' }
      : apiKeys.openai
        ? { apiKey: apiKeys.openai, kind: 'openai', label: 'OpenAI key' }
        : { kind: 'none', label: 'No AI' };
  const canSendPrompt = access.kind !== 'none' && definition.ai.prompt.trim().length > 0 && !isGenerating;
  const conversationCount = definition.ai.conversation?.length ?? 0;

  const sendPromptToAI = async () => {
    if (access.kind === 'none') {
      setGenerationError('No AI provider configured.');
      return;
    }

    if (!definition.ai.prompt.trim() || isGenerating) {
      return;
    }

    setGenerationError(null);
    setIsGenerating(true);
    try {
      const prompt = definition.ai.prompt.trim();
      const response = await generateAINodeResponse(
        clip,
        definition,
        access,
        { clips, tracks },
      );
      if (!response) {
        throw new Error('AI returned an empty response.');
      }
      const generatedCode = extractGeneratedNodeCode(response);
      const assistantChatContent = createAssistantChatContent(response, generatedCode);
      const conversation = appendConversationTurn(definition, prompt, assistantChatContent, generatedCode ? 'code' : 'plan');

      if (!generatedCode) {
        updateClipAICustomNode(clip.id, definition.id, {
          ai: {
            prompt: '',
            plan: response,
            conversation: conversation.conversation,
            conversationSummary: conversation.conversationSummary,
            updatedAt: Date.now(),
          },
        });
        return;
      }

      const parameterSchema = extractAINodeParameterSchemaFromCode(generatedCode);
      updateClipAICustomNode(clip.id, definition.id, {
        status: 'ready',
        parameterSchema,
        params: mergeAINodeParamDefaults(parameterSchema, definition.params),
        ai: {
          prompt: '',
          generatedCode,
          conversation: conversation.conversation,
          conversationSummary: conversation.conversationSummary,
          updatedAt: Date.now(),
        },
      });
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'AI request failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="node-workspace-ai-node-editor">
      <div className="node-workspace-ai-top">
        <label className="node-workspace-field node-workspace-ai-name">
          <span>AI Node</span>
          <input
            value={definition.label}
            onChange={(event) => updateClipAICustomNode(clip.id, definition.id, { label: event.target.value })}
          />
        </label>
        <AIPortDropdown title="Inputs" ports={node.inputs} />
        <AIPortDropdown title="Outputs" ports={node.outputs} />
        <AINodeExposedParameters clip={clip} definition={definition} />
      </div>

      <label className="node-workspace-field node-workspace-ai-code">
        <span>Active Code</span>
        <textarea
          value={definition.ai.generatedCode ?? ''}
          rows={5}
          spellCheck={false}
          onChange={(event) => updateClipAICustomNode(clip.id, definition.id, {
            status: extractGeneratedNodeCode(event.target.value) ? 'ready' : 'draft',
            ai: { generatedCode: event.target.value },
          })}
          onBlur={(event) => {
            const code = event.target.value.trim();
            if (!code) return;
            const generatedCode = extractGeneratedNodeCode(code);
            if (!generatedCode) {
              updateClipAICustomNode(clip.id, definition.id, {
                status: 'draft',
                parameterSchema: [],
                params: {},
              });
              return;
            }
            const parameterSchema = extractAINodeParameterSchemaFromCode(generatedCode);
            updateClipAICustomNode(clip.id, definition.id, {
              status: 'ready',
              parameterSchema,
              params: mergeAINodeParamDefaults(parameterSchema, definition.params),
            });
          }}
        />
      </label>

      {generationError && (
        <div className="node-workspace-inline-error">{generationError}</div>
      )}

      <div className="node-workspace-ai-chat">
        <div className="node-workspace-ai-conversation">
          {(definition.ai.conversation?.length ?? 0) > 0 ? (
            definition.ai.conversation?.map((message) => (
              <div key={message.id} className={`node-workspace-ai-message node-workspace-ai-message-${message.role}`}>
                <button
                  type="button"
                  className={`node-workspace-ai-message-bubble${copiedMessageId === message.id ? ' copied' : ''}`}
                  title="Double-click to copy"
                  onDoubleClick={() => void copyConversationMessage(message)}
                >
                  {copiedMessageId === message.id && (
                    <span className="node-workspace-ai-copy-tooltip">Copied!</span>
                  )}
                  <div className="node-workspace-ai-message-meta">
                    <span>{message.role === 'user' ? 'You' : 'AI'}</span>
                    {message.kind === 'code' && <strong>code activated</strong>}
                    {message.kind === 'plan' && <strong>plan</strong>}
                  </div>
                  <div className="node-workspace-ai-message-content">{message.content}</div>
                </button>
              </div>
            ))
          ) : (
            <div className="node-workspace-ai-empty">Ask this node what it should do.</div>
          )}
        </div>

        <div className="node-workspace-ai-compose">
          <textarea
            value={definition.ai.prompt}
            rows={3}
            placeholder="Message AI Node..."
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
                return;
              }

              if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                const target = event.currentTarget;
                const selectionStart = target.selectionStart;
                const selectionEnd = target.selectionEnd;
                const prompt = definition.ai.prompt;
                const nextPrompt = `${prompt.slice(0, selectionStart)}\n${prompt.slice(selectionEnd)}`;
                updateClipAICustomNode(clip.id, definition.id, {
                  ai: { prompt: nextPrompt },
                });
                requestAnimationFrame(() => {
                  target.selectionStart = selectionStart + 1;
                  target.selectionEnd = selectionStart + 1;
                });
                return;
              }

              event.preventDefault();
              void sendPromptToAI();
            }}
            onChange={(event) => updateClipAICustomNode(clip.id, definition.id, {
              ai: { prompt: event.target.value },
            })}
          />
          <button
            type="button"
            className="node-workspace-ai-send-button"
            disabled={!canSendPrompt}
            onClick={() => void sendPromptToAI()}
          >
            {isGenerating ? '...' : 'Send'}
          </button>
        </div>

        <div className="node-workspace-ai-footer">
          <span>{definition.status === 'ready' ? 'Ready' : 'Draft'}</span>
          <span>{conversationCount > 0 ? `${conversationCount} messages` : access.label}</span>
          {access.kind === 'none' && (
            <button type="button" onClick={openSettings}>Configure AI</button>
          )}
        </div>
      </div>
    </div>
  );
}

function ClipNodeActions({ clip, onSelectNode }: { clip: TimelineClip; onSelectNode: (nodeId: string) => void }) {
  const addClipEffect = useTimelineStore((state) => state.addClipEffect);
  const addClipAICustomNode = useTimelineStore((state) => state.addClipAICustomNode);
  const effectCategories = useMemo(() => getCategoriesWithEffects(), []);

  return (
    <div className="node-workspace-inspector-section">
      <div className="node-workspace-inspector-section-title">Add Node</div>
      <button
        type="button"
        className="node-workspace-secondary-action"
        onClick={() => {
          startBatch('Add AI node');
          try {
            const nodeId = addClipAICustomNode(clip.id);
            if (nodeId) onSelectNode(nodeId);
          } finally {
            endBatch();
          }
        }}
      >
        AI Node
      </button>
      <select
        className="node-workspace-add-node-select"
        defaultValue=""
        onChange={(event) => {
          const effectType = event.target.value;
          if (!effectType) return;
          startBatch('Add effect node');
          try {
            const effectId = addClipEffect(clip.id, effectType);
            onSelectNode(`effect-${effectId}`);
          } finally {
            endBatch();
          }
          event.target.value = '';
        }}
      >
        <option value="" disabled>Effect...</option>
        {effectCategories.map(({ category, effects }) => (
          <optgroup key={category} label={category.charAt(0).toUpperCase() + category.slice(1)}>
            {effects.map((effect) => (
              <option key={effect.id} value={effect.id}>{effect.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

export function NodeWorkspacePanel() {
  const subject = useNodeGraphSubject();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const moveClipNodeGraphNode = useTimelineStore((state) => state.moveClipNodeGraphNode);
  const showClipNodeGraphBuiltIn = useTimelineStore((state) => state.showClipNodeGraphBuiltIn);
  const connectClipNodeGraphPorts = useTimelineStore((state) => state.connectClipNodeGraphPorts);
  const disconnectClipNodeGraphEdge = useTimelineStore((state) => state.disconnectClipNodeGraphEdge);
  const removeClipNodeGraphNode = useTimelineStore((state) => state.removeClipNodeGraphNode);
  const setClipEffectEnabled = useTimelineStore((state) => state.setClipEffectEnabled);
  const updateClipAICustomNode = useTimelineStore((state) => state.updateClipAICustomNode);
  const addClipEffect = useTimelineStore((state) => state.addClipEffect);
  const addClipAICustomNode = useTimelineStore((state) => state.addClipAICustomNode);
  const effectCategories = useMemo(() => getCategoriesWithEffects(), []);
  const [contextMenu, setContextMenu] = useState<NodeWorkspaceContextMenuState | null>(null);
  const [selection, setSelection] = useState<{ graphId: string | null; nodeId: string | null }>({
    graphId: null,
    nodeId: null,
  });
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return NODE_WORKSPACE_INSPECTOR_DEFAULT_WIDTH;
    }
    const storedWidth = Number(window.localStorage.getItem(NODE_WORKSPACE_INSPECTOR_WIDTH_KEY));
    return Number.isFinite(storedWidth)
      ? clampNodeWorkspaceInspectorWidth(storedWidth, window.innerWidth)
      : NODE_WORKSPACE_INSPECTOR_DEFAULT_WIDTH;
  });
  const selectedNodeId = selection.graphId === subject?.graph.id
    ? selection.nodeId
    : subject?.graph.nodes[0]?.id ?? null;

  const selectedNode = useMemo(() => {
    if (!subject) return null;
    return subject.graph.nodes.find((node) => node.id === selectedNodeId) ?? subject.graph.nodes[0] ?? null;
  }, [selectedNodeId, subject]);
  const contextMenuNode = useMemo(() => {
    if (!subject || !contextMenu?.nodeId) return null;
    return subject.graph.nodes.find((node) => node.id === contextMenu.nodeId) ?? null;
  }, [contextMenu?.nodeId, subject]);

  const selectNode = useCallback((nodeId: string) => {
    setSelection({
      graphId: subject?.graph.id ?? null,
      nodeId,
    });
  }, [subject?.graph.id]);

  const openProperties = useCallback(() => {
    useDockStore.getState().activatePanelType('clip-properties');
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const startInspectorResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const panelRect = panelRef.current?.getBoundingClientRect();
    const panelRight = panelRect?.right ?? window.innerWidth;
    const panelWidth = panelRect?.width ?? window.innerWidth;

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: MouseEvent) => {
      const nextWidth = clampNodeWorkspaceInspectorWidth(panelRight - moveEvent.clientX, panelWidth);
      setInspectorWidth(nextWidth);
      window.localStorage.setItem(NODE_WORKSPACE_INSPECTOR_WIDTH_KEY, String(Math.round(nextWidth)));
    };

    const handleUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, []);

  const addBuiltInNode = useCallback((node: 'transform' | 'mask' | 'color') => {
    if (!subject || subject.kind !== 'clip') return;
    startBatch('Add built-in node');
    try {
      showClipNodeGraphBuiltIn(subject.id, node);
      if (contextMenu) {
        moveClipNodeGraphNode(subject.id, node, contextMenu.layout);
      }
      selectNode(node);
    } finally {
      endBatch();
      closeContextMenu();
    }
  }, [closeContextMenu, contextMenu, moveClipNodeGraphNode, selectNode, showClipNodeGraphBuiltIn, subject]);

  const addEffectNode = useCallback((effectType: string) => {
    if (!subject || subject.kind !== 'clip') return;
    startBatch('Add effect node');
    try {
      const effectId = addClipEffect(subject.id, effectType);
      const nodeId = `effect-${effectId}`;
      if (contextMenu) {
        moveClipNodeGraphNode(subject.id, nodeId, contextMenu.layout);
      }
      selectNode(nodeId);
    } finally {
      endBatch();
      closeContextMenu();
    }
  }, [addClipEffect, closeContextMenu, contextMenu, moveClipNodeGraphNode, selectNode, subject]);

  const addAICustomNode = useCallback(() => {
    if (!subject || subject.kind !== 'clip') return;
    startBatch('Add AI node');
    try {
      const nodeId = addClipAICustomNode(subject.id);
      if (nodeId) {
        if (contextMenu) {
          moveClipNodeGraphNode(subject.id, nodeId, contextMenu.layout);
        }
        selectNode(nodeId);
      }
    } finally {
      endBatch();
      closeContextMenu();
    }
  }, [addClipAICustomNode, closeContextMenu, contextMenu, moveClipNodeGraphNode, selectNode, subject]);

  const deleteNode = useCallback((nodeId: string) => {
    if (!subject || subject.kind !== 'clip') return;
    const node = subject.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!canDeleteNodeFromClip(subject.clip, node)) return;

    startBatch('Delete node');
    try {
      removeClipNodeGraphNode(subject.id, nodeId);
      const fallbackNode = subject.graph.nodes.find((candidate) => candidate.id !== nodeId && candidate.kind === 'output') ??
        subject.graph.nodes.find((candidate) => candidate.id !== nodeId) ??
        null;
      setSelection({
        graphId: subject.graph.id,
        nodeId: fallbackNode?.id ?? null,
      });
    } finally {
      endBatch();
      closeContextMenu();
    }
  }, [closeContextMenu, removeClipNodeGraphNode, subject]);

  const moveNode = useCallback((nodeId: string, layout: NodeGraphLayout) => {
    if (!subject || subject.kind !== 'clip') return;
    moveClipNodeGraphNode(subject.id, nodeId, layout);
  }, [moveClipNodeGraphNode, subject]);

  const connectPorts = useCallback((connection: Parameters<typeof connectClipNodeGraphPorts>[1]) => {
    if (!subject || subject.kind !== 'clip') return;
    startBatch('Connect node ports');
    try {
      connectClipNodeGraphPorts(subject.id, connection);
    } finally {
      endBatch();
    }
  }, [connectClipNodeGraphPorts, subject]);

  const disconnectEdge = useCallback((edgeId: string) => {
    if (!subject || subject.kind !== 'clip') return;
    startBatch('Disconnect node link');
    try {
      disconnectClipNodeGraphEdge(subject.id, edgeId);
    } finally {
      endBatch();
    }
  }, [disconnectClipNodeGraphEdge, subject]);

  const toggleNodeBypass = useCallback((nodeId: string) => {
    if (!subject || subject.kind !== 'clip') return;
    const node = subject.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;

    startBatch('Toggle node bypass');
    try {
      if (node.kind === 'effect' && nodeId.startsWith('effect-')) {
        setClipEffectEnabled(subject.id, nodeId.slice('effect-'.length), node.params?.enabled === false);
      } else if (node.kind === 'custom') {
        updateClipAICustomNode(subject.id, nodeId, { bypassed: node.params?.bypassed !== true });
      }
    } finally {
      endBatch();
    }
  }, [setClipEffectEnabled, subject, updateClipAICustomNode]);

  if (!subject) {
    return (
      <div className="node-workspace-panel" ref={panelRef}>
        <div className="node-workspace-empty-state">
          <h3>Nodes</h3>
          <p>Select a timeline clip</p>
        </div>
      </div>
    );
  }

  return (
    <div className="node-workspace-panel" ref={panelRef}>
      <div className="node-workspace-main">
        <NodeGraphCanvas
          graph={subject.graph}
          selectedNodeId={selectedNode?.id ?? null}
          onSelectNode={selectNode}
          onMoveNode={moveNode}
          onConnectPorts={connectPorts}
          onDisconnectEdge={disconnectEdge}
          onDeleteNode={deleteNode}
          onToggleNodeBypass={toggleNodeBypass}
          onOpenAddMenu={setContextMenu}
        />
      </div>
      <NodeInspector
        node={selectedNode}
        clip={subject.clip}
        inspectorWidth={inspectorWidth}
        onSelectNode={selectNode}
        onOpenProperties={openProperties}
        onStartResizeInspector={startInspectorResize}
      />
      {contextMenu && subject && (
        <NodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          targetNode={contextMenuNode}
          canDeleteTarget={canDeleteNodeFromClip(subject.clip, contextMenuNode)}
          canAddVisualBuiltIns={subject.clip.source?.type !== 'audio'}
          effectCategories={effectCategories}
          onClose={closeContextMenu}
          onDeleteNode={() => {
            if (contextMenuNode) {
              deleteNode(contextMenuNode.id);
            }
          }}
          onAddAI={addAICustomNode}
          onAddBuiltIn={addBuiltInNode}
          onAddEffect={addEffectNode}
        />
      )}
    </div>
  );
}

function NodeContextMenu({
  x,
  y,
  targetNode,
  canDeleteTarget,
  canAddVisualBuiltIns,
  effectCategories,
  onClose,
  onDeleteNode,
  onAddAI,
  onAddBuiltIn,
  onAddEffect,
}: {
  x: number;
  y: number;
  targetNode: NodeGraphNode | null;
  canDeleteTarget: boolean;
  canAddVisualBuiltIns: boolean;
  effectCategories: ReturnType<typeof getCategoriesWithEffects>;
  onClose: () => void;
  onDeleteNode: () => void;
  onAddAI: () => void;
  onAddBuiltIn: (node: 'transform' | 'mask' | 'color') => void;
  onAddEffect: (effectType: string) => void;
}) {
  const left = typeof window === 'undefined' ? x : Math.min(x, window.innerWidth - 188);
  const top = typeof window === 'undefined' ? y : Math.min(y, window.innerHeight - 220);

  return (
    <div
      className="node-workspace-context-backdrop"
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className="node-workspace-context-menu"
        style={{ left: Math.max(8, left), top: Math.max(8, top) }}
        onClick={(event) => event.stopPropagation()}
      >
        {targetNode && (
          <>
            <button type="button" disabled={!canDeleteTarget} onClick={onDeleteNode}>Delete Node</button>
            <div className="node-workspace-context-separator" />
          </>
        )}
        <button type="button" onClick={onAddAI}>AI Node</button>
        <button type="button" disabled={!canAddVisualBuiltIns} onClick={() => onAddBuiltIn('transform')}>Transform</button>
        <button type="button" disabled={!canAddVisualBuiltIns} onClick={() => onAddBuiltIn('mask')}>Mask</button>
        <button type="button" disabled={!canAddVisualBuiltIns} onClick={() => onAddBuiltIn('color')}>Color</button>
        <div
          className="node-workspace-context-submenu"
          onMouseEnter={handleSubmenuHover}
          onMouseLeave={handleSubmenuLeave}
        >
          <button type="button">Effect Nodes</button>
          <div className="node-workspace-context-submenu-list context-submenu">
            {effectCategories.map(({ category, effects }) => (
              <div key={category} className="node-workspace-context-submenu-group">
                <span>{category}</span>
                {effects.map((effect) => (
                  <button
                    key={effect.id}
                    type="button"
                    onClick={() => onAddEffect(effect.id)}
                  >
                    {effect.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
