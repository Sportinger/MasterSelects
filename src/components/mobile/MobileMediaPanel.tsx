// Mobile Media Panel - Swipe in from left

import { useCallback } from 'react';
import { useMediaStore } from '../../stores/mediaStore';
import { isUserVisibleComposition } from '../../stores/mediaStore/compositionVisibility';
import { useTimelineStore } from '../../stores/timeline';
import { placeSignalAssetOnTimeline } from '../../runtime/renderers/signalTimelineRendererAdapter';

interface MobileMediaPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileMediaPanel({ isOpen, onClose }: MobileMediaPanelProps) {
  const files = useMediaStore((s) => s.files);
  const signalAssets = useMediaStore((s) => s.signalAssets);
  const allCompositions = useMediaStore((s) => s.compositions);
  const compositions = allCompositions.filter(isUserVisibleComposition);
  const importFiles = useMediaStore((s) => s.importFiles);
  const refreshFileUrls = useMediaStore((s) => s.refreshFileUrls);
  const tracks = useTimelineStore((s) => s.tracks);
  const addClip = useTimelineStore((s) => s.addClip);
  const addTextClip = useTimelineStore((s) => s.addTextClip);
  const updateTextProperties = useTimelineStore((s) => s.updateTextProperties);
  const updateClip = useTimelineStore((s) => s.updateClip);
  const playheadPosition = useTimelineStore((s) => s.playheadPosition);

  // Handle file import
  const handleImport = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async (e) => {
      const fileList = (e.target as HTMLInputElement).files;
      if (fileList) {
        await importFiles(Array.from(fileList));
      }
    };
    input.click();
  }, [importFiles]);

  // Handle tap to add to timeline
  const handleMediaTap = useCallback((mediaFileId: string) => {
    const mediaFile = files.find((f) => f.id === mediaFileId);
    if (!mediaFile || !mediaFile.file) return;

    // Find first video track or first track
    const videoTrack = tracks.find((t) => t.type === 'video') || tracks[0];
    if (!videoTrack) return;

    // Add clip at playhead
    addClip(videoTrack.id, mediaFile.file, playheadPosition, mediaFile.duration, mediaFileId);
    onClose();
  }, [files, tracks, addClip, playheadPosition, onClose]);

  const handleSignalAssetTap = useCallback(async (signalAssetId: string) => {
    const signalAsset = signalAssets.find((item) => item.id === signalAssetId);
    if (!signalAsset) return;

    const videoTrack = tracks.find((track) => track.type === 'video');
    if (!videoTrack) return;

    const result = await placeSignalAssetOnTimeline(signalAsset, videoTrack.id, playheadPosition, {
      addClip,
      addTextClip,
      updateTextProperties,
      updateClip,
    });
    if (result.clipId) {
      onClose();
    }
  }, [signalAssets, tracks, addClip, addTextClip, updateTextProperties, updateClip, playheadPosition, onClose]);

  // Format duration
  const formatDuration = (duration?: number) => {
    if (!duration) return '--:--';
    const mins = Math.floor(duration / 60);
    const secs = Math.floor(duration % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatSignalAssetMeta = (signalKinds: readonly string[], providerId?: string) => {
    const parts = signalKinds.length > 0 ? [...signalKinds] : ['signal'];
    if (providerId) parts.push(providerId);
    return parts.join(' / ');
  };

  return (
    <div
      className={`mobile-media-panel ${isOpen ? 'open' : ''}`}
      onClick={onClose}
    >
      <div className="mobile-media-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mobile-panel-header">
          <h3>Media</h3>
          <button className="mobile-panel-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Import button */}
        <button className="mobile-import-btn" onClick={handleImport}>
          + Import Media
        </button>

        {/* Media list */}
        <div className="mobile-media-list">
          {/* Compositions */}
          {compositions.length > 0 && (
            <div className="mobile-media-section">
              <div className="section-title">Compositions</div>
              {compositions.map((comp) => (
                <div
                  key={comp.id}
                  className="mobile-media-item composition"
                >
                  <div className="media-icon">🎬</div>
                  <div className="media-info">
                    <span className="media-name">{comp.name}</span>
                    <span className="media-meta">
                      {comp.width}×{comp.height} • {comp.frameRate}fps
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Media files */}
          <div className="mobile-media-section">
            <div className="section-title">Files ({files.length + signalAssets.length})</div>
            {files.length === 0 && signalAssets.length === 0 ? (
              <div className="mobile-media-empty">
                No media imported yet
              </div>
            ) : (
              <>
                {signalAssets.map((signalAsset) => (
                  <div
                    key={signalAsset.id}
                    className="mobile-media-item signal"
                    onClick={() => { void handleSignalAssetTap(signalAsset.id); }}
                  >
                    <div className="media-thumbnail">
                      <div className="media-icon">S</div>
                    </div>
                    <div className="media-info">
                      <span className="media-name">{signalAsset.name}</span>
                      <span className="media-meta">
                        {formatSignalAssetMeta(signalAsset.signalKinds, signalAsset.providerId)}
                      </span>
                    </div>
                  </div>
                ))}
                {files.map((file) => (
                <div
                  key={file.id}
                  className={`mobile-media-item ${file.type}`}
                  onClick={() => handleMediaTap(file.id)}
                >
                  <div className="media-thumbnail">
                    {file.thumbnailUrl ? (
                      <img
                        src={file.thumbnailUrl}
                        alt=""
                        onError={() => { void refreshFileUrls(file.id); }}
                      />
                    ) : (
                      <div className="media-icon">
                        {file.type === 'video' ? '🎥' : file.type === 'audio' ? '🎵' : '🖼️'}
                      </div>
                    )}
                  </div>
                  <div className="media-info">
                    <span className="media-name">{file.name}</span>
                    <span className="media-meta">
                      {file.type} • {formatDuration(file.duration)}
                    </span>
                  </div>
                </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
