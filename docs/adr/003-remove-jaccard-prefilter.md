# 003 — Remove the Jaccard word-overlap pre-filter from event clustering

Date: 2026-07-17 · Commit: d2ce659 · `pipeline/lib/eventGrouping.mjs`

## Context
`findCandidateClusters()` originally gated which signal pairs even reached
the LLM's `sameEvent()` call behind a Jaccard word-overlap threshold
(≥0.3) on normalized titles — a free pre-filter meant to save LLM calls.
Found live 2026-07-17 (DMK Group review, `docs/REVIEW_2026-07-17_dmk_and_copy.txt`):
this silently dropped real same-event pairs that were lexically dissimilar
but semantically identical — e.g. "invests €25m in lactoferrin production"
vs "invests in German dairy plant" share almost no words but describe the
same investment.

## Decision
Removed the Jaccard gate entirely. Every same-company signal pair inside
the date window (`windowDays`) now becomes a cluster candidate and gets a
real `sameEvent()` LLM call (cache-first). Leo's explicit call: "на аи
токенах не экономь ... у нас точность выше экономии кредитов" — accuracy
over OpenRouter token cost, the cost difference is cents either way.

## Consequences
- Recall improved (DMK-style near-miss pairs now correctly merge).
- LLM call volume per `rank_leads.mjs` run increased — still cents-scale,
  cached by sorted member signal ids so repeat runs don't re-spend.
- `classify_company.mjs` had a duplicate inline near-dup implementation
  (not yet refactored to share code with `eventGrouping.mjs`) — the same
  removal was applied there manually, kept in sync by hand. Flagged as
  tech debt, not fixed.
