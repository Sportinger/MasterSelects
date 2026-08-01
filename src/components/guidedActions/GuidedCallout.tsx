import type { ReactNode } from 'react';

interface GuidedCalloutProps {
  body?: string;
  header?: ReactNode;
  title: string;
}

export function GuidedCallout({ body, header, title }: GuidedCalloutProps) {
  return (
    <div
      className="guided-callout"
      aria-live="polite"
      role="status"
    >
      {header}
      <div className="guided-callout-title">{title}</div>
      {body && <div className="guided-callout-body">{body}</div>}
    </div>
  );
}
