# hooplens (basketball analytics MVP)

A youth/club basketball team analytics platform: coach-entered stat tracking,
video-linked shot/event tagging (via YouTube), per-game box scores, and
season performance aggregation.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS
- Prisma + Postgres (a free-tier host like [Neon](https://neon.tech) or
  [Supabase](https://supabase.com) works fine — see Deploying to Vercel
  below; use the same connection string for local dev too, there's no
  local-only database)
- Custom cookie-session auth (bcrypt + signed JWT), no third-party auth
  service

## Getting started

```bash
npm install
cp .env.example .env   # set a real DATABASE_URL (Postgres), AUTH_SECRET, and ANTHROPIC_API_KEY
npx prisma db push     # syncs the schema to your Postgres database
npm run dev
```

The "Suggested moments" video analysis feature additionally requires
`yt-dlp` and `ffmpeg` to be installed on the host (used to download the
linked YouTube video and sample frames — see the Video analysis section
below for why, and its deployment implications).

Open http://localhost:3000 — sign up, create a team, add players, add a
match (optionally paste a YouTube link to the game film), then tag stats
against it. Box scores show up under Stats, season aggregates under
Performance, and AI-generated analysis under Insights (once
`ANTHROPIC_API_KEY` is set — without it, Insights shows a "not configured"
state instead of erroring).

## Deploying to Vercel

This has to be done from your own Vercel account — an AI coding session
can't authenticate as you or click through vercel.com. Steps:

1. **Get a Postgres database.** Easiest: [neon.tech](https://neon.tech) →
   new project → copy the connection string (use the "pooled connection"
   one, and keep `?sslmode=require`).
2. **Import the repo.** vercel.com → Add New → Project → import
   `leolu0421/basketballanalysis` → select the `claude/sports-stats-platform-plan-2q2xkq`
   branch (or merge it to `main` first if you'd rather deploy from there).
3. **Set environment variables** in the Vercel project settings, before
   the first deploy:
   - `DATABASE_URL` — the Neon connection string from step 1
   - `AUTH_SECRET` — any long random string (e.g. `openssl rand -hex 32`)
   - `ANTHROPIC_API_KEY` — your Anthropic API key, for Insights to work
   - `RESEND_API_KEY` — a free [resend.com](https://resend.com) API key, for
     "Forgot password" emails to send (see Password reset section below)
4. **Deploy.** Vercel picks up the `vercel-build` script automatically
   (`prisma generate && prisma db push && next build`), which syncs the
   schema to your new database on every deploy — no separate migration
   step needed.
5. Once it's live, sign up fresh at your new URL (the local dev database
   and this session's test accounts don't carry over).

**Important — "Analyze video" (Suggested Moments) will not work on
Vercel.** That feature shells out to `yt-dlp` and `ffmpeg` and runs for
minutes — Vercel's serverless functions can't run long child processes
or persist binaries like that. Everything else (auth, roster, matches,
manual tagging, Stats, Performance, Insights) works fine on Vercel as-is.
If you want video analysis working in production, it needs a separate
host with a persistent Node process (VPS, Railway, Fly.io, Docker) — see
the Video analysis section below.

## Scope (v1)

Implemented: auth, team/roster management, matches with YouTube-linked
video, in-app stat + shot-location tagging tied to video timestamps,
per-game box score, season performance dashboard, and AI-generated team
insights (Claude Opus 4.8 via structured outputs, grounded in
deterministically-computed stats, cached per game with a manual Refresh).

Not yet implemented (sidebar shows these as "Soon"): an AI assistant coach
chat, a resources library, and the credits/monetization system for
opposition scouting. Player- and opposition-level insights (vs. team-level
only) are also a natural next step.

Known limitations: minutes played and +/- are not tracked (would require
clock/lineup tracking), and shot locations are entered manually while
reviewing the linked video rather than derived automatically.

## Password reset

`/login` → "Forgot password?" → `/forgot-password` (enter email) → an emailed
link to `/reset-password?token=...` → set a new password. Tokens are random
32-byte values, stored as a SHA-256 hash (`PasswordResetToken`), expire after
1 hour, and are single-use (deleted once the password is changed). The
request form always responds the same way whether or not the email has an
account, so it can't be used to discover which emails are registered.

Email is sent via [Resend](https://resend.com) (free tier). Without
`RESEND_API_KEY` set, the forgot-password form shows a clear "not
configured" error instead of silently failing. **Note:** without a verified
sending domain in Resend, it falls back to their shared sandbox sender
(`onboarding@resend.dev`), which has real deliverability limits (e.g. may
only deliver to the email the Resend account itself is registered with) —
verify a domain in Resend for reliable delivery to arbitrary users. This
was not testable end-to-end in this session (no reachable Postgres or
Resend from this sandbox) — verified via type-check/build only; confirm a
real reset email arrives once deployed.

## Video analysis ("Suggested moments")

Full automatic box-score generation from video isn't something an LLM
vision API can reliably do — individual plays happen in ~1-2 seconds and
sampled frames can't reliably distinguish players by jersey number at
typical game-footage resolution. What's implemented instead is **assisted
tagging**: on a match's page, "Analyze video" downloads the linked YouTube
video server-side, samples a frame every 15 seconds, and asks Claude
(vision, structured outputs) to transcribe the on-screen scoreboard in
each frame. Consecutive readings are diffed into candidate events (e.g.
"12:34 — 42-38 → 44-38"), listed under Suggested Moments so a coach can
jump the video to that moment and tag the correct player instead of
scrubbing the whole game.

**How the video gets downloaded, and why:** the app only stores a
`youtubeVideoId`, not the video file — embedding for playback works fine,
but sampling frames requires the actual file, and a YouTube iframe embed
cannot be read from client-side JS (cross-origin restriction). The server
fetches it with [`yt-dlp`](https://github.com/yt-dlp/yt-dlp). This is a
deliberate, discussed tradeoff: **yt-dlp is not an officially sanctioned
YouTube integration** — there's no public API that returns raw video
bytes even to the uploader, so this is a gray area against YouTube's
Terms of Service, accepted here because it's the user's own footage and
downloading it is the only way to avoid a manual upload step.

**Deployment implication:** this pipeline shells out to `yt-dlp` and
`ffmpeg` and runs for minutes per video. That needs a persistent Node
process — it will **not** work on Vercel-style serverless functions
(execution timeouts, no long-running child processes). It requires a
host like a VPS, Railway, Fly.io, or a Docker deployment with those
binaries installed, or moving this specific job to a dedicated background
worker/queue if deployed alongside a serverless frontend.

**What's untested:** the download step (`yt-dlp` → `ffmpeg` → Claude
vision) could not be exercised end-to-end during development — the dev
sandbox's network policy blocks outbound requests to youtube.com. Verified
instead: the job status state machine (PENDING → DOWNLOADING → EXTRACTING
→ ANALYZING → DONE/FAILED), progress polling, error surfacing (confirmed
against a real `yt-dlp` failure), the score-candidate diffing logic (unit
tested), and the full UI. **Confirm the download + vision-analysis steps
actually produce sane candidates against a real game video once
deployed somewhere with normal internet access.**
