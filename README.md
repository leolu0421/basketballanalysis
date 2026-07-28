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
"Deploying to Railway" below, and the Video analysis section further down.

## Deploying to Railway

Unlike Vercel, Railway runs the app as a normal persistent process (via
the `Dockerfile` in this repo), so `yt-dlp`, `ffmpeg`, and `python3` all
work and "Analyze video" actually functions. This has to be done from
your own Railway account. Steps:

1. **Get a Postgres database** — reuse the same Neon connection string
   from your Vercel setup if you already have one; no need for a second
   database.
2. **New project on railway.app** → Deploy from GitHub repo → select
   `leolu0421/basketballanalysis` and the branch you want to deploy.
   Railway auto-detects the `Dockerfile` and builds from it — no
   framework preset to pick, unlike Vercel.
3. **Set environment variables** in the Railway project's Variables tab
   (same values as your Vercel ones): `DATABASE_URL`, `AUTH_SECRET`,
   `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.
4. **Deploy.** The Dockerfile's `CMD` runs `prisma db push` on every
   startup to keep the schema in sync, then starts the server — no
   separate migration step, same idea as the Vercel build script.
5. Railway gives you a `*.up.railway.app` URL (a custom domain can be
   attached in the project settings if you want one) — sign up fresh
   there once it's live.
6. **Your trained jersey model** (see "Training your own jersey-number
   model" below), if you have one: those two files aren't committed to
   git by default (`.gitignore` excludes `/models/`). Since git push is
   the only deploy mechanism here, commit them anyway if you want this
   deploy to use them — `git add -f models/jersey/jersey_classifier.pt
   models/jersey/jersey_classes.json` before committing. Without that,
   the app runs fine and just skips straight to the Claude-vision
   fallback for jersey reads (see pipeline.ts's `hasTrainedJerseyModel`).
7. **If you'll use direct video upload** (see "Direct video upload"
   below) instead of/alongside YouTube links, attach a Railway **Volume**
   to the service (Settings → Volumes → New Volume), mount it at e.g.
   `/data/videos`, and set the `VIDEO_STORAGE_DIR` environment variable
   to that same path. Without a volume, uploaded videos still work but
   get wiped on every redeploy, since a plain container's filesystem
   isn't persistent.

**Confirmed working in production**: this Dockerfile was deployed to a
real Railway project during development. It failed once (`npm ci`
couldn't find `prisma/schema.prisma` — fixed by copying the `prisma/`
folder in before that step) and succeeded on the next push. The Docker
build itself still can't be run in this dev sandbox (no privileged
daemon access), so day-to-day changes to this Dockerfile going forward
are still checked by hand rather than a local `docker build` — if a
future change breaks the Railway build, the build log will show exactly
where, same troubleshooting pattern as everything else in this project.

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

## Direct video upload

An alternative to pasting a YouTube link: upload the game video file
directly from the match page. This exists because the YouTube-link path
depends on `yt-dlp` successfully downloading from YouTube, which — as
confirmed in production — YouTube can reject outright with `HTTP 429`
for requests coming from cloud/datacenter IPs (see the "Confirmed in
production" note in the Video analysis section below). Direct upload
sidesteps that entirely: no download step, no YouTube ToS gray area for
that specific match, and analysis runs immediately against the file you
gave it.

**How it works:** the file is split client-side into 10MB chunks, each
sent as its own short-lived request to `POST
/api/matches/[matchId]/video/chunk?uploadId=...&index=...`, which streams
straight to disk without buffering in memory. Once every chunk succeeds,
`POST /api/matches/[matchId]/video/finalize` concatenates them in order
into the real video file and links it to the match. Each chunk retries
up to 3 times on failure before giving up. Playback uses a plain HTML5
`<video>` element pointed at `GET /api/matches/[matchId]/video`, which
supports HTTP Range requests so seeking works without downloading the
whole file first. A successful upload sets `match.videoFileName` and
clears `match.youtubeVideoId` — the two are mutually exclusive per
match, and the tagging page's player, "Analyze video" trigger, and the
pipeline's download step all branch on which one is set (see
`VideoSource` in `pipeline.ts`).

**Why chunked, not a single request:** the first version sent the whole
file as one request. Confirmed in production against a real 683MB game
video: it failed partway through (~14%) with the connection dropping —
most likely a platform reverse-proxy timeout on a single long-lived
request, though the exact cause wasn't confirmed via logs. Splitting
into many small requests sidesteps that regardless of the precise cause,
since no individual request runs long enough to be at risk. **Known
gap**: if the browser tab is closed or navigates away mid-upload, the
next attempt starts over from chunk 0 with a new `uploadId` — already-
uploaded chunks from the abandoned attempt are simply orphaned on disk
(cleaned up whenever a `finalizeChunks` call for that same `uploadId`
completes, which won't happen for an abandoned one). This isn't
byte-loss or corruption, just wasted disk space from an incomplete
attempt; true resume-after-reload would need the client to persist
`uploadId`/progress and query which chunks the server already has,
which isn't built.

**Storage**: uploaded files (and in-progress chunks, under a
`_uploads/<uploadId>/` subfolder per match) live at
`VIDEO_STORAGE_DIR/<matchId>/...` — see `.env.example` and "Deploying to
Railway" above for why this needs to point at a persistent Volume in
production, not the container's own (ephemeral) filesystem.

**What's tested vs. not:** the chunk-write-then-concatenate logic was
isolate-tested outside Next.js with a synthetic ~26MB file split into
uneven chunks (including a short final chunk) — the reassembled file
was confirmed byte-identical to the original. The single-shot version of
this upload (superseded by chunking) was also confirmed to actually fail
in production exactly as predicted, which is what prompted this rework.
What's NOT tested: the chunked version's real end-to-end behavior over
an actual flaky/slow connection with real retries firing — only the
underlying file mechanics and the (now-removed) single-shot path were
validated against real production traffic. Confirm a large real upload
completes successfully once deployed.

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

**Training your own jersey-number model (Phase 2, optional):** the
tracking step above uses a generic, off-the-shelf person detector —
nothing in it is trained on your team. If you want a model actually
trained on your players' jerseys, there are four scripts for that, and
they're a real, working pipeline (train + inference tested end-to-end in
the dev sandbox against synthetic data — see "What's untested" for what
that does and doesn't prove). This is genuinely a second job for you,
not something that happens automatically.

**Important design choice:** this model only ever learns to read digits
off a jersey — it is deliberately NOT trained to recognize "your team"
vs. "the opponent," or any specific player. The reason: an opponent's
jersey colors are different every single game, and your own roster
changes every season (different teammates for both Harper and Zac each
year) — a model trained against this week's specific matchup wouldn't
transfer to next week, let alone next season, and you'd be stuck
retraining constantly. Digit recognition, on the other hand, doesn't
care who's wearing the jersey — a "7" looks like a "7" regardless of
team or year. The number-to-player mapping (e.g. "#4 is Harper this
season") is resolved separately, live, from your team's current roster
in the database every time a video is analyzed — it already handles
roster changes automatically and was never something you needed to
train. So label every readable number you see, including opponents' —
that variety makes the digit-reader more robust, and the same trained
model keeps working next season and against new opponents without
retraining, which is the "set it up once" behavior you're after.

1. **`extract_training_crops.py <video> <output_dir>`** — pulls
   individual person crops out of a game video (own footage, any
   source) at a sample rate (`--fps`, default 1/sec), up to
   `--max-crops` (default 500). Run it against a few different games so
   the crops cover different lighting/angles/opponents.
2. **`label_crops.py <crops_dir>`** — starts a local web page
   (`http://localhost:8765`) showing one crop at a time; type whatever
   jersey number is visible and hit save, or mark "can't read it" if it
   isn't legible. No "which team" question — every readable number
   counts, teammates and opponents alike. Labels are written
   incrementally to `labels.csv` in the crops folder, so you can label
   20 crops now and 200 more later — it resumes where you left off.
   Budget a few dozen+ labeled examples per distinct number across
   however many games you run this against; more and more varied is
   better.
