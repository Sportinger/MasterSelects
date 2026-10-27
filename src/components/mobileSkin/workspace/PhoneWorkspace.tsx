// Full-screen landscape editor (M4): a desktop workspace panel in the middle, collapsible side panels
// left and right whose open/closed state is kept per editor across reloads (owner rule), and a slim
// bar with Back and the two side toggles. A collapsed side leaves a thin rail (tap or swipe inward
// opens it); an open side has a grip at its inner edge (swipe outward closes it). Side panels the
// person never toggled open on their own only when there is room (landscape, wide enough), and that
// default follows a rotation. The browser's back gesture closes the editor like the Back button.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

import { PhonePanelView } from '../panels/PhonePanelView';
import { usePhoneRuntime } from '../runtime/PhoneRuntimeContext';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneIcon } from '../shell/phoneIcons';
import { useTimelineStore } from '../../../stores/timeline';
import { ProGlyph } from '../compositions/phoneProGlyphs';
import {
  defaultPhoneWorkspaceSidesOpen, getPhoneWorkspace, readPhoneWorkspaceSideChoice, setPhoneWorkspaceSideCollapsed,
  type PhoneWorkspaceContent, type PhoneWorkspaceDefinition, type PhoneWorkspaceId, type PhoneWorkspaceSide,
} from './phoneWorkspaceCatalog';
import { PHONE_WORKSPACE_TEST_IDS as IDS } from './phoneWorkspaceTestIds';
import { renderPhoneWorkspaceCustom } from './phoneWorkspaceCustomViews';
import { usePhoneWorkspaceBackGesture } from './usePhoneWorkspaceBackGesture';
import './PhoneWorkspace.css';
import './PhoneWorkspaceEditors.css';

/** A swipe of at least this many CSS pixels along the inward/outward axis toggles a side. */
const SWIPE_PX = 24;

function WorkspaceArea({ content }: { content: PhoneWorkspaceContent }): ReactNode {
  if (content.kind === 'panel') return <PhonePanelView type={content.type} title={content.title} />;
  return renderPhoneWorkspaceCustom(content.id);
}

function readViewport() {
  return typeof window === 'undefined' ? { width: 0, height: 0 } : { width: window.innerWidth, height: window.innerHeight };
}

/** Viewport size, refreshed on resize and rotation. */
function useViewportSize() {
  const [size, setSize] = useState(readViewport);
  useEffect(() => {
    const update = () => setSize((current) => {
      const next = readViewport();
      return next.width === current.width && next.height === current.height ? current : next;
    });
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return size;
}

/**
 * `idle`: the side has nothing to show right now (Properties without a selected clip). An untouched
 * side then starts collapsed to its rail and opens on its own once a clip is selected (owner rule 3).
 */
function useSideState(id: PhoneWorkspaceId, side: PhoneWorkspaceSide, roomy: boolean, idle = false) {
  const [choice, setChoice] = useState(() => readPhoneWorkspaceSideChoice(id, side));
  const collapsed = choice ?? (!roomy || idle);
  const set = (next: boolean) => {
    setPhoneWorkspaceSideCollapsed(id, side, next);
    setChoice(next);
  };
  return { collapsed, toggle: () => set(!collapsed), set };
}

type SideState = ReturnType<typeof useSideState>;

/**
 * Pointer handlers that recognise a swipe in `direction` (+1: towards the right/bottom, -1: towards
 * the left/top) on the axis the layout uses (horizontal in landscape, vertical when the sides stack).
 * A recognised swipe runs `onSwipe` and swallows the click that follows it; a plain tap stays a click.
 */
function useSwipe(direction: 1 | -1, onSwipe: () => void) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      start.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      swallowClick.current = false;
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const from = start.current;
      start.current = null;
      if (event.pointerType !== 'mouse') event.currentTarget.blur();
      if (!from || from.id !== event.pointerId) return;
      const stacked = window.matchMedia?.('(orientation: portrait)').matches ?? false;
      const travel = stacked ? event.clientY - from.y : event.clientX - from.x;
      if (travel * direction >= SWIPE_PX) {
        swallowClick.current = true;
        onSwipe();
      }
    },
    onPointerCancel: () => { start.current = null; },
    shouldSwallowClick: () => {
      const swallow = swallowClick.current;
      swallowClick.current = false;
      return swallow;
    },
  };
}

