# Arguably

Drop in screenshots of a text argument (from one or both people's phones). An AI referee reads them and tells you:

- **Origin**: the message that sparked it, what it's really sprouting from, and each escalation point
- **Winner**: who argued better, with a confidence score and per-person strengths and weaknesses
- **Subjects**: the main topics compared side by side, with who has the edge on each
- **Names**: everyone in the conversation and where their name came from in the screenshot
- **Grudges**: old incidents dragged into this fight
- **Personal shots**: attacks on the person instead of the point
- **Logical fallacies**: named, quoted, and explained
- **Fix it**: a practical way to resolve it

Mobile-first web app, installable to the home screen (PWA), styled with the EMBER brand system (tokens live at the top of `public/styles.css`; logo marks and icon variants in `public/brand/`). The logo is two overlapping speech bubbles (coral `#FF5A47`, navy `#252668`) with a balance scale; the app reuses those two colors for the two sides of an argument. Screenshots are resized in the browser before upload and are not stored. The last 10 verdicts (text only) are kept in the browser's localStorage.

## Run it

Requires Node 20+ and an Anthropic API key.

```bash
cd arguably
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start            # http://localhost:3000
```

To open it on your phone, run it on your computer and visit `http://<your-computer's-LAN-IP>:3000` from the phone on the same Wi-Fi, or deploy it to any Node host (Render, Railway, Fly.io).

**No key yet?** `npm run mock` runs the full UI with a canned verdict.

## Use it without a server (claude.ai Artifact)

`node scripts/build-artifact.mjs` builds `dist/arguably.html` from `artifact/` (chat UI) plus the shared styles, schema and prompt. It's a chat app: send screenshots or paste the conversation, get the verdict as a message, then ask follow-ups (who should apologize, draft a reply, and so on). It talks to Claude through the Artifact `sample` capability, so published as a claude.ai Artifact with `capabilities: {sample: {}}` it runs on the signed-in viewer's own Claude plan with no API key or hosting. How screenshots are handled (`artifact/pipeline.cjs`, tested in `test/pipeline.test.js`):

1. On the device: duplicates are skipped, and tall screenshots are cut in the blank space between bubbles so text stays readable at Claude's image size.
2. Claude reads every message in batches (as many images per call as the view allows), so up to 30 screenshots can go in at once.
   Where the view can't send images to Claude (the Claude iPhone app), the phone reads the text itself with Tesseract (on-device OCR in a Web Worker, dark mode handled), and Claude rebuilds the messages from the text and each line's position. Run `scripts/fetch-ocr.sh` once before building; the OCR files in `dist/ocr/` are published alongside the page.
3. "Who's who": each phone shows its owner on the right, so names are inferred per phone from the chat header and confirmed by the person before judging.
4. Both phones are merged into one transcript using overlapping messages, in any import order; stretches that don't overlap are marked as possible gaps.
5. Claude judges the transcript. Every quote in the verdict is checked against it, and quotes that can't be found are flagged. Follow-up questions get the full transcript.

## How it works

- `public/`: the frontend (plain HTML/CSS/JS, no build step)
- `server.js`: static file server + `POST /api/analyze` (uses only Node built-ins plus the Anthropic SDK)
- `src/analyze.js`: builds the Claude request: images plus a referee system prompt, adaptive thinking, and a strict JSON-schema structured output
- `src/schema.js`: the verdict schema the UI renders
- `test/`: `npm test` (unit tests). `npm run test:e2e` runs the Artifact build end to end in a phone-sized Chromium with a fake Claude (`test/e2e/stub.js`): home screen, both-phones import, who's who, verdict, follow-ups, on-device reading, paste, and error handling.

Settings: `PORT` (default 3000), `ARGUABLY_MODEL` (default `claude-opus-5`), `ARGUABLY_MOCK=1`.

The request opts into server-side refusal fallbacks (`fallbacks: "default"`), so if the primary model declines a request, the API retries it on a suitable fallback model within the same call.

## Brand notes

- Fonts load from Google Fonts (Sora, Inter). Self-host them before production, as the brand system recommends.
- The brand's `success` and `warning` colors fall below 4.5:1 on their soft backgrounds (4.47:1 and 4.26:1), so status tags use ink text with a colored symbol instead.
- The brand's secondary-button spec calls for an `ember-200` border, which the palette doesn't define; `ember-300` (Clay) is used instead.

## Your own website (Vercel + Groq)

The same app, on its own URL, with no Claude account needed. Verdicts run on Groq (default) or Grok through
two small server functions (`api/json.js`, `api/chat.js`) that hold the xAI key. The key
never reaches the browser.

1. In Vercel: **Add New… → Project → Import** this GitHub repo.
2. **Root Directory:** `arguably`. Leave the framework as **Other**; `vercel.json` sets the
   build (`scripts/fetch-ocr.sh` + `node scripts/build-artifact.mjs --web`) and output (`web-dist`).
3. **Environment Variables:** add `GROQ_API_KEY` (console.groq.com) or `XAI_API_KEY` (console.x.ai). Optional:
   `AI_MODEL` (default `qwen/qwen3.8-27b` on Groq, `grok-4.7` on xAI), `AI_FAST_MODEL`, `RATE_LIMIT_PER_10_MIN` (default 40).
4. **Deploy.** Share the `*.vercel.app` URL. On a phone, Share → Add to Home Screen makes it
   open like an app.

Every verdict is billed to that key. Set a spending limit in the provider console:
the built-in per-visitor rate limit is a brake, not a budget.

Build it locally: `node scripts/build-artifact.mjs --web` → `web-dist/`.

### Same screenshots, same verdict (the verdict vault)

A verdict is locked to what it judged: the screenshots' pixels (in any order), the names confirmed
in who's who, any pasted text, the note, the tone and the judge's instructions. The first verdict
for that combination is the one everyone gets, on any phone, instead of asking the AI again.

- On each phone, verdicts are reused from the chats saved there (always on).
- Across phones (website only), turn on the vault: in Vercel, open the project → Storage →
  Upstash for Redis (free plan) → connect it to this project. That adds `KV_REST_API_URL` and
  `KV_REST_API_TOKEN`; redeploy. The server stores only a hash as the name and the verdict
  encrypted with a key made from the conversation, so it can't read either. Without it, `/api/verdicts`
  answers 404 and each phone keeps its own verdicts.

### Accounts

Optional email + password accounts on the website (Settings › Account) save chats and settings
and sync them across phones. They use the same Upstash storage as the verdict vault, so they
switch on with it. Passwords are stored only as salted scrypt hashes; sessions are random tokens
in an HttpOnly cookie, stored server-side only as hashes. Delete account (Settings › Account)
erases the account, its chats and settings, and every session.

- **Forgot password** needs an email service: create a free [Resend](https://resend.com) account,
  add `RESEND_API_KEY` (and `MAIL_FROM`, e.g. `Arguably <hello@yourdomain.com>` once your domain is
  verified in Resend) and `APP_URL` (e.g. `https://arguably-gold.vercel.app`) in Vercel, redeploy.
  Without it, the app tells people to email support.
- **Recovery codes** are the no-email way back in. Accounts made before they existed are asked
  (once, and in Settings › Account) to set one up.
- **Cleanup**: on Blob storage, a daily Vercel Cron (`/api/cleanup`, see `vercel.json`) deletes
  expired sign-ins, lockout counters, reset links and old reports. It runs only with the
  `CRON_SECRET` environment variable set (Vercel sends it with each cron call).
- **When the AI is busy** (the per-minute budget is shared by everyone), the app waits and tries
  again by itself, up to about 2½ minutes, showing a countdown instead of an error.

## The iPhone app (App Store)

`ios-app/` wraps the live website in a native iPhone shell (Capacitor). Inside it the website
switches to App Store mode by itself: hard paywall ($9.99/mo, $29.99/yr with a 3-day trial),
purchases through Apple via RevenueCat (checked at every launch, so ended subscriptions end Pro),
and the iPhone share sheet. Accounts, sync, the vault and the AI work exactly as on the website.

1. **Apple** — [Apple Developer Program](https://developer.apple.com/programs/) ($99/yr). In
   App Store Connect create the app (bundle ID `app.arguably.ios`) and a subscription group with
   `arguably.pro.monthly` ($9.99) and `arguably.pro.yearly` ($29.99, introductory offer: 3-day free
   trial). Add Privacy Policy and Support URLs.
2. **RevenueCat** (free until $2.5k/mo) — new project → iOS app with your App Store Connect key →
   entitlement **`pro`** → attach both products → an offering with both packages. Copy the
   **public iOS SDK key** (starts with `appl_`) into Vercel as `REVENUECAT_IOS_KEY`, redeploy.
3. **Build** on a Mac with Xcode: `cd ios-app && bash setup.sh`, then `npx cap open ios`. In
   Xcode: your Team under Signing & Capabilities, add **In-App Purchase**, set the app icon
   (1024×1024), then Product › Archive → TestFlight.
4. **Before submitting** — test a sandbox purchase, restore and cancel in TestFlight; fill in App
   Privacy (User Content and Photos, used for App Functionality, not linked for tracking; email
   if accounts are on); age rating 13+ or higher; point the support email at a real inbox.

The app loads `https://arguably-gold.vercel.app` (see `ios-app/capacitor.config.json`); switch it
to your own domain once you have one.
