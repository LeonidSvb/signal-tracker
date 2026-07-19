# 008 — Pipeline runs on the VPS, not Leo's Windows machine

Date: 2026-07-18 · Commits: d14478c, b935c27

## Context
Every pipeline run to date had been manually triggered from Leo's Windows
machine — "production" depended on Leo's laptop being on. The Next.js
frontend already lived on the VPS (152.53.194.162); the pipeline did not.

## Decision
Deployed the pipeline to `/opt/apps/projects/philippe-signals-pipeline/` on
the same VPS, mirroring the outer `Mastr_Leads` repo's relative-path
dependencies the pipeline reaches outside `signals/` (`.env`, `blitz/.env`,
`scripts/utils/apify-key-pool.mjs`, `scripts/validation/`,
`clients/philippe-bosquillon/copy/`) via tar+scp (no rsync available, no
git push used for this transfer — kept separate from the GitHub-based
Next.js deploy). Crontab: weekly full Mon 08:00 UTC, daily light every day
10:00 UTC, both pinned via `CRON_TZ=UTC` (the box itself is Europe/Berlin —
without this the jobs would silently drift by an hour with DST).

## Consequences
- Found and fixed two real portability bugs during the deploy smoke test:
  `build_linkedin_queue.mjs` and `build_signal_report.mjs` both defaulted
  their output path to Leo's Windows `Downloads` folder — broke immediately
  on Linux. Fixed to a repo-relative `pipeline/runs/` default.
- Discovered the frontend has TWO parallel deploy paths: a systemd service
  on :3099 (what `deploy.ps1` updates) and a Coolify container that rebuilds
  from GitHub on push (what the public domain `philippe.pamelacoreypc.com`
  actually serves). `deploy.ps1` alone does NOT update the public site —
  a `git push` is required too. Flagged as a real gap to eventually
  collapse into one path; not fixed this session.
- First live (unsupervised) cron firing is the following Monday — every
  stage is idempotent, so a missed/late run degrades gracefully rather
  than corrupting state.
