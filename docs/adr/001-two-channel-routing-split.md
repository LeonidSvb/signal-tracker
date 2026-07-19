# 001 — LinkedIn is Philippe's manual channel, Email is Leo's automated channel

Date: 2026-07-15/17 · Commits: d2ce659 (redesign), see CHANGELOG [0.13.0]-[0.16.0]

## Context
Leo has zero access to Philippe's LinkedIn account (confirmed explicitly,
repeatedly). Email sending goes through PlusVibe, which Leo fully controls.
Early designs treated both channels symmetrically (same message-pair-per-
signal structure, same automation assumptions) — this doesn't match reality.

## Decision
- **LinkedIn**: 100% Philippe's own action, end to end. The system only
  prepares copy-paste-ready text and tracks status Philippe reports back
  (originally designed as a 3-step tracker, later simplified — see ADR-009).
- **Email**: 100% automated by Leo's pipeline (`route_email.mjs` →
  PlusVibe). Philippe never writes or answers an email himself. When a call
  gets proposed by email, Leo loops Philippe into the thread directly —
  Philippe sees the full conversation, not a summary.
- Both channels share one state table (`channel_actions`, migration 005) —
  same schema, same idempotency logic, different write path.

## Consequences
- LinkedIn copy must be genuinely copy-paste-ready (no jargon requiring
  Philippe to interpret) — directly shaped ADR-005's 3-step redesign.
- Email automation carries full responsibility for validation, sequencing,
  and reply-handling qualification — no manual Leo intervention expected
  except the call-proposal loop-in moment.
- Any future UI must visually distinguish "you (Philippe) do this" from
  "this happens automatically, for your awareness" — see ADR-009.
