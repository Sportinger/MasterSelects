import { useEffect, useRef, useState } from 'react';
import type { FaceAnalysisBox } from '../../../types/clipMetadata';
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
  const timestamp = sample?.timestamp;
  const boxX = sample?.box.x;
  const boxY = sample?.box.y;
  const boxWidth = sample?.box.width;
  const boxHeight = sample?.box.height;
  const [thumbnail, setThumbnail] = useState<{
    file: File;
    timestamp: number;
    box: FaceAnalysisBox;
    src: string;
  } | null>(null);
  const hostRef = useRef<HTMLSpanElement>(null);
  const [shouldLoad, setShouldLoad] = useState(() => typeof IntersectionObserver === 'undefined');

  // A scene list can contain hundreds of distinct face crops. The crop cache
  // deduplicates equal requests, but each cold unique crop still needs a seek.
  // Do not enqueue those seeks until the thumbnail is actually near view.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin: '160px' });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    if (!shouldLoad
      || !file
      || timestamp === undefined
      || boxX === undefined
      || boxY === undefined
      || boxWidth === undefined
      || boxHeight === undefined) {
      return () => { active = false; };
    }

    const box = { x: boxX, y: boxY, width: boxWidth, height: boxHeight };
    void getFaceCropThumbnail({ file, timestamp, box }).then((result) => {
      if (!active || !result) return;
      objectUrl = URL.createObjectURL(result);
      setThumbnail({ file, timestamp, box, src: objectUrl });
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [boxHeight, boxWidth, boxX, boxY, file, shouldLoad, timestamp]);

  const src = thumbnail
    && thumbnail.file === file
    && thumbnail.timestamp === timestamp
    && thumbnail.box.x === boxX
    && thumbnail.box.y === boxY
    && thumbnail.box.width === boxWidth
    && thumbnail.box.height === boxHeight
    ? thumbnail.src
    : null;

  return (
    <span
      className="FaceCropThumbnail"
      ref={hostRef}
      style={{
        background: 'var(--bg-hover)', borderRadius: 'var(--radius-sm)', display: 'block',
        flex: `0 0 ${size}px`, height: `${size}px`, overflow: 'hidden', width: `${size}px`,
      }}
    >
      {src && (
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{ display: 'block', height: '100%', objectFit: 'cover', width: '100%' }}
        />
      )}
    </span>
  );
}
