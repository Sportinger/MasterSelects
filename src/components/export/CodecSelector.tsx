// src/components/export/CodecSelector.tsx
// Dropdown component for selecting FFmpeg video codecs

import { useMemo } from 'react';
import {
  getCodecsForContainer,
  getCategoryLabel,
} from '../../engine/ffmpeg';
import type { FFmpegVideoCodec, FFmpegContainer, CodecInfo } from '../../engine/ffmpeg';

interface CodecSelectorProps {
  container: FFmpegContainer;
  value: FFmpegVideoCodec;
  onChange: (codec: FFmpegVideoCodec) => void;
  showCategory?: boolean;
  disabled?: boolean;
}

export function CodecSelector({
  container,
  value,
  onChange,
  showCategory = true,
  disabled = false,
}: CodecSelectorProps) {
  // Get codecs available for current container
  const availableCodecs = useMemo(
    () => getCodecsForContainer(container),
    [container]
  );

  // Group codecs by category
  const groupedCodecs = useMemo(() => {
    const groups: Record<string, CodecInfo[]> = {};
    for (const codec of availableCodecs) {
      const category = codec.category;
      if (!groups[category]) groups[category] = [];
      groups[category].push(codec);
    }
    return groups;
  }, [availableCodecs]);

  // Order of categories for display
  const categoryOrder: CodecInfo['category'][] = [
    'professional',
    'realtime',
    'lossless',
    'delivery',
  ];

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as FFmpegVideoCodec)}
      disabled={disabled}
      style={{ flex: 1 }}
    >
      {showCategory ? (
        // Grouped by category
        categoryOrder
          .filter((cat) => groupedCodecs[cat]?.length > 0)
          .map((category) => (
            <optgroup key={category} label={getCategoryLabel(category)}>
              {groupedCodecs[category].map((codec) => (
                <option key={codec.id} value={codec.id}>
                  {codec.name}
                </option>
              ))}
            </optgroup>
          ))
      ) : (
        // Flat list
        availableCodecs.map((codec) => (
          <option key={codec.id} value={codec.id}>
            {codec.name}
          </option>
        ))
      )}
    </select>
  );
}
