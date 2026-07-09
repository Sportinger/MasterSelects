import { useCallback, useEffect, useRef, useState } from 'react';
import {
  extractAINodeParameterSchemaFromCode,
  mergeAINodeParamDefaults,
  type NodeGraphNode,
  type ClipCustomNodeConversationMessage,
} from '../../../../services/nodeGraph';
import { useAccountStore } from '../../../../stores/accountStore';
import { useSettingsStore } from '../../../../stores/settingsStore';
import { useTimelineStore } from '../../../../stores/timeline';
import type { TimelineClip } from '../../../../stores/timeline/types';
import { AINodeExposedParameters } from './AINodeExposedParameters';
import {
  appendConversationTurn,
  createAssistantChatContent,
  DEFAULT_LEMONADE_ENDPOINT,
  DEFAULT_LEMONADE_MODEL,
  extractGeneratedNodeCode,
  generateAINodeResponse,
  type NodeAIGenerationAccess,
} from './aiNodeAuthoring';
import { AIPortDropdown } from './AIPortDropdown';

export function CustomNodeParameters({ clip, node }: { clip: TimelineClip; node: NodeGraphNode }) {
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
  const masterAudioState = useTimelineStore((state) => state.masterAudioState);
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
        { clips, tracks, masterAudioState },
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
            <button type="button" onClick={() => openSettings()}>Configure AI</button>
          )}
        </div>
      </div>
    </div>
  );
}