3. **`train_jersey_classifier.py <crops_dir> <output_dir>`** —
   fine-tunes a small pretrained image classifier (MobileNetV3-Small)
   on your labeled crops (`--epochs`, default 15). Classes with fewer
   than `--min-per-class` (default 4) labeled examples are dropped
   automatically rather than poisoning training with too little signal.
   Prints a JSON summary (classes trained, val accuracy) and writes
   `jersey_classifier.pt` + `jersey_classes.json`.
4. **Deploy the model**: copy those two output files into
   `models/jersey/` at the project root on whatever host runs video
   analysis. `pipeline.ts` checks for them automatically on each job —
   if present, the trained classifier's jersey read overrides Claude's
   whenever it's confident (≥60%) and matches a roster number; if
   absent, nothing changes from today's behavior. No code changes or
   redeploys needed beyond dropping the two files in place.

This model only identifies jersey numbers — shot type (2PT/3PT/FT) still
comes from Claude + the scoreboard delta either way, and there's no
tooling here for training a shot-type or action classifier (see the
"Can this AI learn" note below for why that's a much bigger project).

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

**Confirmed in production**: on a real deploy (Railway), the very first
"Analyze video" attempt hit `HTTP Error 429: Too Many Requests` straight
from YouTube. This isn't a bug in the code — YouTube actively rate-limits
and blocks download requests coming from cloud/datacenter IP ranges
(which is what Railway, AWS, GCP, etc. all use) far more aggressively
than a home internet connection, specifically because that traffic
pattern looks like automated scraping. `--extractor-args
"youtube:player_client=android,web"`, `--retries 3`, and
`--sleep-requests 1` were added to the `yt-dlp` call as mitigations
(alternate extraction path + backoff), and `deno` was added to the
Docker image since yt-dlp also warned about needing a JS runtime for
some signature deciphering. **Neither is guaranteed to fully resolve
it** — this is an active, evolving fight between yt-dlp and YouTube's
anti-bot measures specifically targeting cloud IPs, not a one-time fix.
If 429s persist, the practical fallback is switching to direct video
upload instead of a YouTube link (see the "Worst case" discussion this
project had about that tradeoff) — that removes the download step (and
its ToS gray area) entirely, at the cost of needing file storage and a
different video player.

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
data; it just finds "a person" generically. A model actually trained to
recognize your team's jersey numbers exists now too (Phase 2 above,
`train_jersey_classifier.py`) — but it only trains from crops you
label by hand through `label_crops.py`, not from typed-in stats or
box scores. A true action-recognition model that classifies
rebounds/fouls/assists directly from motion, instead of relying on the
scoreboard delta, would be a further, separate project on top of that —
no tooling for it exists here. The reference-stats check above remains
today's practical alternative for those event types: it doesn't make
the AI smarter, but it makes inaccuracies visible so a coach can catch
and fix them per game.

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

