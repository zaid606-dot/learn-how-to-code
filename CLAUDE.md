# CLAUDE.md

## Design work: always use the design skills

This repo ships its own design skills in `.claude/skills/`, so they load in every
session (cloud or local) without any per-machine install.

For any website, landing page, UI, component, or visual design task:

1. **Impeccable** (`/impeccable`) is the primary design skill. Use it for new
   pages (`/impeccable init`, then `shape` or ordinary new work) and for refining
   existing UI (`critique`, `audit`, `polish`, `bolder`, `quieter`, `typeset`,
   `layout`, `animate`, etc.).
2. **Taste** (`/taste-skill`) runs alongside it as the anti-generic quality bar.
   Pick a style variant when the brief calls for one:
   - `/minimalist-skill`: clean editorial, warm monochrome
   - `/soft-skill`: premium, high-end agency feel
   - `/brutalist-skill`: raw, grid-heavy, terminal aesthetic
   - `/redesign-skill`: upgrading something that already exists
   - `/output-skill`: no truncated or placeholder code
3. Anthropic's `frontend-design` skill is the fallback when neither applies.

Hosting: deploy finished sites with the Netlify connector. Generate imagery with
the Higgsfield connector.

### Impeccable engine note

Impeccable's `scripts/impeccable` launcher downloads a prebuilt engine binary
from the project's GitHub releases on first run. It is not vendored here, and a
cloud session may not be allowed to run it. If it is unavailable, follow the
skill's "Launcher unavailable" path: read `PRODUCT.md` / `DESIGN.md` directly
and continue. The design guidance works without the engine; only the automated
detector and live-browser mode need it. The detector hooks from Impeccable's
own `settings.json` are intentionally **not** enabled in this repo.

### Updating the skills

Sources and pinned commits are listed in `.claude/skills/SOURCES.md`. To
update, re-copy from the upstream repos and bump the commit hashes there.
