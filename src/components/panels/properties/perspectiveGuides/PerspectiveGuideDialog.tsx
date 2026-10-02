import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Effect } from '../../../../types/effects';
import { MAX_GUIDES_PER_AXIS, solveGuidedPerspective, type Matrix3, type PerspectiveGuide } from '../../../../effects/distort/guided-perspective/guideGeometry';
import { createGuidedPhotoPreview } from '../../../../services/rawImage/guidedPhotoPreview';
import { ResolveInspectorRow } from '../resolveInspector/ResolveInspectorPrimitives';
import './PerspectiveGuides.css';

interface Props {
  file: File; effects: Effect[]; effectId?: string; initialGuides: PerspectiveGuide[];
  onCancel: () => void; onApply: (guides: PerspectiveGuide[], inverse: Matrix3) => void;
}
interface Drag { index: number; endpoint: 'start' | 'end'; previous: PerspectiveGuide[]; drawing: boolean }
export function PerspectiveGuideDialog({ file, effects, effectId, initialGuides, onCancel, onApply }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 });
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState(initialGuides);
  const [axis, setAxis] = useState<PerspectiveGuide['axis']>('vertical');
  const [selected, setSelected] = useState(-1);
  const [photo, setPhoto] = useState<{ url: string; aspect: number }>();
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true, url: string | undefined;
    const index = effects.findIndex(effect => effect.id === effectId);
    const upstream = effects.slice(0, index < 0 ? 0 : index).filter(effect => effect.enabled && effect.type === 'lens-correction');
    void createGuidedPhotoPreview(file, upstream).then(result => {
      if (!active) return;
      url = URL.createObjectURL(result.blob); setPhoto({ url, aspect: result.aspect });
    }).catch(error => { if (active) setLoadError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [file, effectId, effects]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => setStageSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const solution = useMemo(() => {
    try { return { matrix: solveGuidedPerspective(guides, photo?.aspect ?? 1).inverse, error: '' }; }
    catch (error) { return { matrix: undefined, error: error instanceof Error ? error.message : String(error) }; }
  }, [guides, photo?.aspect]);
  const point = (event: ReactPointerEvent<SVGSVGElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  };
  const start = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!photo || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const target = event.target as SVGElement;
    const index = target.dataset.guideIndex ? Number(target.dataset.guideIndex) : -1;
    if (index >= 0) {
      setSelected(index);
      if (!target.dataset.endpoint) return;
      drag.current = { index, endpoint: target.dataset.endpoint as Drag['endpoint'], previous: guides, drawing: false };
    } else {
      if (guides.filter(guide => guide.axis === axis).length >= MAX_GUIDES_PER_AXIS) {
        setNotice(`${MAX_GUIDES_PER_AXIS} ${axis} guides already exist. Move endpoints or delete a guide.`); return;
      }
      const [x, y] = point(event);
      setGuides([...guides, { axis, x1: x, y1: y, x2: x, y2: y }]); setSelected(guides.length); setNotice('');
      drag.current = { index: guides.length, endpoint: 'end', previous: guides, drawing: true };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const { index, endpoint } = drag.current, [x, y] = point(event);
    setGuides(previous => previous.map((guide, i) => i === index ? {
      ...guide, ...(endpoint === 'start' ? { x1: x, y1: y } : { x2: x, y2: y }),
    } : guide));
  };
  const finish = (event: ReactPointerEvent<SVGSVGElement>, cancelled = false) => {
    const current = drag.current;
    if (!current) return;
    if (cancelled) setGuides(current.previous);
    else if (current.drawing) setGuides(previous => previous.filter((g, i) => i !== current.index || Math.hypot(g.x2 - g.x1, g.y2 - g.y1) >= 0.015));
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return createPortal(<div className="perspective-guide-layer" role="presentation">
    <div className="perspective-guide-dialog" role="dialog" aria-modal="true" aria-label="Guided Perspective guides" ref={dialog} tabIndex={-1}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
        if (event.key === 'Tab') {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')];
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header><h2>Guided Perspective</h2><button className="perspective-action" type="button" aria-label="Close guide editor" onClick={onCancel} onPointerUp={event => event.currentTarget.blur()}>×</button></header>
      <p>Trace at least two parallel scene edges per direction. Up to eight vertical and eight horizontal guides are fitted together. Drag endpoints to refine.</p>
      <div className="perspective-guide-tools"><ResolveInspectorRow label="Direction">
        <div className="perspective-guide-directions" role="group" aria-label="Guide direction">
          {(['vertical', 'horizontal'] as const).map(direction => <button key={direction} type="button" className="perspective-action"
            aria-pressed={axis === direction} onPointerUp={event => event.currentTarget.blur()} onClick={() => { setAxis(direction); setNotice(''); }}>
            {direction === 'vertical' ? 'Vertical' : 'Horizontal'} ({guides.filter(guide => guide.axis === direction).length}/8)
          </button>)}
        </div>
      </ResolveInspectorRow>
        <button className="perspective-action" type="button" disabled={selected < 0 || selected >= guides.length}
          onPointerUp={event => event.currentTarget.blur()} onClick={() => { setGuides(guides.filter((_, i) => i !== selected)); setSelected(-1); }}>Delete selected guide</button>
        <button className="perspective-action" type="button" onPointerUp={event => event.currentTarget.blur()}
          onClick={() => { setGuides([]); setSelected(-1); setNotice(''); }}>Clear guides</button>
      </div>
      <div className="perspective-guide-stage" ref={stage}>
        {photo ? <div className="perspective-guide-image" style={{ width: Math.min(stageSize.width, stageSize.height * photo.aspect),
          height: Math.min(stageSize.height, stageSize.width / photo.aspect) }}>
          <img src={photo.url} alt="Photo for perspective guides" draggable={false} />
          <svg ref={svg} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Draw perspective guides"
            onPointerDown={start} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}>
            {guides.map((guide, index) => <g key={index} className={`perspective-guide-line ${guide.axis}${index === selected ? ' selected' : ''}`}>
              <line x1={guide.x1 * 1000} y1={guide.y1 * 1000} x2={guide.x2 * 1000} y2={guide.y2 * 1000} data-guide-index={index} />
              {(['start', 'end'] as const).map(endpoint => <circle key={endpoint} cx={(endpoint === 'start' ? guide.x1 : guide.x2) * 1000}
                cy={(endpoint === 'start' ? guide.y1 : guide.y2) * 1000} r={7} vectorEffect="non-scaling-stroke"
                data-guide-index={index} data-endpoint={endpoint} role="button" tabIndex={0}
                aria-label={`${guide.axis} guide ${index + 1} ${endpoint}`} onFocus={() => setSelected(index)}
                onKeyDown={event => {
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                  event.preventDefault(); event.stopPropagation();
                  const step = event.shiftKey ? 0.01 : 0.001;
                  const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
                  const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
                  setGuides(previous => previous.map((g, i) => i !== index ? g : { ...g,
                    ...(endpoint === 'start' ? { x1: Math.max(0, Math.min(1, g.x1 + dx)), y1: Math.max(0, Math.min(1, g.y1 + dy)) }
                      : { x2: Math.max(0, Math.min(1, g.x2 + dx)), y2: Math.max(0, Math.min(1, g.y2 + dy)) }),
                  }));
                }} />)}
            </g>)}
          </svg>
        </div> : <p role="status">{loadError || 'Preparing photo…'}</p>}
      </div>
      <footer><span role="status">{notice || solution.error || `${guides.length} guides ready. The whole photo will fit; use Scale to crop transparent borders.`}</span>
        <button className="perspective-action" type="button" onPointerUp={event => event.currentTarget.blur()} onClick={onCancel}>Cancel</button>
        <button className="perspective-action primary" type="button" disabled={!photo || !solution.matrix}
          onPointerUp={event => event.currentTarget.blur()} onClick={() => { if (solution.matrix) onApply(guides, solution.matrix); }}>Apply correction</button>
      </footer>
    </div>
  </div>, document.body);
}
