# Media Downloads

[Back to Index](./README.md)

Paste and queue online video downloads through the Media panel, Native Helper, and `yt-dlp`.

---

## Overview

The Downloads prompt at the bottom of the Media panel is the active download surface. The surface supports:

- direct URL paste for YouTube and other `yt-dlp`-supported sites
- one-item format selection before queueing, including video recommendations and YouTube MP3 audio
- progress cards in the same Media tray queue used by AI generations
- up to two downloads running in parallel
- automatic import into Media once a download completes
- existing-download detection inside the current project before re-downloading

---

## Supported Platforms

The workflow detects common platforms up front and otherwise falls back to a generic `yt-dlp` flow.

| Platform | URL Detection | File System Access Project Subfolder |
|----------|---------------|-------------------|
| YouTube | `youtube.com`, `youtu.be` | `Downloads/YT/` |
| TikTok | `tiktok.com` | `Downloads/TikTok/` |
| Instagram | `instagram.com` | `Downloads/Instagram/` |
| Twitter / X | `twitter.com`, `x.com` | `Downloads/Twitter/` |
| Facebook | `facebook.com`, `fb.watch` | `Downloads/Facebook/` |
| Reddit | `reddit.com` | `Downloads/Reddit/` |
| Vimeo | `vimeo.com` | `Downloads/Vimeo/` |
| Twitch | `twitch.tv` | `Downloads/Twitch/` |
| Dailymotion | `dailymotion.com` | `Downloads/Other/` |
| Other | any other HTTP(S) URL | `Downloads/Other/` |

Any site that `yt-dlp` can fetch can be downloaded even if it is not listed in the table above.

---

## Input

### URL Paste

- Pasting one video URL in the Media panel prompt loads available helper recommendations before queueing
- The prompt shows the source title/uploader, resolution choices, video codec, audio handling, and whether the helper merges streams
- The prompt asks the Native Helper for format/info metadata for every URL; queue processing also tries YouTube oEmbed metadata before falling back to the helper

### YouTube Search Compatibility

- AI tools can search YouTube and keep results in the legacy in-memory `youtubeStore` for the current session
- The visible user workflow is URL-first from the Media panel Downloads prompt

---

## Native Helper Flow

Downloads require the Native Helper for the actual media transfer.
The helper status pill opens the Native Helper dialog for connection checks, downloads, and setup.

1. The Media Downloads prompt asks the helper for available format recommendations
2. The user picks a resolution/codec choice or the MP3 audio recommendation when available
3. The Media Downloads queue resolves metadata for the selected URL
4. The helper runs the bundled Windows `yt-dlp.exe` or a system `yt-dlp` with the selected `formatId`
5. Progress callbacks feed percent and transfer speed back into the shared Media queue
6. The downloaded file is fetched from the helper
7. In File System Access projects, the file is written into `Downloads/<Platform>/`
8. In Native Helper projects, the fetched helper file is imported through the normal project media copy path, so the durable media copy lives under `Raw/`
9. The saved/imported file is shown in the Media panel under a Downloads/platform folder

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

When a File System Access project is open, the queue checks whether `Downloads/<Platform>/<SanitizedTitle>.<extension>` already exists and imports that file instead of downloading it again. Native Helper projects copy completed helper downloads back through normal media import.

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

AI tools can use a direct download-and-import timeline flow. That path does not wait for the final file before showing something in the editor.

1. A pending download clip is inserted on the first video track at the requested time, or at the end of existing timeline content by default
2. The clip stores the source title, thumbnail, duration estimate, and download status
3. Progress updates stream into that pending clip while the helper is downloading
4. Once the file arrives, the pending clip is converted into a normal playable media clip
5. On failure, the clip stores the error state instead

---

## Format Selection

The Media panel prompt lists the helper's recommended formats for one pasted URL before the item enters the queue. Each option shows resolution, video codec, audio handling, and whether `yt-dlp` merges separate streams. Audio-only recommendations are shown as `Audio only` when the helper can find `ffmpeg`; they use the source's best audio stream converted to MP3. The selected recommendation's `formatId` is stored on the queue job and passed through to the helper download command.

AI tools can call `listVideoFormats` and pass a specific `formatId` to `downloadAndImportVideo`.

The helper recommends up to six non-AV1 video formats, ordered by available resolution and preferring H.264 within a resolution. It adds an MP3 audio option only when an audio stream and `ffmpeg` are available. The download command merges video downloads to MP4.

If no recommendations are available, the prompt can queue the helper default.

When a specific format is selected, the queue downloads the source instead of importing an existing title-matched project file, so the selected format is preserved.

If YouTube blocks anonymous extraction, the helper retries with Chrome cookies before failing.

---

## Project Storage

For File System Access projects, downloads are saved here:

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

File names are sanitized from the source title and saved with the downloaded extension, for example `.mp4`, `.webm`, `.m4a`, or `.mp3`.

For Native Helper-backed project persistence, completed downloads are fetched from the helper and then copied into the normal project media path under `Raw/`. The Media panel still groups the imported media under Downloads/platform folders for organization.

---

## Limitations

- The helper is required for the actual download path
- Non-YouTube metadata lookup also depends on the helper
- YouTube AI search requires a configured YouTube Data API key; the visible download flow accepts pasted HTTP(S) URLs
- Duplicate detection is filename/title based inside the File System Access project download folders; it is not a remote content hash

---

## Related Features

- [Media Panel](./Media-Panel.md)
- [Project Persistence](./Project-Persistence.md)
- [Native Helper](./Native-Helper.md)
