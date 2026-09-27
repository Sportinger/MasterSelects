// ScoreEditor — detached score-writer window content (issue #366).
//
// Phase 2 (rendering): shows the clip's notation (`clip.scoreData`) as an
// engraved sheet via VexFlowScoreRenderer. The window is read-only until the
// interaction phase adds entry/selection/shortcuts. Popup rule: only <link>
// stylesheets are mirrored into the popup, so all chrome styling is inline.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { ScoreModel } from '../../services/score/ScoreModel';
import { VexFlowScoreRenderer } from '../../services/score/render/VexFlowScoreRenderer';
import { ensureScoreFontsInDocument } from '../../services/score/render/scoreFonts';
import { Logger } from '../../services/logger';

const log = Logger.create('ScoreEditor');

const MIN_SHEET_WIDTH = 360;

/** Empty default sheet shown for a clip that has no notation yet. */
function createPlaceholderScore(title: string) {
  const model = new ScoreModel(title, 120);
  // A short empty system reads as a sheet, not a lone stave
  model.addMeasure();
  model.addMeasure();
  model.addMeasure();
  return model.toScoreData();
}

interface ScoreEditorProps {
  clipId: string;
}

export function ScoreEditor({ clipId }: ScoreEditorProps) {
  const clip = useTimelineStore((state) => state.clips.find((c) => c.id === clipId));
  const scoreData = clip?.scoreData;
  const clipName = clip?.name ?? 'Score';

  const sheetRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<VexFlowScoreRenderer | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const score = useMemo(
    () => scoreData ?? createPlaceholderScore(clipName),
    [scoreData, clipName],
  );

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

  const renderSheet = useCallback(() => {
    const sheet = sheetRef.current;
    if (!sheet || !fontsReady) return;

    const width = Math.max(sheet.clientWidth, MIN_SHEET_WIDTH);
    try {
      if (!rendererRef.current) {
        rendererRef.current = new VexFlowScoreRenderer(sheet);
        rendererRef.current.initialize(width, 200);
      }
      rendererRef.current.renderScore(score, { width });
      setRenderError(null);
      log.info('Rendered score sheet', {
        clipId,
        measures: score.measures.length,
        width,
        height: rendererRef.current.getRenderedHeight(),
        empty: !scoreData,
      });
    } catch (error) {
      log.error('Score render failed', { clipId, error: String(error) });
      setRenderError(String(error));
    }
  }, [score, scoreData, fontsReady, clipId]);

  useEffect(() => {
    renderSheet();
  }, [renderSheet]);

  // Re-render on popup resize — the sheet width drives measure layout
  useEffect(() => {
    const win = sheetRef.current?.ownerDocument?.defaultView;
    if (!win) return;
    const onResize = () => renderSheet();
    win.addEventListener('resize', onResize);
    return () => win.removeEventListener('resize', onResize);
  }, [renderSheet]);

  if (!clip || clip.source?.type !== 'score') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        Score clip not found — it may have been deleted.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          padding: '10px 16px',
          borderBottom: '1px solid #2a2a2a',
          flex: 'none',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600 }}>{clipName}</span>
        <span style={{ opacity: 0.55, fontSize: 12 }}>
          {score.tempo} BPM · {score.defaultTimeSignature.numerator}/{score.defaultTimeSignature.denominator}
          {scoreData ? '' : ' · empty'}
        </span>
        {renderError && (
          <span style={{ color: '#f87171', fontSize: 12, marginLeft: 'auto' }}>
            Render failed — see console
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div
          ref={sheetRef}
          style={{
            background: '#fbf9f2',
            borderRadius: 6,
            boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
            minHeight: 160,
            width: '100%',
          }}
        />
      </div>
    </div>
  );
}
