import { useEffect, useRef, useState } from 'react';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { getNodeSummarySegments } from './canvasGeometry';
import { drawSummarySegments } from './rendering/paintNodeCanvas';
import './nodeSummarySegments.css';

/** Dense strips keep one roving keyboard target; all pointer hits use the same canvas geometry. */
export const SUMMARY_DOM_LIMIT = 128;
export function summaryKeyboardIndex(index: number, key: string, count: number): number {
  if (key === 'Home') return 0;
  if (key === 'End') return Math.max(0, count - 1);
  return Math.max(0, Math.min(count - 1, index + (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : key === 'PageDown' ? 20 : key === 'PageUp' ? -20 : 0)));
}
export function NodeSummarySegments({ node, canvasRendered, selectedClipIds, onSelect }: {
  node: NodeGraphNode; canvasRendered: boolean; selectedClipIds?: ReadonlySet<string>;
  onSelect?: (nodeId: string, segmentId: string, additive?: boolean) => void;
}) {
  const bar = getNodeSummarySegments(node);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dense = !!bar && bar.segments.length > SUMMARY_DOM_LIMIT;
  const index = Math.min(focusedIndex, Math.max(0, (bar?.segments.length ?? 1) - 1));
  useEffect(() => {
    if (canvasRendered || !dense || !bar || !canvas.current) return;
    const ctx = canvas.current.getContext('2d'); if (!ctx) return;
    const styles = getComputedStyle(canvas.current);
    const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    ctx.clearRect(0, 0, bar.width, bar.height); ctx.save(); ctx.translate(-bar.x, -bar.y);
    drawSummarySegments(ctx, bar, { background: color('--bg-primary', '#181818'), card: '#222',
      text: color('--text-primary', '#ddd'), muted: '#999', border: color('--border-color', '#444'), accent: color('--accent-color', '#79b8fa') });
    ctx.restore();
  }, [bar, canvasRendered, dense]);
  if (!bar) return null;
  const targets = dense ? bar.segments.slice(index, index + 1) : bar.segments;
  return <div className={`node-summary-segments${canvasRendered || dense ? ' canvas-painted' : ''}${bar.timeline ? ' timeline-segments' : ''}`}
    role="group" aria-label={`${node.label} ${bar.timeline ? 'timeline clips' : 'source pieces'}${dense ? '; arrow keys browse, Enter or Space selects' : ''}`}
    style={{ left: node.layout.x + bar.x, top: node.layout.y + bar.y, width: bar.width, height: bar.height }}>
    {!canvasRendered && dense && <canvas aria-hidden="true" ref={canvas} width={bar.width} height={bar.height} style={{ position: 'absolute', pointerEvents: 'none' }} />}
    <div className="node-summary-source-track" aria-hidden="true" style={{ height: bar.timeline ? bar.height : bar.lanes * 22 - 2 }} />
    {targets.map(segment => <button key={dense ? 'keyboard-segment' : segment.id} type="button"
      className="node-summary-segment" data-compact={segment.compact || undefined} data-transition={!!segment.transitionId || undefined}
      data-rule={segment.highlighted || undefined} aria-label={`Select ${segment.label}`} title={`Select ${segment.label}`}
      aria-pressed={segment.selected ?? (!segment.transitionId && selectedClipIds?.has(segment.clipId)) ?? false}
      style={{ left: segment.x - bar.x, top: segment.y - bar.y, width: Math.max(1, segment.width), height: segment.height }}
      onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (dense && ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
          event.preventDefault(); setFocusedIndex(summaryKeyboardIndex(index, event.key, bar.segments.length));
        }
      }}
      onClick={event => { event.stopPropagation(); onSelect?.(node.id, segment.id, event.shiftKey); if (event.detail > 0) event.currentTarget.blur(); }}>
      <span className="node-summary-segment-number" aria-hidden="true">{segment.transitionId ? 'T' : segment.index + 1}</span>
      {bar.timeline ? <span className="node-summary-segment-badges" aria-hidden="true">{segment.badges?.filter(badge => badge !== 'Trim').join(' / ')}</span>
        : <span className="node-summary-segment-range" aria-hidden="true" style={{ left: segment.rangeX - segment.x, width: Math.min(segment.rangeWidth, bar.x + bar.width - segment.rangeX) }} />}
    </button>)}
  </div>;
}
