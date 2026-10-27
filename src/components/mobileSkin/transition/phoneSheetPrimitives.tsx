// Layout primitives shared by the phone tool sheets: a horizontally scrolling chip row that shows it
// scrolls (edge fade on the overflowing side, selected chip kept in view on open and on change) and one empty
// state (icon, title, short body, one primary action). Styles: phoneSheetPrimitives.css.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import type { PhoneIconName } from '../contracts';
import { PhoneIcon } from '../shell/phoneIcons';
import { blurAfterPointer } from './phoneChoiceControls';
import './phoneSheetPrimitives.css';

const SELECTED = '[aria-selected="true"], [aria-checked="true"], [aria-pressed="true"]';

/** Which edges of a scroll row hide content; drives the CSS fade masks. */
function overflowEdges(element: HTMLElement): { start: boolean; end: boolean } {
  const max = element.scrollWidth - element.clientWidth;
  return { start: element.scrollLeft > 1, end: max - element.scrollLeft > 1 };
}

/** Scrolls the row (only the row, never the sheet) so its selected chip is fully visible. */
function revealSelected(row: HTMLElement): void {
  const selected = row.querySelector<HTMLElement>(SELECTED);
  if (!selected) return;
  const box = selected.getBoundingClientRect();
  const bounds = row.getBoundingClientRect();
  const gutter = 16;
  if (box.left < bounds.left + gutter) row.scrollLeft -= bounds.left + gutter - box.left;
  else if (box.right > bounds.right - gutter) row.scrollLeft += box.right - (bounds.right - gutter);
}

export interface PhoneChipRowProps {
  label: string;
  children: ReactNode;
  /** 'radiogroup' | 'tablist' | 'group' (default). */
  role?: 'radiogroup' | 'tablist' | 'group';
  className?: string;
  testId?: string;
}

/**
 * One scrolling row of chips or tabs. The overflowing edge fades out (so a cut chip reads as "more"
 * instead of broken), the inline scroll padding keeps a 16 px gutter and the selected chip is scrolled
 * into view when the row first renders and when the selection changes.
 */
export function PhoneChipRow({ label, children, role = 'group', className, testId }: PhoneChipRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  // The selected chip is scrolled into view when the row first renders and whenever the selection
  // moves to a chip outside the visible part (a group picked by code, a provider switched elsewhere).
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    revealSelected(element);
    setEdges(overflowEdges(element));
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setEdges((previous) => {
      const next = overflowEdges(element);
      return next.start === previous.start && next.end === previous.end ? previous : next;
    });
    element.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    const selection = typeof MutationObserver === 'undefined' ? null : new MutationObserver((records) => {
      if (records.some((record) => record.type === 'childList' || (record.target as HTMLElement).matches?.(SELECTED))) revealSelected(element);
      update();
    });
    selection?.observe(element, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'aria-checked', 'aria-pressed'],
    });
    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
      selection?.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`phone-chip-row${className ? ` ${className}` : ''}`}
      role={role}
      aria-label={label}
      data-testid={testId}
      data-fade-start={edges.start || undefined}
      data-fade-end={edges.end || undefined}
    >
      {children}
    </div>
  );
}

export interface PhoneEmptyStateProps {
  icon: PhoneIconName;
  title: string;
  /** At most two short lines. */
  body?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  testId?: string;
  actionTestId?: string;
}

/** The one empty state of the phone sheets: line icon, title, short body and one primary action. */
export function PhoneEmptyState({ icon, title, body, actionLabel, onAction, testId, actionTestId }: PhoneEmptyStateProps) {
  return (
    <div className="phone-empty-state" data-testid={testId} role="status">
      <span className="phone-empty-state__icon" aria-hidden="true"><PhoneIcon name={icon} size={32} /></span>
      <p className="phone-empty-state__title">{title}</p>
      {body ? <p className="phone-empty-state__body">{body}</p> : null}
      {actionLabel && onAction ? (
        <button type="button" className="phone-primary-button" data-testid={actionTestId}
          onPointerUp={blurAfterPointer} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
