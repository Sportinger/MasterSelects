# Media Discovery

[Back to Index](./README.md)

Discover is a dockable search and import panel for open media, meme templates,
and user-directed web downloads. It keeps catalog search separate from the
local Native Helper download path while presenting both in one workspace.

## Categories and filters

The compact category pills select Image, Video, or Audio. Each category has
content filters suited to editing work:

- Image: all, memes, GIFs, stickers, and reactions
- Video: all, memes, reactions, green screen, and overlays
- Audio: all, memes, reactions, sound effects, music, and viral sounds

The source pills can enable or disable compatible catalogs. Sources that do
not provide the selected media type remain visible but disabled, so the panel
does not imply unavailable coverage.

## Connected catalogs

| Source | Media | Rights handling |
|---|---|---|
| Wikimedia Commons | Image, video, audio | Open-license metadata and attribution are retained |
| Openverse | Image and audio | Results are restricted to accepted open licenses |
| Memegen.link | Meme image templates | Reuse rights are marked as unverified |
| Imgflip | Meme image templates | Reuse rights are marked as unverified |

Catalog files are fetched directly from their source and imported through the
normal Media pipeline. The durable media record stores source URL, provider,
creator when available, license, retrieval time, and rights status. Project
save/load preserves that record.

## Web downloads

Video and Audio expose a Web downloads section with YouTube, Instagram,
TikTok, and Other URL pills. The section reuses the Media Downloads composer,
format resolver, queue, and Native Helper connection state.

- YouTube keyword search first uses the connected Native Helper's local media-search capability. A configured YouTube Data API key under Settings > Integrations remains the fallback. Choosing a result places its watch URL into the local format chooser.
- Without a YouTube key, the panel opens the matching YouTube search in a new
  tab so the user can copy a result URL.
- Instagram and TikTok searches open on their respective signed-in websites.
  The chosen post URL is then pasted into the local format chooser.
- Other URL accepts any HTTP(S) source supported by the user's installed
  `yt-dlp`, including X, Facebook, Reddit, Vimeo, Twitch, and Dailymotion.

MasterSelects does not proxy these downloads through its production server.
Format inspection, resolution/codec selection, downloading, and file handoff
run through the Native Helper on the user's machine. Completed items enter the
shared download queue and are imported under Media/Downloads.

Downloaded media retains the selected source URL and platform with
`rights-unverified` provenance. This metadata is informational; users must
verify that they have the required rights before publishing or redistributing
the material.

## Failure behavior

- Catalogs resolve progressively, so one slow or failed provider does not hide
  completed results from another provider.
- Searches are abortable and report provider-specific timeouts or errors.
- Broken catalog thumbnails fall back to their original asset where possible.
- The download action stays disabled until Native Helper is connected and the
  selected URL's formats have resolved.
- Failed local downloads stay in the queue with Retry and Dismiss actions.

## Related features

- [Media Downloads](./Download-Panel.md)
- [Media Panel](./Media-Panel.md)
- [Native Helper](./Native-Helper.md)
- [Project Persistence](./Project-Persistence.md)
