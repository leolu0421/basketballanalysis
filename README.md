# hooplens (basketball analytics MVP)

A youth/club basketball team analytics platform: coach-entered stat tracking,
video-linked shot/event tagging (via YouTube), per-game box scores, and
season performance aggregation.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS
- Prisma + SQLite (swap to Postgres later by changing `datasource` in
  `prisma/schema.prisma` and `DATABASE_URL`)
- Custom cookie-session auth (bcrypt + signed JWT), no third-party auth
  service

## Getting started

```bash
npm install
cp .env.example .env   # then set a real AUTH_SECRET, and ANTHROPIC_API_KEY for AI insights
npx prisma migrate dev
npm run dev
```

Open http://localhost:3000 — sign up, create a team, add players, add a
match (optionally paste a YouTube link to the game film), then tag stats
against it. Box scores show up under Stats, season aggregates under
Performance, and AI-generated analysis under Insights (once
`ANTHROPIC_API_KEY` is set — without it, Insights shows a "not configured"
state instead of erroring).

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
