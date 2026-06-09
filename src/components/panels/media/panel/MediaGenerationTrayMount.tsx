import { MediaAIGenerativeTray } from '../MediaAIGenerativeTray';

export interface MediaGenerationTrayMountProps {
  suppressed: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

export function MediaGenerationTrayMount({
  suppressed,
  expanded,
  onExpandedChange,
}: MediaGenerationTrayMountProps) {
  if (suppressed) return null;

  return (
    <MediaAIGenerativeTray
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    />
  );
}
