import { createPortal } from 'react-dom';

export interface MediaFloatingFeedbackItem {
  id: number;
  text: string;
  x: number;
  y: number;
}

export interface MediaFloatingFeedbackPortalProps {
  items: readonly MediaFloatingFeedbackItem[];
}

export function MediaFloatingFeedbackPortal({ items }: MediaFloatingFeedbackPortalProps) {
  if (items.length === 0) return null;

  return createPortal(
    items.map((item) => (
      <div key={item.id} className="media-floating-text" style={{ left: item.x, top: item.y }}>
        {item.text}
      </div>
    )),
    document.body,
  );
}
