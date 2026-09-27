// ScoreEditor — detached score-writer window content (issue #366).
//
// Phase 3 (interaction): the full editor. Framework-free controllers (ported
// from kikoromantest) drive a live ScoreEditorEngine; every mutation commits
// whole-score ScoreData through updateScoreData, so the HOST historyStore
// owns undo — external scoreData changes (undo/redo, agent edits) reload the
// engine through the store subscription below. All listeners and shortcuts
// bind to the popup's own document; chrome styling is a stylesheet injected
// into the popup head (only <link> stylesheets are mirrored by the boot).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import type { ScoreData } from '../../types/scoreClip';
import { ScoreModel } from '../../services/score/ScoreModel';
import { ScoreEditorEngine } from '../../services/score/ScoreEditorEngine';
import { VexFlowScoreRenderer } from '../../services/score/render/VexFlowScoreRenderer';
import { ScoreHitTester } from '../../services/score/render/ScoreHitTester';
import { ensureScoreFontsInDocument } from '../../services/score/render/scoreFonts';
import { Logger } from '../../services/logger';
import { createObservableScoreEditorState } from './scoreEditorState';
import { ScoreRenderCoordinator } from './ScoreRenderCoordinator';
import { ScoreSelectionController } from './ScoreSelectionController';
import { ScorePaletteController } from './ScorePaletteController';
import { ScoreKeyboardController } from './ScoreKeyboardController';
import { ScoreMouseController } from './ScoreMouseController';
import { createScoreShortcuts, type ScoreShortcutManager } from './scoreShortcuts';
import { ScoreToolbar } from './ScoreToolbar';

const log = Logger.create('ScoreEditor');

const MIN_SHEET_WIDTH = 360;

/** Empty default sheet for a clip that has no notation yet. */
function createPlaceholderScore(title: string): ScoreData {
  const model = new ScoreModel(title, 120);
  model.addMeasure();
  model.addMeasure();
  model.addMeasure();
  return model.toScoreData();
}

/** Popup chrome styles: toolbar palette + pointer-focus hygiene. */
const SCORE_EDITOR_CSS = `
.se-toolbar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #2a2a2a; align-items: center; flex: none; user-select: none; }
.se-group { display: flex; gap: 2px; align-items: center; background: #1d1d1d; border-radius: 6px; padding: 3px; }
.se-label { font-size: 10px; opacity: .55; padding: 0 4px; text-transform: uppercase; letter-spacing: .4px; }
.se-btn { background: transparent; color: #c9c9c9; border: none; border-radius: 4px; min-width: 26px; height: 24px; padding: 0 7px; font-size: 12px; cursor: pointer; font-family: inherit; }
.se-btn:hover { background: #2e2e2e; }
.se-btn-active, .se-btn-active:hover { background: #155e75; color: #fff; }
.se-btn:focus { outline: none; }
.se-btn:focus-visible { outline: 2px solid #38bdf8; outline-offset: 1px; }
.se-btn-glyph { font-size: 15px; }
.se-zoom-value { min-width: 44px; font-variant-numeric: tabular-nums; }
.se-sheet { user-select: none; -webkit-user-select: none; }
`;

interface ScoreEditorProps {
  clipId: string;
}

interface EditorStack {
  renderer: VexFlowScoreRenderer;
  engine: ScoreEditorEngine;
  hitTester: ScoreHitTester;
  renderCoordinator: ScoreRenderCoordinator;
  selection: ScoreSelectionController;
  palette: ScorePaletteController;
  keyboard: ScoreKeyboardController;
  mouse: ScoreMouseController;
  shortcuts: ScoreShortcutManager;
}

