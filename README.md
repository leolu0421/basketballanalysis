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
vision API can reliably do — individual plays happen in ~1-2 seconds,
sampled frames can't reliably distinguish players by jersey number at
typical game-footage resolution, and there's no persistent player
tracking (no ReID/motion-tracking model) across the video — each vision
call only reasons over the handful of frames it's given. What's
implemented instead is **assisted tagging**: on a match's page, "Analyze
video" downloads the linked YouTube video server-side, samples a frame
every 15 seconds, and asks Claude (vision, structured outputs) to
transcribe the on-screen scoreboard in each frame. Consecutive readings
are diffed into candidate scoring moments (e.g. "12:34 — 42-38 → 44-38").

For each candidate, a second pass tries to identify **who scored and
what kind of shot it was** (2PT/3PT/FT made — candidates only exist
where the score went up, so misses aren't covered). This has two paths:

- **Preferred: player tracking.** `scripts/track_players.py` runs a
  pretrained YOLOv8 person detector plus ByteTrack (both off-the-shelf,
  COCO-trained — nothing here is trained on basketball footage or on
  your team) over a short ffmpeg-cut clip around the candidate's
  timestamp. This gives each person on screen a persistent track ID for
  that clip and crops a zoomed torso close-up per track. Those crops —
  not the wide-shot frame — are what get sent to Claude vision to read a
  jersey number against, since a zoomed close-up reads far more reliably
  than a small blurry digit in a wide shot. **This is not a custom-trained
  model recognizing your specific players** — it's a generic tracker
  finding "a person" and holding their identity for a few seconds,
  combined with the same Claude OCR read as before on a better crop.
  Requires Python 3.10+ and the packages in `requirements.txt`
  (`ultralytics`, `opencv-python-headless`, `lap`) on the host —
  `pip install -r requirements.txt`. First run downloads YOLOv8n weights
  (~6MB) from GitHub. This step is naturally slower than the rest of the
  pipeline (a fresh detection pass per candidate clip, CPU-only unless
  the host has a GPU) and adds real time on top of an already
  multi-minute job.
- **Fallback: wide-frame guessing.** If Python/the tracking deps aren't
  installed, or the tracking step errors for any reason, the pipeline
  automatically falls back to the original approach — showing Claude the
  raw sampled frames around the candidate directly, using jersey number,
  jersey color, ball possession, court position, relative build, and any
  visible referee signal as corroborating cues. So video analysis still
  works without the Python setup, just with the coarser guess quality
  from before. Once tracking fails once in a job, later candidates skip
  straight to this fallback rather than retrying a broken pipeline
  candidate-by-candidate.

Either way, the shot-type guess leans on the scoreboard point delta (a
jump of exactly 3 is a three, exactly 1 is a free throw) rather than
judging shot arc visually — that part is arithmetic, not vision. Free
throws are the most reliable guess since the scene (stoppage, isolated
shooter at the line) is visually distinct; the weakest link is telling a
2PT jumper from a 3PT jumper purely by position relative to the arc.

**Can this become a model trained specifically on your team?** That's a
materially bigger, separate project — see the "Can this AI learn from
provided stats?" note further down for what that would actually take
(a labeled dataset, a trained jersey-number classifier, GPU training
infra). What's built here is Phase 1 of that path: real, tested,
off-the-shelf tracking that improves crop quality today with zero
training data required — not a shortcut to full custom recognition.

Suggestions are shown under "Suggested moments" as **AI guess: #2 Harper
— 2PT Made** with Confirm / Edit / Dismiss — clicking the timestamp
seeks the video to that clip so the coach can watch it before deciding.
Nothing is ever logged as a real stat without an explicit Confirm; if the
guess is missing or wrong, the coach picks the player and stat type from
a dropdown instead. The full manual tagging buttons remain available
alongside this for anything the suggestions don't cover.

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

**Deployment implication:** this pipeline shells out to `yt-dlp`,
`ffmpeg`, and (for the tracking guess path) `python3`, and runs for
minutes per video. That needs a persistent Node process — it will
**not** work on Vercel-style serverless functions (execution timeouts,
no long-running child processes). It requires a host like a VPS,
Railway, Fly.io, or a Docker deployment with those binaries installed
(`pip install -r requirements.txt` for the Python side), or moving this
specific job to a dedicated background worker/queue if deployed
alongside a serverless frontend. The tracking step is optional at
runtime — it fails gracefully into the wide-frame fallback if Python or
its deps aren't set up on the host — but it won't ever run without them.

**Reference stats check:** on the Stats page's Player Stats tab, coaches
can optionally type in per-player 2PT/3PT/FT-made and foul counts from
an outside source (e.g. a paper stat sheet or another app like MyHoops)
for that game. Logged values are compared live and flagged (⚠️) on
mismatch. This is a manual cross-check, not a training signal — it
doesn't change how future AI suggestions are generated (see the "Can
this AI learn from provided stats?" note below).

**Can this AI learn from provided stats?** No — each Claude vision call
is independent with no memory across games, and Claude itself isn't
fine-tuned/retrained from data entered into this app (no such
fine-tuning API exists for it). What *is* in this codebase now (see
"player tracking" above) is an off-the-shelf, pretrained person
detector + tracker (YOLOv8 + ByteTrack, trained on generic COCO photos,
not on your team) that holds a per-clip identity for whoever's on
screen and crops them for a better OCR read — that's real tracking, but
it doesn't know your specific players or "learn" anything from your
data; it just finds "a person" generically. Going further — a model
that's actually trained to recognize your team's jersey numbers, or a
true action-recognition model that classifies rebounds/fouls/assists
instead of relying on the scoreboard delta — would need its own labeled
dataset (a few hundred+ hand-labeled examples) and GPU training time
(e.g. a Colab notebook), which is a separate follow-on project, not
something that happens automatically from stats typed into this app.
The reference-stats check above is today's practical alternative: it
doesn't make the AI smarter, but it makes inaccuracies visible so a
coach can catch and fix them per game.

**What's untested:** the download step (`yt-dlp` → `ffmpeg` → Claude
vision) could not be exercised end-to-end during development — the dev
sandbox's network policy blocks outbound requests to youtube.com. Verified
instead: the job status state machine (PENDING → DOWNLOADING → EXTRACTING
→ ANALYZING → MATCHING → DONE/FAILED), progress polling, error surfacing
(confirmed against a real `yt-dlp` failure), the score-candidate diffing
logic (unit tested), and the full UI including the confirm/edit/dismiss
flow. **Confirm the download + vision-analysis steps actually produce
sane candidates — and reasonable player/shot-type guesses — against a
real game video once deployed somewhere with normal internet access.**
The player-guessing pass fails gracefully (candidates still show up with
no guess, just an empty player/stat picker) if that second vision call
errors, so a bad guess-pass run shouldn't block tagging entirely.

`scripts/track_players.py` and its ffmpeg-clip-cut → tracking → crop
chain were tested end-to-end in the dev sandbox and confirmed working
(detection, persistent track IDs, torso crops all produced correctly) —
but only against a synthetic test video (a still photo of people panned
across frames), since real basketball footage isn't reachable from this
sandbox either. **Confirm detection quality against a real game video**
— a fixed, distant broadcast angle with fast-moving, frequently
occluded players is a much harder case than the synthetic test, so
expect the person detector to miss players or false-positive on
spectators/coaches sometimes; that's exactly why guesses stay
confirm-or-correct rather than auto-logged.