function SideRail({ side, title, state }: { side: PhoneWorkspaceSide; title: string; state: SideState }) {
  const swipe = useSwipe(side === 'left' ? 1 : -1, () => state.set(false));
  return (
    <button
      type="button"
      className={`phone-workspace__rail phone-workspace__rail--${side}`}
      data-testid={side === 'left' ? IDS.railLeft : IDS.railRight}
      aria-label={`Show ${title}`}
      onPointerDown={swipe.onPointerDown}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onClick={() => { if (!swipe.shouldSwallowClick()) state.set(false); }}
    >
      <ProGlyph name={side === 'left' ? 'panel-left' : 'panel-right'} size={18} />
      <span className="phone-workspace__rail-label">{title}</span>
      <span className="phone-workspace__rail-chevron"><ProGlyph name={side === 'left' ? 'chevron-right' : 'chevron-left'} size={16} /></span>
    </button>
  );
}

function SideGrip({ side, title, state }: { side: PhoneWorkspaceSide; title: string; state: SideState }) {
  const swipe = useSwipe(side === 'left' ? -1 : 1, () => state.set(true));
  return (
    <button
      type="button"
      className={`phone-workspace__grip phone-workspace__grip--${side}`}
      data-testid={side === 'left' ? IDS.gripLeft : IDS.gripRight}
      aria-label={`Hide ${title}`}
      onPointerDown={swipe.onPointerDown}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onClick={() => { if (!swipe.shouldSwallowClick()) state.set(true); }}
    />
  );
}

function SideToggle({ side, title, state }: { side: PhoneWorkspaceSide; title: string; state: SideState }) {
  return (
    <button
      type="button"
      className="phone-workspace__button"
      data-testid={side === 'left' ? IDS.toggleLeft : IDS.toggleRight}
      aria-pressed={!state.collapsed}
      aria-label={`${state.collapsed ? 'Show' : 'Hide'} ${title}`}
      onClick={state.toggle}
      onPointerUp={(event) => { if (event.pointerType !== 'mouse') event.currentTarget.blur(); }}
    >
      <ProGlyph name={side === 'left' ? 'panel-left' : 'panel-right'} />
    </button>
  );
}

function Side({ side, content, state }: { side: PhoneWorkspaceSide; content: PhoneWorkspaceContent; state: SideState }) {
  if (state.collapsed) return <SideRail side={side} title={content.title} state={state} />;
  return (
    <aside
      className={`phone-workspace__side phone-workspace__side--${side}`}
      data-testid={side === 'left' ? IDS.sideLeft : IDS.sideRight}
      aria-label={content.title}
    >
      <div className="phone-workspace__side-content"><WorkspaceArea content={content} /></div>
      <SideGrip side={side} title={content.title} state={state} />
    </aside>
  );
}

/** Undo/Redo stay in reach while an editor covers the timeline's transport (same history as there). */
function HistoryButtons() {
  const { history } = usePhoneRuntime();
  return (
    <>
      <button
        type="button"
        className="phone-workspace__button"
        data-testid={IDS.undo}
        aria-label="Undo"
        aria-disabled={!history.canUndo}
        onClick={() => { if (history.canUndo) history.undo(); }}
        onPointerUp={(event) => { if (event.pointerType !== 'mouse') event.currentTarget.blur(); }}
      >
        <PhoneIcon name="undo" size={20} />
      </button>
      <button
        type="button"
        className="phone-workspace__button"
        data-testid={IDS.redo}
        aria-label="Redo"
        aria-disabled={!history.canRedo}
        onClick={() => { if (history.canRedo) history.redo(); }}
        onPointerUp={(event) => { if (event.pointerType !== 'mouse') event.currentTarget.blur(); }}
      >
        <PhoneIcon name="redo" size={20} />
      </button>
    </>
  );
}

