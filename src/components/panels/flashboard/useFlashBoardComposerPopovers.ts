import { useCallback, useEffect, useRef, useState } from 'react';

export type FlashBoardComposerPopover =
  | 'model'
  | 'aspect'
  | 'duration'
  | 'mode'
  | 'imageSize'
  | 'audioModel'
  | 'voice'
  | 'audioOutput'
  | 'voiceSettings'
  | 'sunoModel'
  | 'sunoMode'
  | 'chatProvider'
  | 'chatModel'
  | 'chatContext'
  | 'chatTemperature'
  | 'chatReasoning'
  | null;

export type FlashBoardComposerActivePopover = NonNullable<FlashBoardComposerPopover>;

const INLINE_SUBMENU_POPOVERS = new Set<FlashBoardComposerActivePopover>([
  'model',
  'aspect',
  'duration',
  'imageSize',
  'mode',
  'sunoModel',
  'sunoMode',
  'chatProvider',
  'chatModel',
  'chatContext',
  'chatTemperature',
  'chatReasoning',
]);

function isInlineSubmenuPopover(type: FlashBoardComposerPopover): boolean {
  return type !== null && INLINE_SUBMENU_POPOVERS.has(type);
}

export function useFlashBoardComposerPopovers() {
  const [popover, setPopover] = useState<FlashBoardComposerPopover>(null);
  const [closingPopover, setClosingPopover] = useState<FlashBoardComposerPopover>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const renderedPopover = popover ?? closingPopover;
  const popoverHostClassName = `fb-pill-group ${closingPopover && !popover ? 'is-closing' : popover ? 'is-opening' : ''}`;
  const inlineSubmenuVisible = isInlineSubmenuPopover(renderedPopover);
  const inlineSubmenuTypeClassName = inlineSubmenuVisible ? `inline-submenu-${renderedPopover}` : '';
  const inlineSubmenuStateClassName = inlineSubmenuVisible
    ? closingPopover && !popover
      ? `has-inline-submenu ${inlineSubmenuTypeClassName} is-inline-submenu-closing`
      : `has-inline-submenu ${inlineSubmenuTypeClassName} is-inline-submenu-opening`
    : '';

  const closePopover = useCallback((popoverToClose?: FlashBoardComposerPopover) => {
    const currentPopover = popoverToClose ?? popover;
    if (!currentPopover) {
      return;
    }

    setClosingPopover(currentPopover);
    setPopover(null);
  }, [popover]);

  const togglePopover = useCallback((type: FlashBoardComposerActivePopover) => {
    if (popover === type) {
      closePopover(type);
      return;
    }

    setClosingPopover(null);
    setPopover(type);
  }, [closePopover, popover]);

  useEffect(() => {
    if (!closingPopover || popover) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setClosingPopover(null);
    }, 540);

    return () => window.clearTimeout(timeoutId);
  }, [closingPopover, popover]);

  useEffect(() => {
    if (!popover) return;

    const handler = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        closePopover();
      }
    };

    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [closePopover, popover]);

  return {
    closePopover,
    inlineSubmenuStateClassName,
    popover,
    popoverHostClassName,
    popoverRef,
    renderedPopover,
    togglePopover,
  };
}
