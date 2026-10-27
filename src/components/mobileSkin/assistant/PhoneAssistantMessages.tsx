// The conversation on the phone: one bubble per message with a Copy button (no double-click on a
// phone), kernel run cards and storyboard decisions as on the desktop, and under each answer the
// expandable list of the request's tool calls from the run audit the chat keeps.

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

import { getToolPolicy } from '../../../services/aiTools/policy';
import type { StoryboardDecisionSelection } from '../../../services/storyboard/decisions';
import type { FlashBoardChatMessage } from '../../../stores/flashboardStore';
import { canCopyFlashBoardChatMessage } from '../../panels/flashboard/FlashBoardChatMessageCopy';
import { KernelRunCard } from '../../panels/flashboard/KernelRunCard';
import { collapseNodeStreamBlocks } from '../../panels/flashboard/nodeStreamDisplay';
import { StoryboardDecisionCard } from '../../panels/flashboard/storyboard';
import { buildPhoneToolCallRows, countPhoneChangeSteps, type PhoneToolCallRow } from './phoneAssistantModel';
import { PHONE_ASSISTANT_TEST_IDS as IDS } from './phoneAssistantTestIds';
import '../../panels/flashboard/KernelRunCard.css';

const isReadOnlyTool = (name: string) => getToolPolicy(name)?.readOnly === true;

function blurAfterPointer(event: PointerEvent<HTMLElement>): void {
  event.currentTarget.blur();
}

const STATUS_LABEL: Record<PhoneToolCallRow['status'], string> = { running: 'Running', done: 'Done', failed: 'Failed' };

function ToolCallList({ message }: { message: FlashBoardChatMessage }) {
  const rows = buildPhoneToolCallRows(message, isReadOnlyTool);
  if (rows.length === 0) return null;
  const failed = rows.filter((row) => row.status === 'failed').length;
  const changes = countPhoneChangeSteps(rows);
  const parts = [`${rows.length} tool call${rows.length === 1 ? '' : 's'}`];
  if (changes > 0) parts.push(`${changes} change${changes === 1 ? '' : 's'}`);
  if (failed > 0) parts.push(`${failed} failed`);
  return (
    <details className="phone-assistant__calls" data-testid={IDS.toolCalls} data-count={rows.length}>
      <summary className="phone-assistant__calls-summary" onPointerUp={blurAfterPointer}>{parts.join(' · ')}</summary>
      <ol className="phone-assistant__calls-list">
        {rows.map((row) => (
          <li key={row.id} className="phone-assistant__call" data-testid={IDS.toolCall} data-tool={row.name} data-status={row.status}>
            <span className="phone-assistant__call-name">{row.name}</span>
            <span className="phone-assistant__call-status" data-status={row.status}>{STATUS_LABEL[row.status]}</span>
            <span className="phone-assistant__call-summary">{row.summary}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

interface PhoneAssistantMessagesProps {
  messages: FlashBoardChatMessage[];
  isChatting: boolean;
  listRef: RefObject<HTMLDivElement | null>;
  onDecisionSubmit: (selection: StoryboardDecisionSelection) => void;
  onCopyFailed: (reason: string) => void;
}

export function PhoneAssistantMessages({ messages, isChatting, listRef, onDecisionSubmit, onCopyFailed }: PhoneAssistantMessagesProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);
  useEffect(() => () => { if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current); }, []);

  const copy = (message: FlashBoardChatMessage) => {
    if (!navigator.clipboard?.writeText) {
      onCopyFailed('This browser does not allow copying here.');
      return;
    }
    void navigator.clipboard.writeText(message.text).then(() => {
      setCopiedId(message.id);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopiedId(null), 1500);
    }, () => onCopyFailed('Could not copy the message.'));
  };

  return (
    <div className="phone-assistant__messages" ref={listRef} data-testid={IDS.messages} aria-label="Conversation" role="log">
      {messages.length === 0 ? (
        <p className="phone-assistant__empty">
          Ask for an edit in your own words, or pick a task under All tools → Assistant. Changes land on the
          timeline as normal steps you can undo.
        </p>
      ) : null}
      {messages.map((message) => {
        const canCopy = canCopyFlashBoardChatMessage(message);
        const who = message.role === 'user' ? 'You' : message.isError ? 'Error' : 'Assistant';
        return (
          <article
            key={message.id}
            className="phone-assistant__message"
            data-testid={IDS.message}
            data-role={message.role}
            data-message-id={message.id}
            data-pending={message.isPending ? 'true' : 'false'}
            data-error={message.isError ? 'true' : 'false'}
          >
            <header className="phone-assistant__message-head">
              <span className="phone-assistant__who">{who}</span>
              {canCopy ? (
                <button type="button" className="phone-assistant__copy" data-testid={IDS.copy} onPointerUp={blurAfterPointer} onClick={() => copy(message)}>
                  {copiedId === message.id ? 'Copied' : 'Copy'}
                </button>
              ) : null}
            </header>
            {message.role === 'assistant' && message.kernelReport ? (
              <KernelRunCard isLatest={false} report={message.kernelReport} />
            ) : (
              <div className="phone-assistant__text">
                {message.role === 'user' ? message.text : collapseNodeStreamBlocks(message.text)}
              </div>
            )}
            {message.role === 'assistant' ? <ToolCallList message={message} /> : null}
            {message.decisionId ? (
              <StoryboardDecisionCard decisionId={message.decisionId} isBusy={isChatting} onSubmit={onDecisionSubmit} />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
