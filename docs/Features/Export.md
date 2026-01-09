# Export

[← Back to Index](./README.md)

Frame-by-frame video export with H.264/VP9 encoding.

---

## Table of Contents

- [Export Panel](#export-panel)
- [Export Settings](#export-settings)
- [Export Process](#export-process)
- [Frame Export](#frame-export)

---

## Export Panel

### Location
- View menu → Export Panel
- Or dock panel tabs

### Panel Contents
- Resolution presets
- Frame rate options
- Quality/bitrate selection
- Time range (In/Out)
- Progress indicator
- Export/Cancel buttons

---

## Export Settings

### Resolution Presets
| Preset | Resolution |
|--------|------------|
| 4K | 3840×2160 |
| 1080p | 1920×1080 |
| 720p | 1280×720 |
| 480p | 854×480 |
| Custom | User-defined |

### Frame Rate
| Rate | Use Case |
|------|----------|
| 60fps | High motion |
| 30fps | Standard |
| 25fps | PAL |
| 24fps | Film |

### Codec Options
| Codec | Container | ID |
|-------|-----------|-----|
| H.264 | MP4 | avc1.640028 |
| VP9 | WebM | vp09.00.10.08 |

### Quality Presets
| Quality | Bitrate |
|---------|---------|
| Low | 5 Mbps |
| Medium | 15 Mbps |
| High | 25 Mbps |
| Maximum | 35 Mbps |

---

## Export Process

### Pipeline
```
1. Seek all clips to frame time
2. Build layer composition
3. Render via GPU engine
4. Read pixels (staging buffer)
5. Create VideoFrame
6. Encode frame
7. Write to muxer
8. Repeat for all frames
```

### Progress Tracking
- Frame counter: `X / Total`
- Percentage complete
- ETA (30-frame moving average)
- Cancel button

### Video Seeking
```typescript
// Per-clip seeking with timeout
- 1 second timeout per clip
- Handles reversed clips
- Respects track visibility
- Respects solo settings
```

### Key Frame Insertion
Every 30 frames (configurable).

---

## Frame Export

### Single Frame Export
Export current frame as PNG:
1. Position playhead
2. Click "Render Frame"
3. Downloads PNG file

### Technical Details
```typescript
// FrameExporter.ts
1. Call engine.render() at time
2. Create staging buffer
3. Copy texture to buffer
4. Map buffer for read
5. Create PNG blob
6. Trigger download
```

---

## Time Range

### Full Export
Exports entire composition duration.

### In/Out Export
Uses In/Out markers if set:
```typescript
startTime = inPoint ?? 0
endTime = outPoint ?? duration
```

### Setting In/Out
| Shortcut | Action |
|----------|--------|
| `I` | Set In point |
| `O` | Set Out point |
| `X` | Clear both |

---

## Output

### File Generation
- MP4 container for H.264
- WebM container for VP9
- Uses `mp4-muxer` library

### Download
Automatic browser download when complete:
```typescript
const blob = muxer.finalize();
const url = URL.createObjectURL(blob);
// Trigger download
```

---

## Estimated File Size

Panel shows estimated output size:
```
duration × frameRate × bitrate / 8
```

Example: 60s × 30fps × 15Mbps = ~112MB

---

## Troubleshooting

### Common Issues

| Problem | Solution |
|---------|----------|
| Black frames | Check layer visibility |
| Slow export | Reduce resolution |
| Export fails | Check codec support |
| Large file | Reduce bitrate |

### Browser Compatibility
- Requires WebCodecs API
- Chrome/Edge recommended
- Falls back gracefully

---

## Not Implemented

- Audio export (video only)
- ProRes/DNxHR codecs
- Multi-pass encoding
- Background export

---

## Related Features

- [Preview](./Preview.md) - Preview before export
- [Timeline](./Timeline.md) - Set In/Out points
- [GPU Engine](./GPU-Engine.md) - Rendering details

---

*Source: `src/engine/FrameExporter.ts`, `src/components/export/ExportPanel.tsx`*
