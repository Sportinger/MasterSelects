import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  RefCallback,
  RefObject,
} from 'react';
import { useAIStudioReferenceDock } from './AIStudioReferenceDockContext';
import './AIStudioComposerBar.css';

interface AIStudioComposerBarProps {
  children: ReactNode;
  className?: string;
  contentRef?: RefObject<HTMLDivElement | null>;
}

export function AIStudioComposerBar({
  children,
  className = '',
  contentRef,
}: AIStudioComposerBarProps) {
  return (
    <>
      <span className="ai-studio-drag-grip" aria-hidden="true">••</span>
      <div
        className={`ai-studio-composer-bar-content ${className}`.trim()}
        data-ai-studio-control
        ref={contentRef}
      >
        {children}
      </div>
    </>
  );
}

export function AIStudioPillRow({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ai-studio-composer-pills ${className}`.trim()} {...props} />;
}

interface AIStudioPillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  buttonRef?: RefCallback<HTMLButtonElement>;
}

export function AIStudioPill({
  buttonRef,
  className = '',
  type = 'button',
  ...props
}: AIStudioPillProps) {
  return (
    <button
      className={`ai-studio-composer-pill ${className}`.trim()}
      ref={buttonRef}
      type={type}
      {...props}
    />
  );
}

export function AIStudioPromptCapsule({
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const referenceDock = useAIStudioReferenceDock();
  return (
    <div className={`ai-studio-prompt-capsule ${className}`.trim()} {...props}>
      {children}
      {referenceDock}
    </div>
  );
}

export function AIStudioSplitButton({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ai-studio-composer-split ${className}`.trim()} {...props} />;
}
