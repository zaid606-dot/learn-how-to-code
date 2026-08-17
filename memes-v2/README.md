# Strech — Meme System v2

Redesigned viral meme set for **Strech** ("Owning a home shouldn't require managing one").
Six format-native homeowner memes at **1080 × 1080** (Instagram / X / LinkedIn / Threads),
built in Strech's premium frame — *deadpan luxury*: the joke is loud, the design never is.

## Why v2

The first pass (see the original `strech-card-*` spec) ran a four-beat **insight-card**
anatomy — quiet label → painful truth → aching serif turn → whisper logo. Beautiful, but it
makes you *exhale*, not *screenshot*. No recognizable meme format, no reason to tag a friend,
and the brand sat in a corner as a footnote.

v2 keeps the restraint and borrows the scaffolds that actually travel:

| # | File | Format | The joke |
|---|------|--------|----------|
| 01 | `strech-meme-01-pov-facilities-manager` | POV | You're the unpaid facilities manager of a building you also live in |
| 02 | `strech-meme-02-nobody-water-heater` | Nobody: | The water heater picks 2 a.m. before ten guests to "go" |
| 03 | `strech-meme-03-same-picture` | They're the same picture | "I'll do it this weekend" = "I'll never do it" |
| 04 | `strech-meme-04-just-book-it` | Drake / escalation | Three dead ends struck through, one green fix |
| 05 | `strech-meme-05-gutters-text` | Text thread | "yeah all handled 👍" — a lie, eight months running |
| 06 | `strech-meme-06-arrival-window` | Time-theft | The 8-to-4 window draining a whole Saturday |

## Logo, promoted

The mark works four ways instead of hiding in a corner:

1. **The lockup** — the footer signature repeated across the set (recognition reflex).
2. **The ghost** — blown up as a faint faceted-glass watermark = premium texture.
3. **The answer** — on card 04 the mark *is* the green ✓ (the option that works).
4. **The seam** — on card 03 it hides in the gap you're told to inspect.

## Brand tokens

- **Color:** green `#16A34A` · pine `#0B2412` · paper `#F6F3EC` · mint `#E4F7EC` · gold `#C9A227` · ink `#16211A`
- **Type:** Lora (serif display + wordmark, every punchline) · Albert Sans (labels / UI / scaffolding)
- Green is reserved for the single payoff line per square.

## Formats

- **1080 × 1080** (square) — feed, X, LinkedIn, Threads → files in this folder
- **1080 × 1920** (9:16 Reels) — Reels, Stories, TikTok, Shorts → `reels/` folder

The Reels versions are rebuilt for the vertical frame (bigger type, layouts reflowed,
"same picture" panels stacked), not stretched. Copy sits in the center safe zone, clear
of Instagram's top bar and bottom caption / action column.

## Files

- `strech-meme-0*.svg` / `.png` — 1080×1080 editable source + export
- `reels/strech-reel-0*.svg` / `.png` — 1080×1920 editable source + export
- `generate.py` — regenerates the square SVGs
- `generate_reels.py` — regenerates the 9:16 SVGs
- `showcase.html` — self-contained gallery + strategy write-up (both formats)

## Edit the copy / layout

Two ways, both easy in Cursor:

1. **Fastest — edit the SVG directly.** Open any `strech-meme-0*.svg` (square) or
   `reels/strech-reel-0*.svg` (Reels). The headline, sub-line, colors, and coordinates
   are plain `<text>` / hex values — change the words in place and save.
2. **Regenerate from source.** Edit the copy strings in `generate.py` (square) or
   `generate_reels.py` (Reels), then:

   ```bash
   cd memes-v2
   python3 generate.py          # rewrites the square SVGs
   python3 generate_reels.py    # rewrites the reels/ SVGs
   ```

To re-export PNGs, render each SVG at its native size (any SVG→PNG tool or headless browser).
