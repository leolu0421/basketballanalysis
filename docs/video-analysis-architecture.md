# Video analysis architecture and next steps

## Current workflow

Next.js provides cookie-session authentication, team-owned rosters, match
management and video playback. Prisma/Postgres stores events, candidates,
reference stat lines and benchmark evaluations. Uploaded videos use a
persistent filesystem volume; YouTube videos are linked by video ID.

Analysis runs in the Node process: yt-dlp downloads YouTube video, ffmpeg
samples frames, Anthropic vision reads the scoreboard and localizes scoring
moments, YOLO/ByteTrack extracts person tracks, and vision plus an optional
MobileNet jersey classifier proposes a player. Coaches confirm statistics.
This is not an automatic detector for rebounds, fouls, assists or minutes.
Those event types can be logged manually today. Number recognition alone
does not establish team membership or prove that a person took the shot.

## Changes in this revision

- Ignore regressive scoreboard OCR/replays instead of treating recovery as
  a basket. Normalize supported score separators and reject unreadable
  deltas. Genuine official score corrections require manual review.
- Reject intermediate OCR overshoots; use the latest confirmed old-score
  timestamp for the search window. Confirmation remains heuristic: a
  coherent sequence of incorrect ascending readings can still produce errors.
- Restrict local jersey classification to the model-selected scorer track.
  Unknown tracks and duplicate roster numbers cannot resolve a player.
- Configure `ANTHROPIC_VIDEO_MODEL` and `ANTHROPIC_INSIGHTS_MODEL` separately.
  Empty values retain the existing model default, which must be checked
  against the account's available models. API keys are no longer partially
  logged. No external model call or training run is part of this change.
- Export timestamped labels through the authenticated match page's
  **Export video labels** link. The owner-scoped JSON contains no player
  names or email addresses. It separates MANUAL ground truth, AI_CONFIRMED
  suggestions and UNKNOWN records. Missing timestamps are excluded.
  Coverage is explicitly partial; unlabelled moments are not negative examples.
- Preview the first 50 videos in a YouTube playlist/channel, then select
  matches, opponents and actual game dates. Existing team video IDs are
  skipped; import uses a serializable transaction. Import does not download
  video, start analysis, change existing matches or assume an upload date
  is a match date. This is an explicit import, not automatic background sync.

## YouTube requirements

The host needs yt-dlp on PATH (the repository Dockerfile installs it).
Preview supports public channels/playlists and accessible unlisted playlists.
Private videos need a separate supported authorization design; do not send
Google passwords or browser cookies in chat. YouTube may block cloud IPs
even when a link plays in a personal browser. Network access to YouTube and
video CDN hosts is needed; capture actual denied destinations before adding
rules. Direct upload remains available as a fallback. Uploaded videos and
playlist listings are not sent to an additional provider by this revision.

## Preparing Harper's team data

Fill in the roster and numbers, verify team colors and scoreboard side,
and use the Coberg game as a small independent benchmark. Existing legacy
events marked UNKNOWN need individual review using **Mark as ground truth**;
never promote all historical or AI-confirmed events automatically. The
18 observed Coberg annotations are only partial and are not a training set
large enough to establish model accuracy. Final box-score totals are useful
constraints, but they cannot provide event timestamps or shot attempts.
Partial shot logs must not be represented as full-game shooting accuracy.

## Model integration sequence

1. Verify a video model ID and provider access, then benchmark scoreboard
   accuracy and scoring timestamps against manually reviewed clips.
2. Improve person tracking and number reads on real footage; add explicit
   team appearance/scoreboard-side context before trusting identity guesses.
3. Build separate positive and negative, independently reviewed clips for
   shot attempts, rebounds and other actions. Split train/validation/test by
   match, not neighbouring frames. Retain annotation provenance and source
   licenses; evaluate external sports datasets for domain suitability.
4. Add a worker-facing versioned event contract containing timestamp,
   player/track identity, event type, confidence and model/version metadata.
   Validate proposals on the server and keep the coach confirmation path.
   Use the label export as provider-independent supervision, not as an
   automatic upload to a third-party training service.
5. Move expensive inference into a persistent job worker before adding
   channel synchronization or high-volume processing. The current in-process
   fire-and-forget job can be interrupted by deploys; timeouts do not make
   it a durable queue. Preserve benchmarks and monitor cost per video.

Fouls need gameplay/referee context and often cannot be determined from one
camera. Minutes require substitution/on-court tracking and a reliable game
clock, not elapsed video time. Avoid claiming either is solved by adding
more data alone.

## Deployment

No schema migration is required. Run tests, lint, TypeScript and the Next.js
build, then deploy through the existing Railway/GitHub workflow. These
changes are local until deployed. The production site was inspected read-only;
existing match events and AI suggestions were not changed or re-analyzed.
