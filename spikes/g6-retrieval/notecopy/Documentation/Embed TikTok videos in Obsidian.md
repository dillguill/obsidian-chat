---
title: Embed TikTok videos in Obsidian
source: https://craftbyzen.com/curation/stream/link/2024-06-20t202410374z/
cover: https://images.unsplash.com/photo-1507755106772-16c7f7a80feb?q=80&w=2437&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D
author:
  - "[[Jeremy Wong]]"
published: 2025-05-27
description: How to embed TikTok videos in Obsidian’s editing/live preview and reading mode.
type: doc
tags: [obsidian, tiktok]
---
How to embed TikTok videos in Obsidian’s editing/live preview and reading mode.

```html
<iframe
src="https://www.tiktok.com/player/v1/7382225350710824222?autoplay=0"
allow="fullscreen"
style="width:100%;height:50vh;"
/>
```

where `7382225350710824222` is the video id you get from TikTok from this example link: `https://www.tiktok.com/@_jen_hamilton_/video/7382225350710824222`.

The TikTok v1 player has a bunch of controls that you can use to modify from this [documentation](https://developers.tiktok.com/doc/embed-player#customize_the_player_).

There’s still some wonky height issues, and I suspect this is the default height Obsidian has on the container around the editor. I gave it a good enough viewable height of `50vh`, which should be enough.

## Reference links

- [How do I embed TikTok Videos? - Help - Obsidian Forum](https://forum.obsidian.md/t/how-do-i-embed-tiktok-videos/13532/1)
- [Emedding TikTok Videos - Help - Obsidian Forum](https://forum.obsidian.md/t/emedding-tiktok-videos/63032)
- [html - How to stop auto play in an embedded video? - Stack Overflow](https://stackoverflow.com/questions/76249039/how-to-stop-auto-play-in-an-embedded-video)
- [TikTok for Developers](https://developers.tiktok.com/doc/embed-player)