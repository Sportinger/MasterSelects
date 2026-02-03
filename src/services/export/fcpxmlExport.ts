// FCP XML Export Service
// Exports timeline to Final Cut Pro X XML format (FCPXML 1.10)
// Compatible with: Final Cut Pro X, DaVinci Resolve, Premiere Pro

import type { TimelineClip, TimelineTrack } from '../../types';
import { useMediaStore } from '../../stores/mediaStore';
import { Logger } from '../logger';

const log = Logger.create('FCPXMLExport');

export interface FCPXMLExportOptions {
  projectName?: string;
  frameRate?: number;
  width?: number;
  height?: number;
  includeAudio?: boolean;
}

interface AssetInfo {
  id: string;
  name: string;
  duration: string;
  hasVideo: boolean;
  hasAudio: boolean;
  format: string;
  src?: string;
}

/**
 * Convert seconds to FCPXML time format (rational number).
 * Example: 10 seconds at 30fps = "300/30s" or simplified "10s"
 */
function toFCPTime(seconds: number, fps: number = 30): string {
  // Use frame-accurate rational representation
  const frames = Math.round(seconds * fps);
  return `${frames}/${fps}s`;
}

/**
 * Convert frame rate to FCPXML frameDuration format.
 * Example: 30fps = "100/3000s", 29.97fps = "1001/30000s"
 */
function toFrameDuration(fps: number): string {
  // Handle common NTSC rates
  if (Math.abs(fps - 29.97) < 0.01) {
    return '1001/30000s';
  }
  if (Math.abs(fps - 59.94) < 0.01) {
    return '1001/60000s';
  }
  if (Math.abs(fps - 23.976) < 0.01) {
    return '1001/24000s';
  }
  // Integer frame rates
  return `100/${fps * 100}s`;
}

/**
 * Escape XML special characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate a unique resource ID.
 */
function generateResourceId(index: number): string {
  return `r${index}`;
}

/**
 * Build asset info from clips.
 */
function buildAssetMap(
  clips: TimelineClip[],
  tracks: TimelineTrack[]
): Map<string, AssetInfo> {
  const assets = new Map<string, AssetInfo>();
  let assetIndex = 2; // r1 is reserved for format

  for (const clip of clips) {
    // Skip compositions and text clips
    if (clip.isComposition || clip.source?.type === 'text') continue;

    // Use mediaFileId or clip id as key
    const key = clip.mediaFileId || clip.id;

    if (!assets.has(key)) {
      const track = tracks.find(t => t.id === clip.trackId);
      const isAudio = track?.type === 'audio' || clip.source?.type === 'audio';
      const isVideo = !isAudio && clip.source?.type === 'video';

      const naturalDuration = clip.source?.naturalDuration || clip.outPoint;

      assets.set(key, {
        id: generateResourceId(assetIndex++),
        name: clip.name || `Clip ${assetIndex}`,
        duration: toFCPTime(naturalDuration),
        hasVideo: isVideo,
        hasAudio: isAudio || (isVideo && !!clip.linkedClipId),
        format: 'r1',
        src: clip.file?.name,
      });
    }
  }

  return assets;
}

/**
 * Export timeline to FCPXML format.
 */
