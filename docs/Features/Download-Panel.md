# Download Panel

[Back to Index](./README.md)

Search, inspect, download, and timeline-import online videos through the Native Helper and `yt-dlp`.

---

## Overview

The Download panel and the older YouTube-labeled panel share the same implementation. The surface supports:

- direct URL paste for YouTube and other `yt-dlp`-supported sites
- YouTube keyword search when a YouTube Data API key is configured
- quality selection through the Native Helper
- download-only and add-to-timeline flows
- existing-download detection inside the current project
- re-download and copy-URL actions from each result card

---

## Supported Platforms

The panel detects common platforms up front and otherwise falls back to a generic `yt-dlp` flow.

| Platform | URL Detection | Project Subfolder |
|----------|---------------|-------------------|
| YouTube | `youtube.com`, `youtu.be` | `Downloads/YT/` |
| TikTok | `tiktok.com` | `Downloads/TikTok/` |
| Instagram | `instagram.com` | `Downloads/Instagram/` |
| Twitter / X | `twitter.com`, `x.com` | `Downloads/Twitter/` |
| Facebook | `facebook.com`, `fb.watch` | `Downloads/Facebook/` |
| Reddit | `reddit.com` | `Downloads/Reddit/` |
| Vimeo | `vimeo.com` | `Downloads/Vimeo/` |
| Twitch | `twitch.tv` | `Downloads/Twitch/` |
| Other | any other HTTP(S) URL | `Downloads/Other/` |

Any site that `yt-dlp` can fetch can still be downloaded even if it is not listed in the table above.

---

## Input Modes

### URL Paste

- Pasting a YouTube URL or 11-character video ID uses the oEmbed metadata path first
- Pasting a non-YouTube URL asks the Native Helper for format/info metadata
- Optional `Auto Download` starts the download immediately after paste when the helper is connected

### YouTube Search

- Requires the YouTube Data API key in Settings
- Search results are persisted in `youtubeStore` with the project
- Search is YouTube-only; other platforms are URL-first

---

## Native Helper Flow

Downloads require the Native Helper for the actual media transfer.

1. The panel asks the helper for available formats
2. The helper runs `yt-dlp`
3. Progress callbacks feed percent and transfer speed back into the panel
4. The downloaded file is fetched from the helper
5. If a project is open, the file is written into `Downloads/<Platform>/`
6. The saved file can then be imported to the media pool and/or converted into a real timeline clip

If no project is open, the downloaded file stays in memory as a `File`.

---

## Result Cards

Each result card can show:

- title, channel/uploader, thumbnail, and duration
- a downloaded badge when the file already exists in the open project
- a download button
- a re-download button once the file is already present
- an add-to-timeline button
- a copy-URL button

When a project is open, the panel checks whether `Downloads/<Platform>/<SanitizedTitle>.mp4` already exists and marks matching cards as downloaded.

---

## Download Progress

While a download is running:

- the card gets a downloading state
- the overlay shows percent complete
- transfer speed is displayed when the helper provides it
- the same progress/speed data is mirrored into pending timeline download clips when the download started from `Add to Timeline`

The helper-reported progress represents the whole pipeline, including download, processing, and final file handoff.

---

## Add To Timeline

`Add to Timeline` does not wait for the final file before showing something in the editor.

### Pending Clip Flow

1. A pending download clip is inserted on the first video track at the current playhead
2. The clip stores the source title, thumbnail, duration estimate, and download status
3. Progress updates stream into that pending clip while the helper is downloading
4. Once the file arrives, the pending clip is converted into a normal playable media clip
5. On failure, the clip stores the error state instead

### Drag Behavior

- Not-yet-downloaded cards are visual drag sources only
- Already-downloaded cards are pre-imported into the media store
- Once pre-imported, dragging the card to the timeline uses the real media-file drag payload instead of starting a new URL-only flow

---

## Format Selection

When the helper can enumerate formats, the panel opens a quality dialog before download/timeline import.

The recommended order is:

| Priority | Codec | Container | Reason |
|----------|-------|-----------|--------|
| 1 | H.264 | MP4 | best browser/export compatibility |
| 2 | VP9 | WebM | good fallback quality |
| 3 | AV1 | WebM | compression-efficient but more compatibility-sensitive |

If no recommendations are available, the panel falls back to the helper default.

If YouTube blocks anonymous extraction, the helper retries with Chrome cookies before failing.

---

## Project Storage

When a project is open, downloads are saved here:

```text
ProjectFolder/
  Downloads/
    YT/
    TikTok/
    Instagram/
    Twitter/
    Facebook/
    Reddit/
    Vimeo/
    Twitch/
    Other/
```

File names are sanitized from the source title and saved as `.mp4`.

---

## Limitations

- The helper is required for the actual download path
- Non-YouTube metadata lookup also depends on the helper
- Search without a YouTube API key is limited to pasted URLs/IDs
- Duplicate detection is filename/title based inside the project download folders; it is not a remote content hash

---

## Related Features

- [Media Panel](./Media-Panel.md)
- [Project Persistence](./Project-Persistence.md)
- [Native Helper](./Native-Helper.md)
