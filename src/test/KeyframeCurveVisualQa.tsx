import { useMemo, useState } from 'react';
import { CurveEditor } from '../components/timeline/CurveEditor';
import { CurveEditorHeader } from '../components/timeline/CurveEditorHeader';
import '../components/timeline/TimelineKeyframesCurveEditor.css';
import './KeyframeCurveVisualQa.css';
import type { Keyframe } from '../types/keyframes';

const CLIP_ID = 'docs-keyframe-curve-clip';
const PROPERTY = 'position.x';
const CLIP_START_TIME = 0;
const CLIP_DURATION = 6;
const EDITOR_WIDTH = 980;
const PX_PER_SECOND = EDITOR_WIDTH / CLIP_DURATION;

const initialKeyframes: Keyframe[] = [
  {
    id: 'kf-start',
    clipId: CLIP_ID,
    time: 0.35,
    property: PROPERTY,
    value: -360,
    easing: 'bezier',
    handleOut: { x: 0.85, y: 260 },
  },
  {
    id: 'kf-selected',
    clipId: CLIP_ID,
    time: 2.4,
    property: PROPERTY,
    value: 420,
    easing: 'bezier',
    handleIn: { x: -0.7, y: -280 },
    handleOut: { x: 0.95, y: -260 },
  },
  {
    id: 'kf-dip',
    clipId: CLIP_ID,
    time: 4.15,
    property: PROPERTY,
    value: -160,
    easing: 'ease-in-out',
    handleIn: { x: -0.6, y: 220 },
    handleOut: { x: 0.55, y: 110 },
  },
  {
    id: 'kf-end',
    clipId: CLIP_ID,
    time: 5.55,
    property: PROPERTY,
    value: 260,
    easing: 'ease-out',
    handleIn: { x: -0.5, y: -150 },
  },
];

function updateKeyframe(
  keyframes: Keyframe[],
  keyframeId: string,
  updater: (keyframe: Keyframe) => Keyframe,
): Keyframe[] {
  return keyframes.map((keyframe) => (
    keyframe.id === keyframeId ? updater(keyframe) : keyframe
  ));
}

export function KeyframeCurveVisualQa() {
  const [keyframes, setKeyframes] = useState(initialKeyframes);
  const [selectedKeyframeIds, setSelectedKeyframeIds] = useState(() => new Set(['kf-selected']));

  const timelineMarks = useMemo(() => (
    Array.from({ length: CLIP_DURATION + 1 }, (_, second) => second)
  ), []);

  return (
    <main className="keyframe-curve-qa">
      <header className="keyframe-curve-qa-header">
        <div>
          <h1>Bezier Keyframe Curve Editor</h1>
          <p>Deterministic Position X fixture with selected keyframe handles.</p>
        </div>
        <span className="keyframe-curve-qa-badge">?test=keyframe-curve</span>
      </header>

      <section className="keyframe-curve-qa-shell">
        <aside className="keyframe-curve-qa-panel" aria-label="Selected property">
          <div className="keyframe-curve-qa-clip">
            <span>Clip</span>
            <strong>Hero Push-In</strong>
          </div>
          <div className="keyframe-curve-qa-property active">
            <span className="keyframe-curve-qa-stopwatch" aria-hidden="true" />
            <div>
              <strong>Position X</strong>
              <small>4 keyframes · custom Bezier</small>
            </div>
          </div>
          <div className="keyframe-curve-qa-property">
            <span className="keyframe-curve-qa-diamond" aria-hidden="true" />
            <div>
              <strong>Opacity</strong>
              <small>2 keyframes</small>
            </div>
          </div>
          <div className="keyframe-curve-qa-values">
            <label>
              <span>Selected time</span>
              <strong>02.400s</strong>
            </label>
            <label>
              <span>Value</span>
              <strong>420 px</strong>
            </label>
            <label>
              <span>Interpolation</span>
              <strong>Bezier</strong>
            </label>
          </div>
        </aside>

        <div className="keyframe-curve-qa-editor">
          <div className="keyframe-curve-qa-ruler" aria-hidden="true">
            {timelineMarks.map((second) => (
              <span key={second} style={{ left: `${(second / CLIP_DURATION) * 100}%` }}>
                {second}s
              </span>
            ))}
          </div>
          <div className="keyframe-curve-qa-track">
            <div className="keyframe-curve-qa-track-label">Position X</div>
            <div className="keyframe-curve-qa-track-lane">
              {keyframes.map((keyframe) => (
                <span
                  key={keyframe.id}
                  className={`keyframe-curve-qa-track-diamond ${selectedKeyframeIds.has(keyframe.id) ? 'selected' : ''}`}
                  style={{ left: `${(keyframe.time / CLIP_DURATION) * 100}%` }}
                />
              ))}
            </div>
          </div>
          <div className="keyframe-curve-qa-curve-row">
            <CurveEditorHeader
              property={PROPERTY}
              keyframes={keyframes}
              onClose={() => undefined}
            />
            <CurveEditor
              trackId="docs-track-video-1"
              clipId={CLIP_ID}
              property={PROPERTY}
              keyframes={keyframes}
              clipStartTime={CLIP_START_TIME}
              clipDuration={CLIP_DURATION}
              width={EDITOR_WIDTH}
              selectedKeyframeIds={selectedKeyframeIds}
              onSelectKeyframe={(id, addToSelection) => {
                setSelectedKeyframeIds((current) => {
                  if (!id) return new Set();
                  if (!addToSelection) return new Set([id]);
                  const next = new Set(current);
                  if (next.has(id)) {
                    next.delete(id);
                  } else {
                    next.add(id);
                  }
                  return next;
                });
              }}
              onMoveKeyframe={(id, newTime, newValue) => {
                setKeyframes((current) => updateKeyframe(current, id, (keyframe) => ({
                  ...keyframe,
                  time: newTime,
                  value: newValue,
                })));
              }}
              onUpdateBezierHandle={(id, handle, position) => {
                setKeyframes((current) => updateKeyframe(current, id, (keyframe) => ({
                  ...keyframe,
                  easing: 'bezier',
                  [handle === 'in' ? 'handleIn' : 'handleOut']: position,
                })));
              }}
              timeToPixel={(time) => time * PX_PER_SECOND}
              pixelToTime={(pixel) => pixel / PX_PER_SECOND}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
