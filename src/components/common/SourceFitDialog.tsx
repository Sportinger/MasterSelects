import { useCallback, useEffect, useRef, useState } from 'react';
import { useDraggableDialog } from './settings/useDraggableDialog';
import {
  subscribeSourceFitDialogOpen,
  type PendingSourceFitDialogRequest,
  type SourceFitDecision,
} from './sourceFitDialog/sourceFitDialogController';
import './SourceFitDialog.css';

interface SourceFitDialogProps {
  request: PendingSourceFitDialogRequest;
  onDecision: (decision: SourceFitDecision) => void;
}

const OPTIONS: ReadonlyArray<{ decision: SourceFitDecision; label: string }> = [
  { decision: 'fit', label: 'Fit' },
  { decision: 'stretch', label: 'Stretch' },
  { decision: 'original', label: 'Keep' },
];

function formatDimensions(width: number, height: number): string {
  return `${Math.round(width)} × ${Math.round(height)}`;
}

function SourceFitDialog({ request, onDecision }: SourceFitDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const { position, isDragging, handleMouseDown } = useDraggableDialog(dialogRef);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    keepButtonRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onDecision('original');
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [onDecision]);

  return (
    <div className="source-fit-dialog-layer" role="presentation">
      <div
        ref={dialogRef}
        className={`source-fit-dialog${isDragging ? ' is-dragging' : ''}`}
        style={{ left: position.x, top: position.y }}
        role="dialog"
        aria-label="Source sizing"
      >
        <svg className="source-fit-dialog-filter" aria-hidden="true" focusable="false">
          <defs>
            <filter id="source-fit-liquid-refraction" x="-20%" y="-30%" width="140%" height="160%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.012 0.034"
                numOctaves="2"
                seed="7"
                result="noise"
              />
              <feGaussianBlur in="noise" stdDeviation="0.7" result="softNoise" />
              <feDisplacementMap
                in="SourceGraphic"
                in2="softNoise"
                scale="30"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>
        <div className="source-fit-dialog-drag-handle" onMouseDown={handleMouseDown}>
          <span className="source-fit-dialog-grip" aria-hidden="true" />
          <p>
            Import <strong>{formatDimensions(request.sourceWidth, request.sourceHeight)}</strong>
            {' '}into Timeline{' '}
            <strong>{formatDimensions(request.compositionWidth, request.compositionHeight)}</strong>
          </p>
        </div>
        <div className="source-fit-dialog-options">
          {OPTIONS.map(({ decision, label }) => (
            <button
              key={decision}
              ref={decision === 'original' ? keepButtonRef : undefined}
              type="button"
              className={`source-fit-dialog-option${decision === 'original' ? ' is-default' : ''}`}
              aria-label={decision === 'original' ? 'Keep, default' : label}
              onClick={() => onDecision(decision)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SourceFitDialogHost() {
  const [request, setRequest] = useState<PendingSourceFitDialogRequest | null>(null);
  const requestRef = useRef<PendingSourceFitDialogRequest | null>(null);

  useEffect(() => subscribeSourceFitDialogOpen((nextRequest) => {
    requestRef.current?.resolve('original');
    requestRef.current = nextRequest;
    setRequest(nextRequest);
  }), []);

  useEffect(() => () => {
    requestRef.current?.resolve('original');
    requestRef.current = null;
  }, []);

  const handleDecision = useCallback((decision: SourceFitDecision) => {
    const currentRequest = requestRef.current;
    if (!currentRequest) return;
    requestRef.current = null;
    setRequest(null);
    currentRequest.resolve(decision);
  }, []);

  if (!request) return null;
  return <SourceFitDialog request={request} onDecision={handleDecision} />;
}