`train_jersey_classifier.py` and `classify_jersey.py` were also tested
end-to-end (train → save → load → predict, all producing valid output)
against synthetic labeled crops (rendered jersey numbers on colored
rectangles), confirming the code itself is correct. **Not yet
confirmed: real-world accuracy against actual hand-labeled game
footage** — that depends entirely on how much you label and how
visually distinct your jerseys are, and can only really be judged once
you've gone through the labeling workflow above with real crops. One
sandbox-specific note: downloading pretrained ImageNet weights from
`download.pytorch.org` is blocked by this dev sandbox's network policy
(unrelated to YouTube/ultralytics.com, which are also blocked, but a
separate host) — training was validated with randomly-initialized
weights instead to confirm the code path works; a normal production
host should reach `download.pytorch.org` without issue, and using the
real pretrained weights (the default, unmodified behavior of
`train_jersey_classifier.py`) matters a lot for accuracy on a small
dataset, so don't skip it.

**Confirmed in production, and fixed**: a real analysis run against a
real 46-minute game video (direct upload, not YouTube) got stuck showing
"Analyzing…" for hours with no error and no progress. Root cause: no
child process spawned by this pipeline (`yt-dlp`, `ffmpeg`,
`track_players.py`, `classify_jersey.py`) had a timeout — a hung or just
very slow (Railway's Hobby-plan CPU is limited, and `track_players.py`
reloads the YOLO model from scratch on every single candidate rather
than once per job) subprocess would block the promise forever, since
`close`/`error` never fired. Fixed two ways:
1. Every `run()`/`runCapture()` call site now passes an explicit
   timeout (2-15 minutes depending on the step); on timeout the child is
   killed and the promise rejects instead of hanging. In the tracking
   loop, one candidate timing out already triggers the existing
   fallback-to-wide-frame-guessing for all remaining candidates, so a
   single slow candidate can no longer stall the whole job.
2. As a second line of defense independent of the above, `MATCHING`
   progress now updates per-candidate (not just once at the phase
   start), and `getVideoAnalysisStatus` auto-fails any job whose
   `updatedAt` is more than 20 minutes stale while still "active" —
   this is what actually unstuck the real stuck job from this incident,
   and protects against any future hang the timeouts above don't cover.

Separately, the same production run surfaced a recurring uncaught
`TypeError: Invalid state: Controller is already closed`
(`ERR_INVALID_STATE`) in the deploy logs from the video-streaming route,
likely from a `<video>` element aborting one Range request to start
another (a normal seek). `Readable.toWeb(createReadStream(...))` doesn't
guard against operating on an already-closed controller in that case —
replaced with a hand-rolled wrapper that treats "controller already
closed" as an expected, silent no-op (client disconnected) rather than
an error. A local test simulating a mid-stream cancel didn't reproduce
the exact race (it likely needs a real HTTP-level abort, not just a web
`ReadableStream.cancel()`), so this is a defensive fix based on the
error's signature rather than one confirmed to eliminate it — worth
checking the deploy logs again after some real usage to confirm it's
actually gone.
