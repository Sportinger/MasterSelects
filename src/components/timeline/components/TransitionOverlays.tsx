// Transition overlay elements (junction highlight + existing transitions)

import type { TimelineClip, TimelineTrack } from '../../../types';

interface TransitionOverlaysProps {
  activeJunction: { junctionTime: number } | null;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  timeToPixel: (time: number) => number;
  isTrackExpanded: (trackId: string) => boolean;
  getExpandedTrackHeight: (trackId: string, baseHeight: number) => number;
}

export function TransitionOverlays({
  activeJunction,
  clips,
  tracks,
  timeToPixel,
  isTrackExpanded,
  getExpandedTrackHeight,
}: TransitionOverlaysProps) {
  return (
    <>
      {/* Junction highlight for transition drop */}
      {activeJunction && (
        <div
          className="transition-junction-highlight"
          style={{
            position: 'absolute',
            left: timeToPixel(activeJunction.junctionTime) - 15,
            width: 30,
            top: 0,
            bottom: 0,
            background: 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.4), transparent)',
            pointerEvents: 'none',
            zIndex: 100,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              background: '#3b82f6',
              color: 'white',
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
          >
            Drop transition
          </div>
        </div>
      )}

      {/* Render existing transitions as junction elements */}
      {clips.filter(c => c.transitionOut).map(clipA => {
        const clipB = clips.find(c => c.id === clipA.transitionOut?.linkedClipId);
        if (!clipB || !clipA.transitionOut) return null;

        const track = tracks.find(t => t.id === clipA.trackId);
        if (!track) return null;

        // Calculate track position
        const trackIndex = tracks.indexOf(track);
        const trackTop = tracks
          .slice(0, trackIndex)
          .reduce((sum, t) => sum + (isTrackExpanded(t.id) ? getExpandedTrackHeight(t.id, t.height) : t.height), 0);
        const trackHeight = isTrackExpanded(track.id) ? getExpandedTrackHeight(track.id, track.height) : track.height;

        // Transition spans from clipB.startTime to clipA.startTime + clipA.duration
        const transitionStart = clipB.startTime;
        const transitionEnd = clipA.startTime + clipA.duration;
        const transitionWidth = timeToPixel(transitionEnd - transitionStart);
        const transitionLeft = timeToPixel(transitionStart);

        return (
          <div
            key={clipA.transitionOut.id}
            className="timeline-transition"
            style={{
              position: 'absolute',
              left: transitionLeft,
              top: trackTop,
              width: Math.max(transitionWidth, 20),
              height: trackHeight,
              pointerEvents: 'none',
              zIndex: 50,
            }}
          >
            {/* Transition visual */}
            <div
              style={{
                position: 'absolute',
                inset: 4,
                background: 'linear-gradient(90deg, rgba(74, 158, 255, 0.3), rgba(255, 107, 74, 0.3))',
                borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.6 }}>
                <path d="M7 4v16M17 4v16M7 12h10" stroke="white" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        );
      })}
    </>
  );
}
