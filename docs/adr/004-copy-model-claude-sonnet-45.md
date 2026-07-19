# 004 — Copy generation model: gpt-oss-120b → claude-sonnet-4.5

Date: 2026-07-17 · Commit: d2ce659 · `pipeline/lib/copyEngine.mjs`

## Context
Cold-outreach copy (subject lines, hook lines, localized connection notes)
was generated on OpenRouter's `openai/gpt-oss-120b`. A research subagent was
spawned to evaluate translation/localization quality against alternatives
(explicit ask from Leo — wanted a real comparison, not a guess).

## Decision
Switched `MODEL` in `copyEngine.mjs` to `anthropic/claude-sonnet-4.5`
(OpenRouter, $3/$15 per 1M tokens). `localizeHookLine()`'s prompt was
rewritten from literal translation to "localize, do NOT translate
word-for-word", with a `REGISTER_BY_LANG` map (formal Sie/vous for DE/FR
first cold touch, direct/pragmatic for NL) fed explicitly into the prompt.

## Consequences
- Higher per-call cost than gpt-oss-120b, accepted for the same
  accuracy-over-cost reasoning as ADR-003 — copy quality directly affects
  reply rates, not a place to economize.
- `localizeHookLine()` is scoped specifically to short single opening
  lines (lowercase style, terse) — NOT a general-purpose translator. A
  2026-07-19 planning discussion (ADR-009) proposes a sibling
  `localizeMessage()` for full multi-line messages rather than stretching
  this function past its designed shape.
