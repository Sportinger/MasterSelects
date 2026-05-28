# Media Downloads

[Back to Index](./README.md)

Paste and queue online video downloads through the Media panel, Native Helper, and `yt-dlp`.

---

## Overview

Downloads are no longer a standalone dock tab. The old `download` and `youtube` panel types are saved-layout migration targets; the active surface is the Downloads prompt at the bottom of the Media panel. The surface supports:

- direct URL paste for YouTube and other `yt-dlp`-supported sites
- one-video format selection before queueing
- progress cards in the same Media tray queue used by AI generations
- automatic import into Media once a download completes
- existing-download detection inside the current project before re-downloading

---

## Supported Platforms

The workflow detects common platforms up front and otherwise falls back to a generic `yt-dlp` flow.

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

## Input

### URL Paste

- Pasting one video URL in the Media panel prompt loads available helper recommendations before queueing
- The prompt shows the source title/uploader, resolution choices, video codec, audio handling, and whether the helper will merge streams
- YouTube URLs use the oEmbed metadata path first
- Pasting a non-YouTube URL asks the Native Helper for format/info metadata

### YouTube Search Compatibility

- AI tools can still search YouTube and persist results in the legacy `youtubeStore` project payload
- The visible user workflow is URL-first from the Media panel Downloads prompt

---

## Native Helper Flow

Downloads require the Native Helper for the actual media transfer.

1. The Media Downloads prompt asks the helper for available format recommendations
2. The user picks a resolution/codec choice
3. The Media Downloads queue resolves metadata for the selected URL
4. The helper runs the bundled Windows `yt-dlp.exe` or a system `yt-dlp` with the selected `formatId`
5. Progress callbacks feed percent and transfer speed back into the shared Media queue
6. The downloaded file is fetched from the helper
7. If a project is open, the file is written into `Downloads/<Platform>/`
8. The saved file is imported into the Media panel under a Downloads/platform folder

If no project is open, the downloaded file stays in memory as a `File`.

---

## Queue Cards

Each queue card can show:

- title, channel/uploader, thumbnail, and duration
- queued/downloading/ready/failed state
- queue time and download time
- transfer speed while downloading
- progress bar
- retry for failed downloads

When a project is open, the queue checks whether `Downloads/<Platform>/<SanitizedTitle>.mp4` already exists and imports that file instead of downloading it again.

---

## Download Progress

While a download is running:

- the card gets a downloading state
- the overlay shows percent complete
- transfer speed is displayed when the helper provides it
- the same progress/speed data is mirrored into pending timeline download clips when a download is started by the AI timeline tool

The helper-reported progress represents the whole pipeline, including download, processing, and final file handoff.

---

## Timeline Use

The Media panel prompt imports completed downloads into the Media panel. Drag the completed media item to the Timeline like any other imported file.

### Pending Clip Flow

AI tools can still use a direct download-and-import timeline flow. That path does not wait for the final file before showing something in the editor.

1. A pending download clip is inserted on the first video track at the current playhead
2. The clip stores the source title, thumbnail, duration estimate, and download status
3. Progress updates stream into that pending clip while the helper is downloading
4. Once the file arrives, the pending clip is converted into a normal playable media clip
5. On failure, the clip stores the error state instead

---

## Format Selection

The Media panel prompt lists the helper's recommended formats for one pasted URL before the item enters the queue. Each option shows resolution, video codec, audio handling, and whether `yt-dlp` will merge separate streams. The selected recommendation's `formatId` is stored on the queue job and passed through to the helper download command.

AI tools can still call `listVideoFormats` and pass a specific `formatId` to `downloadAndImportVideo`.

The recommended order is:

| Priority | Codec | Container | Reason |
|----------|-------|-----------|--------|
| 1 | H.264 | MP4 | best browser/export compatibility |
| 2 | VP9 | WebM | good fallback quality |
| 3 | AV1 | WebM | compression-efficient but more compatibility-sensitive |

If no recommendations are available, the prompt can still queue the helper default.

When a specific format is selected, the queue re-downloads the source instead of importing an existing title-matched project file, so a previous lower-resolution download is not reused for a new format choice.

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
