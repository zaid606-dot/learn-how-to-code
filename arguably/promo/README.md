# Promo videos

Made from the real app by `node scripts/make-promo.cjs` (about a minute each). Add `--frames 60`
to also save 60 evenly spaced 1080×1920 stills to `promo/frames/`.

| File | What it is | Use it for |
|---|---|---|
| `arguably-promo.webm` (`--fps 60`) | 27 s, 1080×1920, 60 fps: hook, the app in a phone, captions, end card | TikTok, Reels, Shorts ads |
| `arguably-app-capture.webm` (`--clean`) | 22 s, 30 fps, the app full screen, no captions | App Store preview (after converting), B-roll |

Only the AI's reply is canned (the built-in example verdict); every screen is the app as it runs.
The web fonts can't be downloaded on the build machine, so the capture uses a close system font.

## Convert to MP4 (H.264) for Instagram and the App Store

On a Mac with ffmpeg (`brew install ffmpeg`):

    ffmpeg -i arguably-promo.webm -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 \
      -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:a aac -b:a 256k arguably-promo.mp4

App Store previews must be 15–30 s, 30 fps, H.264, with an audio track (the silent one above
is fine), at 886×1920 for 6.9" iPhones: add `-vf "scale=886:1920"` for the app capture.
CapCut also opens the WebM files and exports MP4 if you'd rather edit there.

## 60 fps

`--fps 60` records the page in slow motion (2.5× slower: CSS animations, timers, clocks) and
lays the frames out at real speed, so each of the 60 frames a second is a separate render.
It takes about 4 minutes. Keep App Store previews at 30 fps (Apple's maximum).