function sideCount(definition: PhoneWorkspaceDefinition | undefined): number {
  return (definition?.left ? 1 : 0) + (definition?.right ? 1 : 0);
}

export function PhoneWorkspace({ id }: { id: PhoneWorkspaceId }) {
  const closeWorkspace = usePhoneUiStore((state) => state.closeWorkspace);
  const definition = getPhoneWorkspace(id);
  const viewport = useViewportSize();
  const roomy = defaultPhoneWorkspaceSidesOpen(viewport.width, viewport.height, sideCount(definition));
  const hasSelection = useTimelineStore((state) => state.selectedClipIds.size > 0);
  const idle = (content: PhoneWorkspaceContent | undefined) => content?.kind === 'panel' && content.type === 'clip-properties' && !hasSelection;
  const left = useSideState(id, 'left', roomy, idle(definition?.left));
  const right = useSideState(id, 'right', roomy, idle(definition?.right));
  const showToast = usePhoneUiStore((state) => state.showToast);
  const back = usePhoneWorkspaceBackGesture(id, closeWorkspace);
  if (!definition) return null;

  return (
    <div
      className="phone-workspace"
      data-testid={IDS.root}
      data-workspace={id}
      data-left={definition.left ? (left.collapsed ? 'collapsed' : 'open') : 'none'}
      data-right={definition.right ? (right.collapsed ? 'collapsed' : 'open') : 'none'}
      role="dialog"
      aria-label={`${definition.title} editor`}
    >
      <header className="phone-workspace__bar">
        <button
          type="button"
          className="phone-workspace__button"
          data-testid={IDS.back}
          aria-label="Back to the timeline"
          onClick={back}
          onPointerUp={(event) => { if (event.pointerType !== 'mouse') event.currentTarget.blur(); }}
        >
          <PhoneIcon name="back" />
        </button>
        {definition.left ? <SideToggle side="left" title={definition.left.title} state={left} /> : null}
        <h2 className="phone-workspace__title">{definition.title}</h2>
        <span className="phone-workspace__spacer" />
        <button
          type="button"
          className="phone-workspace__button phone-workspace__rotate"
          data-testid={IDS.rotateHint}
          aria-label="Turn your phone for more room"
          onClick={() => showToast('Turn your phone sideways: the editor gets the whole width.', 'info')}
          onPointerUp={(event) => { if (event.pointerType !== 'mouse') event.currentTarget.blur(); }}
        >
          <ProGlyph name="rotate" />
        </button>
        <HistoryButtons />
        {definition.right ? <SideToggle side="right" title={definition.right.title} state={right} /> : null}
      </header>
      <div className="phone-workspace__body">
        {definition.left ? <Side side="left" content={definition.left} state={left} /> : null}
        <main className="phone-workspace__main" data-testid={IDS.main} aria-label={definition.main.title}>
          <WorkspaceArea content={definition.main} />
        </main>
        {definition.right ? <Side side="right" content={definition.right} state={right} /> : null}
      </div>
    </div>
  );
}

/** Mounted once in the shell: shows the open landscape editor, nothing otherwise. */
export function PhoneWorkspaceHost() {
  const workspace = usePhoneUiStore((state) => state.workspace);
  const closeWorkspace = usePhoneUiStore((state) => state.closeWorkspace);
  const known = workspace ? getPhoneWorkspace(workspace as PhoneWorkspaceId) : undefined;
  useEffect(() => {
    // Silent failure is a bug: an unknown id would otherwise just show nothing.
    if (workspace && !known) console.warn(`[PhoneWorkspace] No landscape editor "${workspace}"; closing it.`);
    if (workspace && !known) closeWorkspace();
  }, [workspace, known, closeWorkspace]);
  return known ? <PhoneWorkspace key={known.id} id={known.id} /> : null;
}
