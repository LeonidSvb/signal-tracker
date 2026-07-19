# Architecture Decision Records

Lightweight ADRs for this project — one file per decision that had a real
fork in the road (not every commit, only ones where "why this and not the
obvious alternative" isn't derivable from the code itself).

Format: Context / Decision / Consequences. Keep each short — this is a
traceability aid, not a design essay. Numbered sequentially, never renumbered
or deleted; a reversed decision gets a new ADR that supersedes the old one
(link both ways) rather than an edit in place.

Backfilled 2026-07-19 from CHANGELOG.md + git log — decisions before this
date didn't have a dedicated record, reconstructed from the historical
commits/CHANGELOG entries referenced in each file.

| # | Decision | Date |
|---|---|---|
| [001](001-two-channel-routing-split.md) | LinkedIn = Philippe's manual channel, Email = Leo's automated channel | 2026-07-15/17 |
| [002](002-event-key-deduplication.md) | Score/route by grouped events, not raw signal rows | 2026-07-15 |
| [003](003-remove-jaccard-prefilter.md) | Remove Jaccard word-overlap pre-filter from event clustering | 2026-07-17 |
| [004](004-copy-model-claude-sonnet-45.md) | Copy generation model: gpt-oss-120b → claude-sonnet-4.5 | 2026-07-17 |
| [005](005-linkedin-3step-universal-structure.md) | LinkedIn copy: 3-step universal structure, not 11 signal-specific pairs | 2026-07-17/18 |
| [006](006-dedicated-validation-stage.md) | Email validation as its own weekly stage, not inline-only | 2026-07-18 |
| [007](007-cron-triggered-actors.md) | Apify actors triggered by our own cron + key pool, not native Schedules | 2026-07-18 |
| [008](008-vps-deployment.md) | Pipeline runs on the VPS, not Leo's Windows machine | 2026-07-18 |
| [009](009-frontend-v2-concept.md) | Frontend v2.0 concept: event AI-summary, single copy source of truth, on-demand AI translation, flat status row | 2026-07-19 |
