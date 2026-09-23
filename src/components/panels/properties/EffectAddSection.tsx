import type { ReactNode, Ref } from 'react';
import './EffectCatalogPicker.css';
import './EffectCard.css';

export function EffectAddSection({ children, detailsRef, title = '+ Add Effect' }: {
  children: ReactNode;
  detailsRef?: Ref<HTMLDetailsElement>;
  title?: string;
}) {
  return <details className="effect-catalog-picker audio-effect-catalog" ref={detailsRef} onToggle={event => {
    if (event.currentTarget.open) event.currentTarget.querySelector<HTMLInputElement>('input[aria-label="Search effects"]')?.focus();
  }}>
    <summary>{title}</summary>
    <div className="effect-catalog-picker-body">{children}</div>
  </details>;
}
