import { useEffect, useId, useRef, useState } from 'react';
import { IconChevronLeft, IconChevronRight, IconAdjustmentsHorizontal } from '@tabler/icons-react';
import { TimelineControls } from '../TimelineControls';
import type { TimelineControlsProps } from '../types';
import { useLegacyTransitionCompositionUpgrade } from '../hooks/useLegacyTransitionCompositionUpgrade';
import type { TimelineCurveMode } from '../../../stores/timeline/viewPreferences';
import { useSettingsStore } from '../../../stores/settingsStore';
import '../TimelineSidebar.css';

interface TimelineSidebarProps {
  onToggleTimelineCurveMode: () => void;
  timelineControlsProps: Omit<TimelineControlsProps, 'variant'>;
  timelineCurveMode: TimelineCurveMode;
}

/** A ruler-edge handle opens the timeline's secondary controls over its right side. */
export function TimelineSidebar({
  onToggleTimelineCurveMode,
  timelineControlsProps,
  timelineCurveMode,
}: TimelineSidebarProps) {
  const setCompactTimelineToolbar = useSettingsStore(state => state.setCompactTimelineToolbar);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const upgradeSources = useLegacyTransitionCompositionUpgrade();

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      handleRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  return (
    <div className="timeline-sidebar" ref={containerRef}
      onPointerDown={event => event.stopPropagation()}
      onPointerUp={event => {
        if (event.target instanceof Element) {
          const button = event.target.closest('button');
          if (button instanceof HTMLButtonElement) button.blur();
        }
      }}
    >
      <button
        ref={handleRef}
        type="button"
        className={`timeline-sidebar-handle${open ? ' active' : ''}`}
        aria-label="Timeline settings"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        title={open ? 'Close timeline settings' : 'Timeline settings'}
        onClick={event => {
          setOpen(value => !value);
          if (!open && event.detail === 0) {
            requestAnimationFrame(() => panelRef.current?.querySelector('button')?.focus());
          }
        }}
      >
        <IconAdjustmentsHorizontal size={14} stroke={1.7} aria-hidden="true" />
        {open
          ? <IconChevronRight size={10} aria-hidden="true" />
          : <IconChevronLeft size={10} aria-hidden="true" />}
      </button>
      {open && (
        <div ref={panelRef} id={panelId} role="dialog" aria-label="Timeline settings" className="timeline-sidebar-panel">
          <div className="timeline-sidebar-heading">Timeline <span>Settings</span></div>
          <TimelineControls variant="utility" {...timelineControlsProps} />
          <div className="timeline-sidebar-section">
            <span className="timeline-sidebar-label">Zoom</span>
            <TimelineControls variant="zoom" {...timelineControlsProps} />
          </div>
          <div className="timeline-sidebar-section">
            <span className="timeline-sidebar-label">Editor</span>
            <button
              aria-label="Toggle Timeline and Graph view"
              aria-pressed={timelineCurveMode === 'graph'}
              className={`timeline-curve-mode-toggle${timelineCurveMode === 'graph' ? ' active' : ''}`}
              data-guided-target="button:timeline-graph-toggle"
              type="button"
              onClick={onToggleTimelineCurveMode}
              title="Toggle Timeline / Graph view (G)"
            >
              <span>{timelineCurveMode === 'graph' ? 'Graph' : 'Timeline'}</span><kbd>G</kbd>
            </button>
          </div>
          <div className="timeline-sidebar-section">
            <span className="timeline-sidebar-label">Recording</span>
            <TimelineControls variant="recording" {...timelineControlsProps} />
          </div>
          <button className="timeline-sidebar-restore" type="button"
            onClick={() => setCompactTimelineToolbar(false)} title="Restore the classic timeline toolbar">
            <IconAdjustmentsHorizontal size={14} aria-hidden="true" />
            Use classic toolbar
          </button>
          {upgradeSources && (
            <button className="btn btn-sm" type="button" onClick={() => void upgradeSources()}>
              Upgrade sources
            </button>
          )}
        </div>
      )}
    </div>
  );
}
