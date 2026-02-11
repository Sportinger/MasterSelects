// Small file-type icons (AE style) - inline SVGs, 14px
import React, { memo } from 'react';

export const FileTypeIcon = memo(({ type }: { type?: string }) => {
  const size = 14;
  const style: React.CSSProperties = { width: size, height: size, flexShrink: 0, display: 'block' };

  switch (type) {
    case 'video':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="3" width="14" height="10" rx="1.5" fill="#4a6fa5" stroke="#6b9bd2" strokeWidth="0.7"/>
          <rect x="3" y="5" width="3" height="3" rx="0.5" fill="#2a4a75" opacity="0.7"/>
          <rect x="7" y="5" width="3" height="3" rx="0.5" fill="#2a4a75" opacity="0.7"/>
          <rect x="11" y="5" width="3" height="3" rx="0.5" fill="#2a4a75" opacity="0.7"/>
          <rect x="3" y="9" width="3" height="3" rx="0.5" fill="#2a4a75" opacity="0.7"/>
          <rect x="7" y="9" width="3" height="3" rx="0.5" fill="#2a4a75" opacity="0.7"/>
          <rect x="11" y="9" width="3" height="3" rx="0.5" fill="#2a4a75" opacity="0.7"/>
        </svg>
      );
    case 'audio':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" fill="#4a7a4a" stroke="#6aaa6a" strokeWidth="0.7"/>
          <path d="M4 6v4M6 5v6M8 4v8M10 5v6M12 6v4" stroke="#8fdf8f" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      );
    case 'image':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" fill="#5a6a8a" stroke="#7a9aba" strokeWidth="0.7"/>
          <circle cx="5.5" cy="6" r="1.5" fill="#aaccee"/>
          <path d="M1.5 11l3.5-3 2.5 2 3-4 4 5v0.5c0 .55-.45 1-1 1h-12c-.55 0-1-.45-1-1z" fill="#7a9aba" opacity="0.8"/>
        </svg>
      );
    case 'composition':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" fill="#7a5a8a" stroke="#aa7abb" strokeWidth="0.7"/>
          <circle cx="8" cy="8" r="3.5" stroke="#cc99dd" strokeWidth="1" fill="none"/>
          <circle cx="8" cy="8" r="1" fill="#cc99dd"/>
        </svg>
      );
    case 'text':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" fill="#8a6a5a" stroke="#bb9a7a" strokeWidth="0.7"/>
          <text x="8" y="11.5" textAnchor="middle" fill="#eeddcc" fontSize="9" fontWeight="bold" fontFamily="sans-serif">T</text>
        </svg>
      );
    case 'solid':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" fill="#777" stroke="#999" strokeWidth="0.7"/>
          <rect x="4" y="5" width="8" height="6" rx="0.5" fill="#bbb"/>
        </svg>
      );
    default:
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <path d="M4 1.5h5.5l4 4V14c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V2.5c0-.55.45-1 1-1z" fill="#5a5a5a" stroke="#888" strokeWidth="0.7"/>
          <path d="M9.5 1.5v4h4" stroke="#888" strokeWidth="0.7" fill="#6a6a6a"/>
        </svg>
      );
  }
});
