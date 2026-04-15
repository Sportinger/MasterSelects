// File-type icons (AE style) - inline SVGs
// Small (14px) for list view, large for grid thumbnails
import React, { memo } from 'react';

interface FileTypeIconProps {
  type?: string;
  /** Render larger version for grid thumbnail placeholder */
  large?: boolean;
}

export const FileTypeIcon = memo(({ type, large }: FileTypeIconProps) => {
  const size = large ? 48 : 14;
  const style: React.CSSProperties = { width: size, height: size, flexShrink: 0, display: 'block' };

  if (large) {
    return <LargeIcon type={type} style={style} />;
  }

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
    case 'lottie':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" fill="#4d5a74" stroke="#8cc7ff" strokeWidth="0.7"/>
          <path d="M4 10.5c1.1-2.8 3.1-4.8 5.9-5.9" stroke="#8cc7ff" strokeWidth="1.1" strokeLinecap="round"/>
          <path d="M7.2 11.7c.8-1.8 2.1-3.1 3.9-3.9" stroke="#cce9ff" strokeWidth="1" strokeLinecap="round"/>
          <circle cx="4" cy="10.5" r="1" fill="#8cc7ff"/>
          <circle cx="10" cy="4.5" r="1" fill="#8cc7ff"/>
          <circle cx="11.1" cy="7.8" r="0.8" fill="#cce9ff"/>
        </svg>
      );
    case 'rive':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" fill="#5b4d72" stroke="#d8b6ff" strokeWidth="0.7"/>
          <path d="M5 12V4h3.2c1.8 0 2.8.9 2.8 2.3 0 .9-.5 1.7-1.4 2.1L12 12H10l-2.2-3H7v3H5zm2-4.7h1.1c1 0 1.6-.4 1.6-1.1 0-.7-.5-1-1.6-1H7v2.1z" fill="#f1e4ff"/>
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
    case 'text-3d':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" fill="#7b604a" stroke="#c8a07c" strokeWidth="0.7"/>
          <text x="8" y="10.6" textAnchor="middle" fill="#f3e3cf" fontSize="6.4" fontWeight="bold" fontFamily="sans-serif">3T</text>
        </svg>
      );
    case 'solid':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" fill="#777" stroke="#999" strokeWidth="0.7"/>
          <rect x="4" y="5" width="8" height="6" rx="0.5" fill="#bbb"/>
        </svg>
      );
    case 'model':
    case 'mesh':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" fill="#4a6a6a" stroke="#6a9a9a" strokeWidth="0.7"/>
          <path d="M8 4L12 6.5V11L8 13.5L4 11V6.5L8 4Z" stroke="#8ad8d8" strokeWidth="0.8" fill="#3a5a5a"/>
          <path d="M8 4V13.5M4 6.5L12 11M12 6.5L4 11" stroke="#6ab8b8" strokeWidth="0.5" opacity="0.6"/>
        </svg>
      );
    case 'camera':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" fill="#5a4f3a" stroke="#b49a64" strokeWidth="0.7"/>
          <rect x="4.2" y="5.2" width="7.6" height="5.6" rx="0.8" fill="#3d3526" stroke="#d5bf84" strokeWidth="0.7"/>
          <circle cx="8" cy="8" r="1.7" fill="#d5bf84" opacity="0.9"/>
          <circle cx="8" cy="8" r="0.7" fill="#6e5d39"/>
          <path d="M5 5.2L6 4h4l1 1.2" stroke="#d5bf84" strokeWidth="0.7" strokeLinecap="round"/>
        </svg>
      );
    case 'splat-effector':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" fill="#3d5a47" stroke="#74c792" strokeWidth="0.7"/>
          <circle cx="8" cy="8" r="2.3" fill="#183224" stroke="#a7f0c0" strokeWidth="0.8"/>
          <path d="M8 3.5V5.4M8 10.6V12.5M3.5 8H5.4M10.6 8H12.5M4.8 4.8L6.1 6.1M9.9 9.9L11.2 11.2M11.2 4.8L9.9 6.1M6.1 9.9L4.8 11.2" stroke="#a7f0c0" strokeWidth="0.8" strokeLinecap="round"/>
        </svg>
      );
    case 'gaussian-avatar':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" fill="#5a4a6a" stroke="#8a6aaa" strokeWidth="0.7"/>
          {/* Head silhouette made of splat dots */}
          <circle cx="8" cy="5.5" r="2.5" fill="#9a7abb" opacity="0.7"/>
          <ellipse cx="8" cy="11" rx="3.5" ry="2.5" fill="#9a7abb" opacity="0.5"/>
          {/* Splat particles */}
          <circle cx="6" cy="5" r="0.7" fill="#cc99ee" opacity="0.8"/>
          <circle cx="9.5" cy="4.5" r="0.5" fill="#cc99ee" opacity="0.7"/>
          <circle cx="8" cy="6.5" r="0.6" fill="#bb88dd" opacity="0.6"/>
          <circle cx="5.5" cy="10" r="0.5" fill="#cc99ee" opacity="0.5"/>
          <circle cx="10" cy="10.5" r="0.5" fill="#cc99ee" opacity="0.5"/>
        </svg>
      );
    case 'gaussian-splat':
      return (
        <svg style={style} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" fill="#5a5f3a" stroke="#aab46a" strokeWidth="0.7"/>
          <circle cx="5" cy="5" r="0.9" fill="#d9ef86" opacity="0.9"/>
          <circle cx="8.2" cy="4.3" r="0.7" fill="#d9ef86" opacity="0.75"/>
          <circle cx="10.8" cy="5.5" r="0.6" fill="#d9ef86" opacity="0.7"/>
          <circle cx="6.1" cy="8.2" r="0.8" fill="#c6de74" opacity="0.8"/>
          <circle cx="9.1" cy="8.8" r="0.7" fill="#c6de74" opacity="0.7"/>
          <circle cx="5.2" cy="10.8" r="0.5" fill="#e7f6a5" opacity="0.65"/>
          <circle cx="8.3" cy="11.4" r="0.8" fill="#d9ef86" opacity="0.75"/>
          <circle cx="11.1" cy="10.2" r="0.5" fill="#e7f6a5" opacity="0.6"/>
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

/** Large grid icons — more detailed, nicer looking */
const LargeIcon = memo(({ type, style }: { type?: string; style: React.CSSProperties }) => {
  switch (type) {
    case 'folder':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <path d="M6 12C6 10.3431 7.34315 9 9 9H18.5858C19.1162 9 19.6249 9.21071 20 9.58579L22.4142 12H39C40.6569 12 42 13.3431 42 15V36C42 37.6569 40.6569 39 39 39H9C7.34315 39 6 37.6569 6 36V12Z" fill="#5c5c6e"/>
          <path d="M6 16H42V36C42 37.6569 40.6569 39 39 39H9C7.34315 39 6 37.6569 6 36V16Z" fill="#7a7a8e"/>
          <path d="M6 16H42V18H6V16Z" fill="#8e8e9e" opacity="0.4"/>
        </svg>
      );
    case 'composition':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          {/* Film strip background */}
          <rect x="4" y="8" width="40" height="32" rx="3" fill="#5a3d6e"/>
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="#8a5faa" strokeWidth="1"/>
          {/* Sprocket holes */}
          <rect x="7" y="11" width="3" height="3" rx="0.5" fill="#3a2548" opacity="0.6"/>
          <rect x="7" y="17" width="3" height="3" rx="0.5" fill="#3a2548" opacity="0.6"/>
          <rect x="7" y="23" width="3" height="3" rx="0.5" fill="#3a2548" opacity="0.6"/>
          <rect x="7" y="29" width="3" height="3" rx="0.5" fill="#3a2548" opacity="0.6"/>
          <rect x="7" y="35" width="3" height="3" rx="0.5" fill="#3a2548" opacity="0.6"/>
          <rect x="38" y="11" width="3" height="3" rx="0.5" fill="#3a2548" opacity="0.6"/>
          <rect x="38" y="17" width="3" height="3" rx="0.5" fill="#3a2548" opacity="0.6"/>
          <rect x="38" y="23" width="3" height="3" rx="0.5" fill="#3a2548" opacity="0.6"/>
          <rect x="38" y="29" width="3" height="3" rx="0.5" fill="#3a2548" opacity="0.6"/>
          <rect x="38" y="35" width="3" height="3" rx="0.5" fill="#3a2548" opacity="0.6"/>
          {/* Inner frame */}
          <rect x="13" y="12" width="22" height="24" rx="1" fill="#4a2d5e" stroke="#7a4f9a" strokeWidth="0.5"/>
          {/* Composition target crosshair */}
          <circle cx="24" cy="24" r="8" stroke="#cc99ee" strokeWidth="1.2" fill="none" opacity="0.8"/>
          <circle cx="24" cy="24" r="3" stroke="#cc99ee" strokeWidth="0.8" fill="none" opacity="0.6"/>
          <circle cx="24" cy="24" r="1.2" fill="#cc99ee"/>
          <line x1="24" y1="14" x2="24" y2="19" stroke="#cc99ee" strokeWidth="0.6" opacity="0.4"/>
          <line x1="24" y1="29" x2="24" y2="34" stroke="#cc99ee" strokeWidth="0.6" opacity="0.4"/>
          <line x1="15" y1="24" x2="20" y2="24" stroke="#cc99ee" strokeWidth="0.6" opacity="0.4"/>
          <line x1="28" y1="24" x2="33" y2="24" stroke="#cc99ee" strokeWidth="0.6" opacity="0.4"/>
        </svg>
      );
    case 'audio':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="8" width="40" height="32" rx="3" fill="#2d5a3d"/>
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="#4a9a5a" strokeWidth="1"/>
          {/* Waveform — organic, asymmetric for realism */}
          <path d="M8 24v0M10 22v4M12 20v8M14 18v12M16 21v6M18 17v14M20 19v10M22 15v18M24 13v22M26 16v16M28 14v20M30 18v12M32 20v8M34 16v16M36 19v10M38 22v4M40 23v2"
            stroke="#6edf7e" strokeWidth="1.8" strokeLinecap="round" opacity="0.9"/>
          {/* Subtle reflection */}
          <path d="M8 24M10 24.5v-1M12 25v-2M14 26v-4M16 25v-2M18 27v-6M20 26v-4M22 28v-8M24 29v-10M26 27v-6M28 28v-8M30 26v-4M32 25v-2M34 27v-6M36 26v-4M38 25v-2M40 24.5v-1"
            stroke="#4aba5a" strokeWidth="1.8" strokeLinecap="round" opacity="0.25"/>
        </svg>
      );
    case 'video':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="8" width="40" height="32" rx="3" fill="#3a5a8a"/>
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="#5a8aba" strokeWidth="1"/>
          {/* Film grid */}
          <rect x="8" y="12" width="10" height="8" rx="1" fill="#2a4570" opacity="0.6"/>
          <rect x="20" y="12" width="10" height="8" rx="1" fill="#2a4570" opacity="0.6"/>
          <rect x="32" y="12" width="10" height="8" rx="1" fill="#2a4570" opacity="0.6"/>
          <rect x="8" y="22" width="10" height="8" rx="1" fill="#2a4570" opacity="0.6"/>
          <rect x="20" y="22" width="10" height="8" rx="1" fill="#2a4570" opacity="0.6"/>
          <rect x="32" y="22" width="10" height="8" rx="1" fill="#2a4570" opacity="0.6"/>
          <rect x="8" y="32" width="10" height="6" rx="1" fill="#2a4570" opacity="0.6"/>
          <rect x="20" y="32" width="10" height="6" rx="1" fill="#2a4570" opacity="0.6"/>
          <rect x="32" y="32" width="10" height="6" rx="1" fill="#2a4570" opacity="0.6"/>
        </svg>
      );
    case 'image':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="8" width="40" height="32" rx="3" fill="#4a5a7a"/>
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="#6a8aaa" strokeWidth="1"/>
          <circle cx="16" cy="18" r="4" fill="#8abbee" opacity="0.7"/>
          <path d="M4.5 32l10-8 7 5.5 8.5-11L44 35v3c0 1.38-1.12 2.5-2.5 2.5h-35c-1.38 0-2.5-1.12-2.5-2.5V32z" fill="#6a8aaa" opacity="0.6"/>
        </svg>
      );
    case 'lottie':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="8" width="40" height="32" rx="3" fill="#33455f"/>
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="#8cc7ff" strokeWidth="1"/>
          <path d="M12 30c3.5-9 10-15.5 19-19" stroke="#8cc7ff" strokeWidth="2.4" strokeLinecap="round"/>
          <path d="M21 34c2.3-5.3 6-9 11.3-11.3" stroke="#d9f0ff" strokeWidth="2.1" strokeLinecap="round"/>
          <circle cx="12" cy="30" r="2.5" fill="#8cc7ff"/>
          <circle cx="31" cy="11" r="2.5" fill="#8cc7ff"/>
          <circle cx="33.5" cy="22.5" r="2" fill="#d9f0ff"/>
        </svg>
      );
    case 'rive':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="8" width="40" height="32" rx="3" fill="#4d3f63"/>
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="#d8b6ff" strokeWidth="1"/>
          <path d="M15 35V13h10.2c5.4 0 8.8 2.8 8.8 7 0 2.7-1.5 4.9-4.1 6l6.1 9H30.4l-5-7.5H21V35h-6zm6-12.3h3.7c2.8 0 4.4-1 4.4-2.8 0-1.8-1.5-2.7-4.4-2.7H21v5.5z" fill="#f1e4ff"/>
        </svg>
      );
    case 'text':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="8" width="40" height="32" rx="3" fill="#7a5a4a"/>
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="#aa8a6a" strokeWidth="1"/>
          <text x="24" y="32" textAnchor="middle" fill="#eeddcc" fontSize="22" fontWeight="bold" fontFamily="sans-serif">T</text>
        </svg>
      );
    case 'text-3d':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="8" width="40" height="32" rx="3" fill="#70543f"/>
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="#c79b71" strokeWidth="1"/>
          <text x="24" y="31" textAnchor="middle" fill="#f3e3cf" fontSize="18" fontWeight="bold" fontFamily="sans-serif">3T</text>
        </svg>
      );
    case 'solid':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="8" width="40" height="32" rx="3" fill="#666"/>
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="#888" strokeWidth="1"/>
          <rect x="12" y="16" width="24" height="16" rx="1" fill="#aaa"/>
        </svg>
      );
    case 'model':
    case 'mesh':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="8" width="40" height="32" rx="3" fill="#3a5a5a"/>
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="#5a9a9a" strokeWidth="1"/>
          {/* 3D cube wireframe */}
          <path d="M24 12L36 19V33L24 40L12 33V19L24 12Z" stroke="#8ad8d8" strokeWidth="1.2" fill="#2a4a4a" opacity="0.8"/>
          <path d="M24 12V40" stroke="#6ab8b8" strokeWidth="0.8" opacity="0.5"/>
          <path d="M12 19L36 33" stroke="#6ab8b8" strokeWidth="0.8" opacity="0.5"/>
          <path d="M36 19L12 33" stroke="#6ab8b8" strokeWidth="0.8" opacity="0.5"/>
          <circle cx="24" cy="12" r="1.5" fill="#aaeaea"/>
          <circle cx="36" cy="19" r="1.5" fill="#aaeaea"/>
          <circle cx="12" cy="19" r="1.5" fill="#aaeaea"/>
          <circle cx="24" cy="40" r="1.5" fill="#aaeaea"/>
        </svg>
      );
    case 'camera':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="8" width="40" height="32" rx="3" fill="#56492f"/>
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="#c7a86d" strokeWidth="1"/>
          <path d="M14 16h6l2-3h4l2 3h6c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H14c-1.1 0-2-.9-2-2V18c0-1.1.9-2 2-2Z" fill="#30281b" stroke="#d8bc82" strokeWidth="1"/>
          <circle cx="24" cy="24" r="6.5" fill="#d8bc82" opacity="0.9"/>
          <circle cx="24" cy="24" r="3" fill="#6c5a36"/>
          <circle cx="34" cy="19" r="1.5" fill="#d8bc82" opacity="0.85"/>
        </svg>
      );
    case 'splat-effector':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="8" width="40" height="32" rx="3" fill="#2c4e3b"/>
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="#6fd294" strokeWidth="1"/>
          <circle cx="24" cy="24" r="7" fill="#173123" stroke="#aef2c7" strokeWidth="1.2"/>
          <path d="M24 11v6M24 31v6M11 24h6M31 24h6M15.5 15.5l4.2 4.2M28.3 28.3l4.2 4.2M32.5 15.5l-4.2 4.2M19.7 28.3l-4.2 4.2" stroke="#aef2c7" strokeWidth="1.4" strokeLinecap="round"/>
          <circle cx="24" cy="24" r="2.2" fill="#d6ffe4"/>
        </svg>
      );
    case 'gaussian-avatar':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="8" width="40" height="32" rx="3" fill="#4a3a5a"/>
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="#7a5a9a" strokeWidth="1"/>
          {/* Head silhouette made of gaussian splat particles */}
          <circle cx="24" cy="20" r="7" fill="#7a5a9a" opacity="0.6"/>
          <ellipse cx="24" cy="34" rx="10" ry="6" fill="#7a5a9a" opacity="0.4"/>
          {/* Splat dots */}
          <circle cx="20" cy="18" r="2" fill="#cc99ee" opacity="0.8"/>
          <circle cx="28" cy="17" r="1.5" fill="#cc99ee" opacity="0.7"/>
          <circle cx="24" cy="22" r="1.8" fill="#bb88dd" opacity="0.6"/>
          <circle cx="22" cy="15" r="1" fill="#ddaaff" opacity="0.5"/>
          <circle cx="26" cy="20" r="1.2" fill="#ddaaff" opacity="0.6"/>
          <circle cx="18" cy="32" r="1.5" fill="#cc99ee" opacity="0.5"/>
          <circle cx="30" cy="33" r="1.3" fill="#cc99ee" opacity="0.5"/>
          <circle cx="24" cy="30" r="1.5" fill="#bb88dd" opacity="0.4"/>
        </svg>
      );
    case 'gaussian-splat':
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <rect x="4" y="8" width="40" height="32" rx="3" fill="#4a5030"/>
          <rect x="4" y="8" width="40" height="32" rx="3" stroke="#93a455" strokeWidth="1"/>
          <circle cx="14" cy="16" r="3" fill="#def28c" opacity="0.95"/>
          <circle cx="23" cy="14" r="2.3" fill="#def28c" opacity="0.75"/>
          <circle cx="31" cy="17" r="2" fill="#def28c" opacity="0.65"/>
          <circle cx="18" cy="24" r="2.8" fill="#c8de74" opacity="0.85"/>
          <circle cx="26" cy="26" r="2.4" fill="#c8de74" opacity="0.78"/>
          <circle cx="34" cy="23" r="1.8" fill="#e8f7a7" opacity="0.62"/>
          <circle cx="15" cy="32" r="2" fill="#e8f7a7" opacity="0.55"/>
          <circle cx="23" cy="34" r="2.9" fill="#def28c" opacity="0.8"/>
          <circle cx="31" cy="31" r="1.9" fill="#c8de74" opacity="0.65"/>
        </svg>
      );
    default:
      return (
        <svg style={style} viewBox="0 0 48 48" fill="none">
          <path d="M14 6h14l12 12V40c0 1.1-.9 2-2 2H14c-1.1 0-2-.9-2-2V8c0-1.1.9-2 2-2z" fill="#4a4a4a" stroke="#777" strokeWidth="1"/>
          <path d="M28 6v12h12" stroke="#777" strokeWidth="1" fill="#5a5a5a"/>
        </svg>
      );
  }
});
