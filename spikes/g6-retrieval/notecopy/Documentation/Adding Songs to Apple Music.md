---
type: doc
tags: ["apple-music"]
---

# Adding Songs to Apple Music (iCloud Music Library)

## Normal flow
1. Drag the audio file into the Music app window (or File > Add to Library > choose the file).
2. Apple Music either:
   - **Matches** it against Apple's catalog (fast, links to Apple's copy, no upload of your file), or
   - **Uploads** your actual file if it can't find a match (common for indie/rare tracks, rips, non-Store sourced audio).
3. Trigger **File > Library > Update Cloud Library** to kick off the sync check.
4. Check the **iCloud Status** column (Songs view > right-click column header > enable it) to confirm it reached "Uploaded"/"Matched" rather than sitting at "Waiting" or "Error".

## Gotchas that cause silent upload failures for a specific song
- **Bitrate must be above 96 Kbps.**
- **File must be under 200MB and under 2 hours long.**
- **Clean container/encoding matters.** Files from YouTube-to-MP3 tools or rippers sometimes carry leftover MP4/container metadata jammed into the MP3's ID3 tags (e.g. `major_brand`/`isom` fields showing up as `TXXX` frames), which can confuse the eligibility check even when bitrate/size/duration are fine. Re-encode cleanly before uploading if the source was a video-to-audio converter:
  ```
  afconvert -f m4af -d aac -b 256000 in.mp3 out.m4a
  ```

## If it's a library-wide error, not one song
Alert: *"Cloud Music Library can't be updated because Apple Music doesn't recognize your Music Library"* — this is an **account-level auth desync**, not a file problem. No documented per-track cause found anywhere in Apple's own community threads for this specific message.
- Toggling Sync Library off/on does **not** reliably fix it.
- What worked: full **Account > Sign Out**, quit Music, reopen, **Account > Sign In** (re-enter Apple ID + 2FA), then wait a few minutes without touching anything.
