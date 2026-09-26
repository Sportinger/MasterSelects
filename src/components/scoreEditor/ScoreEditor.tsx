// ScoreEditor — detached score-writer window content (issue #366).
//
// Placeholder stage for the scorewriter: it proves the clip → window wiring
// (double-click a score clip opens this editor bound to that clip) while the
// actual notation surface is built out.

import { useTimelineStore } from '../../stores/timeline';

interface ScoreEditorProps {
  clipId: string;
}

export function ScoreEditor({ clipId }: ScoreEditorProps) {
  const clip = useTimelineStore((state) => state.clips.find((c) => c.id === clipId));

  if (!clip || clip.source?.type !== 'score') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        Score clip not found — it may have been deleted.
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: '100%',
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>{clip.name}</div>
      <div style={{ opacity: 0.7 }}>
        Score editor is working — notation view coming soon.
      </div>
      <div style={{ opacity: 0.5, fontSize: 12 }}>
        {clip.duration.toFixed(2)}s starting at {clip.startTime.toFixed(2)}s
      </div>
    </div>
  );
}