export function ScoreEditor({ clipId }: ScoreEditorProps) {
  const clip = useTimelineStore((state) => state.clips.find((c) => c.id === clipId));
  const scoreData = clip?.scoreData;
  const clipName = clip?.name ?? 'Score';

  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<EditorStack | null>(null);
  /** The exact store object last written/loaded — reference identity marks external changes. */
  const lastSyncedRef = useRef<ScoreData | undefined>(undefined);
  const [fontsReady, setFontsReady] = useState(false);
  const [ready, setReady] = useState(false);

  const observable = useMemo(() => createObservableScoreEditorState(), []);

  // Persist the engine's score through the host store. Transient edits (live
  // drags) skip the history snapshot; the drag-end commit captures one.
  const commit = useCallback((description: string, options?: { transient?: boolean }) => {
    const stack = stackRef.current;
    if (!stack) return;
    const store = useTimelineStore.getState();
    store.updateScoreData(clipId, stack.engine.toScoreData(), {
      description,
      captureHistory: options?.transient !== true,
    });
    lastSyncedRef.current = useTimelineStore.getState().clips.find(c => c.id === clipId)?.scoreData;
  }, [clipId]);

  // Music fonts must exist in the POPUP document before the first render
  useEffect(() => {
    const doc = sheetRef.current?.ownerDocument ?? document;
    let cancelled = false;
    ensureScoreFontsInDocument(doc).then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Inject the chrome stylesheet into the popup head once
  useEffect(() => {
    const doc = sheetRef.current?.ownerDocument ?? document;
    if (doc.getElementById('score-editor-style')) return;
    const style = doc.createElement('style');
    style.id = 'score-editor-style';
    style.textContent = SCORE_EDITOR_CSS;
    doc.head.appendChild(style);
  }, []);

  // Build the editor stack once the sheet exists and fonts are ready
  useEffect(() => {
    if (!fontsReady || stackRef.current) return;
    const sheet = sheetRef.current;
    if (!sheet) return;

    // Width base is the scroll viewport (stable under zoom — the sheet itself
    // grows to fit the scaled SVG), minus the 16px padding on each side
    const sheetWidth = () => Math.max((scrollRef.current?.clientWidth ?? MIN_SHEET_WIDTH) - 32, MIN_SHEET_WIDTH);

    const renderer = new VexFlowScoreRenderer(sheet);
    renderer.initialize(sheetWidth(), 200);

    const storeClip = useTimelineStore.getState().clips.find(c => c.id === clipId);
    const initialData = storeClip?.scoreData ?? createPlaceholderScore(storeClip?.name ?? 'Score');
    lastSyncedRef.current = storeClip?.scoreData;

    let hitTester: ScoreHitTester | null = null;
    const engine = new ScoreEditorEngine(initialData, commit, () => hitTester);
    hitTester = new ScoreHitTester(renderer, () => engine.getScore());

    const state = observable.state;
    const renderCoordinator = new ScoreRenderCoordinator(renderer, hitTester, () => engine, state, sheetWidth);
    const renderScore = () => renderCoordinator.renderScore();

    const selection = new ScoreSelectionController(() => engine, state, hitTester, () => scrollRef.current, renderScore);

    let mouse: ScoreMouseController | null = null;
    const palette = new ScorePaletteController(
      () => engine,
      state,
      renderScore,
      coords => renderCoordinator.renderPreview(coords),
      () => mouse?.getLastMousePosition() ?? null,
      id => selection.selectNote(id),
    );

    const keyboard = new ScoreKeyboardController(
      () => engine,
      state,
      () => palette.getPendingArticulations(),
      renderScore,
      // Cursor advance is a plain assignment — selectNote would resync the
      // palette to the landed note (wrong after tie-chain splits)
      id => { state.selectedNoteId = id; },
      () => selection.getContextPitch(),
    );

    mouse = new ScoreMouseController(
      () => engine,
      () => sheetRef.current,
      state,
      hitTester,
      selection,
      renderCoordinator,
      () => palette.getPendingArticulations(),
    );

    const shortcuts = createScoreShortcuts(
      sheet.ownerDocument,
      state,
      () => engine,
      selection,
      palette,
      keyboard,
      renderCoordinator,
      () => mouse?.getLastMousePosition() ?? null,
    );

    mouse.setup();
    shortcuts.enable();
    stackRef.current = { renderer, engine, hitTester, renderCoordinator, selection, palette, keyboard, mouse, shortcuts };

    renderScore();
    setReady(true);
    log.info('Score editor ready', {
      clipId,
      measures: engine.getScore().measures.length,
      empty: !storeClip?.scoreData,
    });

    return () => {
      mouse?.teardown();
      shortcuts.disable();
      stackRef.current = null;
      setReady(false);
    };
  }, [fontsReady, clipId, commit, observable]);

  // External scoreData changes (host undo/redo, agent writes): reload the
  // engine and prune stale selection ids, then re-render.
  useEffect(() => {
    const stack = stackRef.current;
    if (!stack || !ready) return;
    if (scoreData === lastSyncedRef.current) return;

    stack.mouse.cancelDrag();
    stack.engine.loadScoreData(scoreData ?? createPlaceholderScore(clipName));
    lastSyncedRef.current = scoreData;

    const state = observable.state;
    if (state.selectedNoteId && !stack.engine.getNote(state.selectedNoteId)) state.selectedNoteId = null;
    if (state.selectedTupletId && !stack.engine.getTuplet(state.selectedTupletId)) state.selectedTupletId = null;
    if (state.selectedAccidentalNoteId && !stack.engine.getNote(state.selectedAccidentalNoteId)) {
      state.selectedAccidentalNoteId = null;
      state.selectedAccidentalType = null;
    }
    if (state.selectedArticulationNoteId && !stack.engine.getNote(state.selectedArticulationNoteId)) {
      state.selectedArticulationNoteId = null;
      state.selectedArticulationType = null;
    }
    if (state.selectedTieFromNoteId && !stack.engine.getNote(state.selectedTieFromNoteId)) {
      state.selectedTieFromNoteId = null;
    }

    stack.renderCoordinator.renderScore();
  }, [scoreData, ready, clipName, observable]);

  // Re-render on popup resize — the sheet width drives measure layout
  useEffect(() => {
    const win = sheetRef.current?.ownerDocument?.defaultView;
    if (!win || !ready) return;
    const onResize = () => stackRef.current?.renderCoordinator.renderScore();
    win.addEventListener('resize', onResize);
    return () => win.removeEventListener('resize', onResize);
  }, [ready]);

  // Ctrl+wheel zooms the sheet. Bound non-passively to the POPUP DOCUMENT:
  // anywhere in the window it must preempt the browser's page zoom (a
  // scroll-area-only listener left toolbar/header wheels zooming the page).
  useEffect(() => {
    const doc = sheetRef.current?.ownerDocument;
    if (!doc || !ready) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (e.deltaY === 0) return;
      stackRef.current?.renderCoordinator.zoomBy(e.deltaY < 0 ? 1 : -1);
    };
    doc.addEventListener('wheel', onWheel, { passive: false });
    return () => doc.removeEventListener('wheel', onWheel);
  }, [ready]);

  if (!clip || clip.source?.type !== 'score') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        Score clip not found — it may have been deleted.
      </div>
    );
  }

  const stack = stackRef.current;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          padding: '8px 16px 0',
          flex: 'none',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600 }}>{clipName}</span>
        <span style={{ opacity: 0.55, fontSize: 12 }}>
          N entry · Esc select · a–g notes · r rest · numpad palette
        </span>
      </div>
      {stack && (
        <ScoreToolbar
          observable={observable}
          palette={stack.palette}
          selection={stack.selection}
          renderScore={() => stack.renderCoordinator.renderScore()}
          clearPreview={() => stack.renderCoordinator.clearPreview()}
          zoomBy={direction => stack.renderCoordinator.zoomBy(direction)}
          resetZoom={() => stack.renderCoordinator.resetZoom()}
        />
      )}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div
          ref={sheetRef}
          className="se-sheet"
          onClick={e => stack?.mouse.handleClick(e.nativeEvent)}
          onMouseDown={e => stack?.mouse.handleMouseDown(e.nativeEvent)}
          onMouseMove={e => stack?.mouse.handleMouseMove(e.nativeEvent)}
          onMouseUp={() => stack?.mouse.handleMouseUp()}
          onMouseLeave={() => stack?.mouse.handleMouseLeave()}
          style={{
            // Dimmed sheet with a barely-there blue cast (user preference —
            // the bright warm paper was too glaring in the dark window)
            background: '#e4e8ee',
            borderRadius: 6,
            boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
            minHeight: 160,
            // Hug the (possibly zoomed) SVG, never smaller than the viewport
            width: 'fit-content',
            minWidth: '100%',
          }}
        />
      </div>
    </div>
  );
}
