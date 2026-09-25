import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { LiquidGlassLens } from '../common/liquidGlass/LiquidGlassBubble';
import './InspectorSelect.css';

export interface InspectorSelectOption<T extends string = string> {
  disabled?: boolean;
  label: string;
  style?: CSSProperties;
  supportsAlpha?: boolean;
  title?: string;
  value: T;
}

export interface InspectorSelectGroup<T extends string = string> {
  label?: string;
  options: InspectorSelectOption<T>[];
}

interface TouchPickerLayout {
  placement: 'above' | 'below';
  style: CSSProperties;
}

const measureTouchPicker = (trigger: HTMLElement): TouchPickerLayout => {
  const rect = trigger.getBoundingClientRect();
  const margin = 8;
  const gap = 5;
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const width = Math.min(Math.max(rect.width, 190), viewportWidth - margin * 2);
  const left = Math.min(
    Math.max(rect.left, margin),
    Math.max(margin, viewportWidth - width - margin),
  );
  const spaceBelow = viewportHeight - rect.bottom - gap - margin;
  const spaceAbove = rect.top - gap - margin;
  const placement = spaceBelow >= Math.min(220, spaceAbove) ? 'below' : 'above';
  const height = Math.max(0, Math.min(300, placement === 'below' ? spaceBelow : spaceAbove));
  const top = placement === 'below' ? rect.bottom + gap : rect.top - gap - height;

  return {
    placement,
    style: { height, left, top, width },
  };
};

interface InspectorSelectProps<T extends string> {
  ariaLabel: string;
  disabled?: boolean;
  groups?: InspectorSelectGroup<T>[];
  onChange: (value: T) => void;
  onReset?: () => void;
  options?: InspectorSelectOption<T>[];
  touchScrollSelection?: boolean;
  value: T;
  wheelSelection?: boolean;
}