export function exportToFCPXML(
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  timelineDuration: number,
  options: FCPXMLExportOptions = {}
): string {
  const {
    projectName = 'MasterSelects Export',
    frameRate = 30,
    width = 1920,
    height = 1080,
    includeAudio = true,
  } = options;

  log.info('Exporting to FCPXML', {
    clips: clips.length,
    tracks: tracks.length,
    duration: timelineDuration,
    frameRate,
  });

  // Filter clips
  const videoTracks = tracks.filter(t => t.type === 'video');

  const videoClips = clips.filter(c => {
    const track = tracks.find(t => t.id === c.trackId);
    return track?.type === 'video' && !c.isComposition && c.source?.type !== 'text';
  });

  const audioClips = includeAudio ? clips.filter(c => {
    const track = tracks.find(t => t.id === c.trackId);
    return track?.type === 'audio';
  }) : [];

  // Build asset map
  const assetMap = buildAssetMap([...videoClips, ...audioClips], tracks);

  // Calculate timeline duration in FCPXML format
  const fcpDuration = toFCPTime(timelineDuration, frameRate);
  const frameDuration = toFrameDuration(frameRate);

  // Build XML
  const lines: string[] = [];

  // XML declaration and root
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<!DOCTYPE fcpxml>');
  lines.push('<fcpxml version="1.10">');

  // Resources section
  lines.push('  <resources>');

  // Format resource (video settings)
  lines.push(`    <format id="r1" name="FFVideoFormat${height}p${Math.round(frameRate)}" frameDuration="${frameDuration}" width="${width}" height="${height}"/>`);

  // Asset resources (media files)
  for (const [, asset] of assetMap) {
    const audioChannels = asset.hasAudio ? ' audioChannels="2" audioSampleRate="48000"' : '';
    const hasVideo = asset.hasVideo ? ' hasVideo="1"' : '';
    const hasAudio = asset.hasAudio ? ' hasAudio="1"' : '';

    lines.push(`    <asset id="${asset.id}" name="${escapeXml(asset.name)}" duration="${asset.duration}" format="r1"${hasVideo}${hasAudio}${audioChannels}>`);
    lines.push(`      <media-rep kind="original-media" src="file://./${escapeXml(asset.src || asset.name)}"/>`);
    lines.push('    </asset>');
  }

  lines.push('  </resources>');

  // Library > Event > Project structure
  lines.push(`  <library>`);
  lines.push(`    <event name="${escapeXml(projectName)}">`);
  lines.push(`      <project name="${escapeXml(projectName)}">`);

  // Sequence (timeline)
  lines.push(`        <sequence format="r1" duration="${fcpDuration}" tcStart="0s" tcFormat="NDF">`);
  lines.push('          <spine>');

  // Sort video clips by start time and track (higher tracks = lower index in FCPXML)
  const sortedVideoClips = [...videoClips].sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime - b.startTime;
    const aTrackIdx = videoTracks.findIndex(t => t.id === a.trackId);
    const bTrackIdx = videoTracks.findIndex(t => t.id === b.trackId);
    return aTrackIdx - bTrackIdx;
  });

  // Track which time we're at in the spine
  let spineTime = 0;

  for (const clip of sortedVideoClips) {
    const assetKey = clip.mediaFileId || clip.id;
    const asset = assetMap.get(assetKey);
    if (!asset) continue;

    // Add gap if needed
    if (clip.startTime > spineTime) {
      const gapDuration = toFCPTime(clip.startTime - spineTime, frameRate);
      lines.push(`            <gap offset="${toFCPTime(spineTime, frameRate)}" duration="${gapDuration}"/>`);
      spineTime = clip.startTime;
    }

    const offset = toFCPTime(clip.startTime, frameRate);
    const start = toFCPTime(clip.inPoint, frameRate);
    const duration = toFCPTime(clip.duration, frameRate);

    // Check for linked audio
    const hasLinkedAudio = includeAudio && clip.linkedClipId;

    if (hasLinkedAudio) {
      // Video with attached audio
      lines.push(`            <asset-clip ref="${asset.id}" offset="${offset}" name="${escapeXml(clip.name)}" start="${start}" duration="${duration}" tcFormat="NDF">`);

      // Add audio component
      const linkedClip = clips.find(c => c.id === clip.linkedClipId);
      if (linkedClip) {
        lines.push(`              <audio lane="-1" offset="${offset}" ref="${asset.id}" srcCh="1, 2" duration="${duration}"/>`);
      }

      lines.push('            </asset-clip>');
    } else {
      // Video only
      lines.push(`            <asset-clip ref="${asset.id}" offset="${offset}" name="${escapeXml(clip.name)}" start="${start}" duration="${duration}" tcFormat="NDF"/>`);
    }

    spineTime = clip.startTime + clip.duration;
  }

  // Add standalone audio clips (not linked to video)
  const standaloneAudioClips = audioClips.filter(c => !videoClips.some(v => v.linkedClipId === c.id));

  for (const clip of standaloneAudioClips) {
    const assetKey = clip.mediaFileId || clip.id;
    const asset = assetMap.get(assetKey);
    if (!asset) continue;

    const offset = toFCPTime(clip.startTime, frameRate);
    const start = toFCPTime(clip.inPoint, frameRate);
    const duration = toFCPTime(clip.duration, frameRate);

    // Audio on separate lane
    lines.push(`            <audio lane="-2" offset="${offset}" ref="${asset.id}" name="${escapeXml(clip.name)}" start="${start}" duration="${duration}" srcCh="1, 2"/>`);
  }

  lines.push('          </spine>');
  lines.push('        </sequence>');
  lines.push('      </project>');
  lines.push('    </event>');
  lines.push('  </library>');
  lines.push('</fcpxml>');
  lines.push('');

  const xml = lines.join('\n');
  log.info('FCPXML export complete', { size: xml.length });

  return xml;
}

/**
 * Export and download FCPXML file.
 */
export function downloadFCPXML(
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  timelineDuration: number,
  options: FCPXMLExportOptions = {}
): void {
  const projectName = options.projectName || 'MasterSelects Export';
  const xml = exportToFCPXML(clips, tracks, timelineDuration, options);

  // Create blob and download
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectName}.fcpxml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  log.info('FCPXML downloaded', { filename: `${projectName}.fcpxml` });
}

/**
 * Get current composition info from media store for export.
 */
export function exportCurrentComposition(options: FCPXMLExportOptions = {}): void {
  const mediaStore = useMediaStore.getState();
  const { useTimelineStore } = require('../../stores/timeline');
  const timelineStore = useTimelineStore.getState();

  const activeComp = mediaStore.getActiveComposition();

  downloadFCPXML(
    timelineStore.clips,
    timelineStore.tracks,
    timelineStore.duration,
    {
      projectName: activeComp?.name || 'MasterSelects Export',
      frameRate: activeComp?.frameRate || 30,
      width: activeComp?.width || 1920,
      height: activeComp?.height || 1080,
      ...options,
    }
  );
}
