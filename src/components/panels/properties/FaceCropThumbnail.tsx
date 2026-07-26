import { useEffect, useState } from 'react';
import type { FaceAnalysisBox } from '../../../types';
import { getFaceCropThumbnail } from '../../../services/faceAnalysis/faceCropThumbnailCache';

export interface FaceCropSample {
  timestamp: number;
  box: FaceAnalysisBox;
  confidence: number;
  manualSourcePersonId?: string;
}

interface FaceCropThumbnailProps {
  file?: File;
  sample?: FaceCropSample;
  size: number;
  alt: string;
}

export function FaceCropThumbnail({ file, sample, size, alt }: FaceCropThumbnailProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setSrc(null);
    if (!file || !sample) return () => { active = false; };

    void getFaceCropThumbnail({ file, timestamp: sample.timestamp, box: sample.box }).then((thumbnail) => {
      if (!active || !thumbnail) return;
      objectUrl = URL.createObjectURL(thumbnail);
      setSrc(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, sample]);

  if (!src) {
    return (
      <span
        aria-hidden="true"
        style={{
          background: 'rgba(255,255,255,0.07)', borderRadius: '4px', display: 'block',
          flex: `0 0 ${size}px`, height: `${size}px`, width: `${size}px`,
        }}
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      style={{ borderRadius: '4px', display: 'block', flex: `0 0 ${size}px`, height: `${size}px`, objectFit: 'cover', width: `${size}px` }}
    />
  );
}