export function InspectorSelect<T extends string>({
  ariaLabel,
  disabled = false,
  groups,
  onChange,
  onReset,
  options: standaloneOptions,
  touchScrollSelection = false,
  value,
  wheelSelection = false,
}: InspectorSelectProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const resolvedGroups = useMemo<InspectorSelectGroup<T>[]>(
    () => groups ?? [{ options: standaloneOptions ?? [] }],
    [groups, standaloneOptions],
  );
  const options = useMemo(() => resolvedGroups.flatMap(group => group.options), [resolvedGroups]);
  const enabledOptions = useMemo(() => options.filter(option => !option.disabled), [options]);
  const selectedOption = options.find(option => option.value === value) ?? enabledOptions[0];
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState<T | undefined>(selectedOption?.value);
  const [touchPickerActive, setTouchPickerActive] = useState(false);
  const [touchPickerLayout, setTouchPickerLayout] = useState<TouchPickerLayout | null>(null);
  const wheelValueRef = useRef<T | undefined>(selectedOption?.value);

  wheelValueRef.current = selectedOption?.value;

  useEffect(() => {
    if (!open) setActiveValue(selectedOption?.value);
  }, [open, selectedOption?.value]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      const targetScope = target?.closest?.('[data-pointer-focus-scope]');
      const isInsideSelect = targetScope?.getAttribute('data-pointer-focus-scope') === listboxId;
      if (!isInsideSelect && !rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOutside, true);
    return () => document.removeEventListener('pointerdown', closeOutside, true);
  }, [listboxId, open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open || !touchPickerActive || !touchScrollSelection) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (trigger) setTouchPickerLayout(measureTouchPicker(trigger));
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('resize', updatePosition);
    };
  }, [open, touchPickerActive, touchScrollSelection]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!open || !touchPickerActive || !touchScrollSelection || !menu) return;

    const frame = window.requestAnimationFrame(() => {
      const selected = Array.from(menu.querySelectorAll<HTMLButtonElement>('.inspector-select-option'))
        .find(option => option.dataset.value === String(wheelValueRef.current));
      if (!selected) return;

      const menuRect = menu.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      menu.scrollTop += selectedRect.top + selectedRect.height / 2
        - (menuRect.top + menuRect.height / 2);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, touchPickerActive, touchScrollSelection]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !wheelSelection) return;

    const handleWheel = (event: WheelEvent) => {
      if (disabled || open || enabledOptions.length === 0 || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const currentIndex = enabledOptions.findIndex(option => option.value === wheelValueRef.current);
      const startIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = Math.max(
        0,
        Math.min(enabledOptions.length - 1, startIndex + (event.deltaY > 0 ? 1 : -1)),
      );
      const nextOption = enabledOptions[nextIndex];
      if (!nextOption || nextOption.value === wheelValueRef.current) return;

      wheelValueRef.current = nextOption.value;
      setActiveValue(nextOption.value);
      onChange(nextOption.value);
    };

    root.addEventListener('wheel', handleWheel, { passive: false });
    return () => root.removeEventListener('wheel', handleWheel);
  }, [disabled, enabledOptions, onChange, open, wheelSelection]);

  const choose = (option: InspectorSelectOption<T>, restoreKeyboardFocus = true) => {
    if (disabled || option.disabled) return;
    wheelValueRef.current = option.value;
    onChange(option.value);
    setOpen(false);
    if (restoreKeyboardFocus) triggerRef.current?.focus();
    else triggerRef.current?.blur();
  };

  const reset = (event: ReactMouseEvent) => {
    if (!onReset) return;
    event.preventDefault();
    event.stopPropagation();
    onReset();
    setOpen(false);
  };

  const moveActive = (direction: 1 | -1) => {
    if (enabledOptions.length === 0) return;
    const currentIndex = enabledOptions.findIndex(option => option.value === activeValue);
    const fallbackIndex = enabledOptions.findIndex(option => option.value === selectedOption?.value);
    const startIndex = currentIndex >= 0 ? currentIndex : Math.max(0, fallbackIndex);
    const nextIndex = Math.max(0, Math.min(enabledOptions.length - 1, startIndex + direction));
    setActiveValue(enabledOptions[nextIndex]?.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveValue(selectedOption?.value);
      } else {
        moveActive(event.key === 'ArrowDown' ? 1 : -1);
      }
      return;
    }
    if (event.key === 'Home' && open) {
      event.preventDefault();
      setActiveValue(enabledOptions[0]?.value);
      return;
    }
    if (event.key === 'End' && open) {
      event.preventDefault();
      setActiveValue(enabledOptions.at(-1)?.value);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      const activeOption = enabledOptions.find(option => option.value === activeValue);
      if (activeOption) choose(activeOption);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const activeOptionId = activeValue === undefined
    ? undefined
    : `${listboxId}-${String(activeValue).replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  useEffect(() => {
    if (!open || touchPickerActive || !activeOptionId) return;
    const option = document.getElementById(activeOptionId);
    option?.scrollIntoView?.({ block: 'nearest' });
  }, [open, touchPickerActive, activeOptionId]);

  const handleTouchPickerScroll = () => {
    const menu = menuRef.current;
    if (!touchPickerActive || !touchScrollSelection || !menu) return;

    const menuRect = menu.getBoundingClientRect();
    const menuCenter = menuRect.top + menuRect.height / 2;
    let closestOption: HTMLButtonElement | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const option of menu.querySelectorAll<HTMLButtonElement>('.inspector-select-option:not(:disabled)')) {
      const optionRect = option.getBoundingClientRect();
      const distance = Math.abs(optionRect.top + optionRect.height / 2 - menuCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestOption = option;
      }
    }

    const nextValue = closestOption?.dataset.value as T | undefined;
    if (!nextValue || nextValue === wheelValueRef.current) return;

    wheelValueRef.current = nextValue;
    setActiveValue(nextValue);
    onChange(nextValue);
  };

  const renderMenuGroups = () => resolvedGroups.map((group, groupIndex) => {
    const groupLabelId = `${listboxId}-group-${groupIndex}`;
    return (
      <div
        aria-labelledby={group.label ? groupLabelId : undefined}
        className="inspector-select-group"
        key={group.label ?? groupIndex}
        role={group.label ? 'group' : undefined}
      >
        {group.label && <div className="inspector-select-group-label" id={groupLabelId}>{group.label}</div>}
        {group.options.map(option => {
          const optionId = `${listboxId}-${String(option.value).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
          return (
            <button
              aria-disabled={option.disabled || undefined}
              aria-selected={option.value === value}
              className={`inspector-select-option${option.value === activeValue ? ' is-active' : ''}`}
              data-value={option.value}
              disabled={option.disabled}
              id={optionId}
              key={option.value}
              onClick={event => choose(option, event.detail === 0)}
              onMouseDown={event => event.preventDefault()}
              role="option"
              style={option.style}
              title={option.title}
              type="button"
            >
              <span className="inspector-select-option-label">{option.label}</span>
              {option.supportsAlpha && <span className="inspector-select-alpha" aria-label="Supports alpha">{'\u03B1'}</span>}
            </button>
          );
        })}
      </div>
    );
  });

  const renderListbox = (touch: boolean) => (
    <div
      className={`inspector-select-menu${touch ? ' inspector-select-menu--touch' : ''}`}
      id={listboxId}
      aria-label={ariaLabel}
      onScroll={handleTouchPickerScroll}
      ref={menuRef}
      role="listbox"
    >
      {renderMenuGroups()}
    </div>
  );

  const openMenu = open && touchPickerActive && touchScrollSelection && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="inspector-select-touch-layer"
          onPointerDown={event => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.blur();
          }}
        >
          <div
            className="inspector-select-touch-shell ms-liquid-glass"
            data-pointer-focus-scope={listboxId}
            data-placement={touchPickerLayout?.placement ?? 'below'}
            style={touchPickerLayout?.style}
          >
            <LiquidGlassLens />
            <div className="inspector-select-touch-selection-window" aria-hidden="true" />
            {renderListbox(true)}
          </div>
        </div>,
        document.body,
      )
    : open
      ? renderListbox(false)
      : null;

  return (
    <div
      className={`inspector-select${disabled ? ' is-disabled' : ''}${touchPickerActive ? ' is-touch-picker' : ''}`}
      data-pointer-focus-scope={listboxId}
      onContextMenu={reset}
      onBlur={event => {
        const relatedTarget = event.relatedTarget as Element | null;
        const relatedScope = relatedTarget?.closest?.('[data-pointer-focus-scope]');
        const staysInSelect = event.currentTarget.contains(relatedTarget)
          || relatedScope?.getAttribute('data-pointer-focus-scope') === listboxId;
        if (!staysInSelect) setOpen(false);
      }}
      ref={rootRef}
    >
      <button
        aria-activedescendant={open ? activeOptionId : undefined}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="inspector-select-trigger"
        disabled={disabled}
        onClick={() => setOpen(current => !current)}
        onKeyDown={handleKeyDown}
        onPointerDown={event => {
          if (!touchScrollSelection) return;
          const isTouch = event.pointerType === 'touch';
          setTouchPickerActive(isTouch);
          if (isTouch) setTouchPickerLayout(measureTouchPicker(event.currentTarget));
        }}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span className="inspector-select-label">{selectedOption?.label}</span>
        {selectedOption?.supportsAlpha && <span className="inspector-select-alpha" aria-hidden="true">{'\u03B1'}</span>}
        <svg className="inspector-select-chevron" aria-hidden="true" viewBox="0 0 10 6">
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>

      {openMenu}
    </div>
  );
}
