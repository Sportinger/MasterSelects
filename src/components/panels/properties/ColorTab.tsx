import { ColorEditor } from '../color/ColorEditor';

interface ColorTabProps {
  clipId: string;
}

export function ColorTab({ clipId }: ColorTabProps) {
  return (
    <div className="properties-tab-content color-tab">
      <ColorEditor clipId={clipId} />
    </div>
  );
}
