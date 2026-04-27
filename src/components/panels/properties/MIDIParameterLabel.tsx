import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useContextMenuPosition } from '../../../hooks/useContextMenuPosition';
import { useMIDIStore } from '../../../stores/midiStore';
import type { MIDIParameterTarget } from '../../../types/midi';
import {
  createMIDIParameterBindingId,
  formatMIDIParameterMessageBinding,
} from '../../../types/midi';
import {
  setParameterMIDIBinding,
  startLearningParameterMIDIBinding,
} from '../../../services/midi/midiBindingMutations';

type MIDIParameterLabelElement = 'span' | 'label' | 'div' | 'h4';

interface MIDIParameterMenuState {
  x: number;
  y: number;
}

interface MIDIParameterLabelProps {
  target?: MIDIParameterTarget | null;
  children: ReactNode;
  as?: MIDIParameterLabelElement;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

function formatRangeValue(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(3).replace(/\.?0+$/, '');
}

export function MIDIParameterLabel({
  target,
  children,
  as = 'span',
  className,
  style,
  title,
}: MIDIParameterLabelProps) {
  const [menu, setMenu] = useState<MIDIParameterMenuState | null>(null);
  const bindingId = useMemo(
    () => (target ? createMIDIParameterBindingId(target) : null),
    [target],
  );
  const binding = useMIDIStore((state) => (bindingId ? state.parameterBindings[bindingId] : null));
  const learnTarget = useMIDIStore((state) => state.learnTarget);
  const cancelLearning = useMIDIStore((state) => state.cancelLearning);
  const { menuRef, adjustedPosition } = useContextMenuPosition(menu);

  const isLearningThisParameter = Boolean(
    target &&
    learnTarget?.kind === 'parameter' &&
    createMIDIParameterBindingId(learnTarget) === bindingId,
  );

  useEffect(() => {
    if (!menu) {
      return;
    }

    const handleClickOutside = () => setMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
      }
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('click', handleClickOutside);
    }, 0);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menu]);

  const handleContextMenu = (event: React.MouseEvent) => {
    if (!target) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY });
  };

  const labelClassName = ['midi-parameter-label', className].filter(Boolean).join(' ');
  const labelTitle = target
    ? title ?? 'Right-click for MIDI'
    : title;

  const labelProps = {
    className: labelClassName,
    style,
    title: labelTitle,
    onContextMenu: handleContextMenu,
  };

  let labelElement: ReactNode;
  switch (as) {
    case 'label':
      labelElement = <label {...labelProps}>{children}</label>;
      break;
    case 'div':
      labelElement = <div {...labelProps}>{children}</div>;
      break;
    case 'h4':
      labelElement = <h4 {...labelProps}>{children}</h4>;
      break;
    default:
      labelElement = <span {...labelProps}>{children}</span>;
      break;
  }

  const hasRange =
    target &&
    typeof target.min === 'number' &&
    typeof target.max === 'number' &&
    Number.isFinite(target.min) &&
    Number.isFinite(target.max);

  const menuElement = menu && target && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={menuRef}
          className="timeline-context-menu midi-parameter-menu"
          style={{
            position: 'fixed',
            left: adjustedPosition?.x ?? menu.x,
            top: adjustedPosition?.y ?? menu.y,
            zIndex: 10000,
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div
            className="context-menu-item"
            onClick={() => {
              startLearningParameterMIDIBinding(target);
              setMenu(null);
            }}
          >
            {isLearningThisParameter ? 'Restart MIDI Learn' : 'Learn MIDI'}
          </div>

          {isLearningThisParameter && (
            <div
              className="context-menu-item"
              onClick={() => {
                cancelLearning();
                setMenu(null);
              }}
            >
              Cancel MIDI Learn
            </div>
          )}

          {(binding || hasRange) && <div className="context-menu-separator" />}

          {binding && (
            <>
              <div className="context-menu-item disabled">
                Bound: {formatMIDIParameterMessageBinding(binding.message)}
              </div>
              <div
                className="context-menu-item"
                onClick={() => {
                  setParameterMIDIBinding(target, null);
                  if (isLearningThisParameter) {
                    cancelLearning();
                  }
                  setMenu(null);
                }}
              >
                Clear MIDI Binding
              </div>
            </>
          )}

          {hasRange && (
            <div className="context-menu-item disabled">
              Range: {formatRangeValue(target.min!)} to {formatRangeValue(target.max!)}
            </div>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      {labelElement}
      {menuElement}
    </>
  );
}
