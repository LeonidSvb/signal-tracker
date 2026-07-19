# 005 — LinkedIn copy: 3-step universal structure, not 11 signal-specific pairs

Date: 2026-07-17/18 · Commit: d2ce659 · CHANGELOG [0.16.0]
Deliverable: `clients/philippe-bosquillon/docs/linkedin_email_flow_philippe_2026-07-17.html`

## Context
The original LinkedIn copy had a full connection-note + message pair
written out per signal type (11 combinations) — repetitive to maintain, and
in review Leo flagged the copy as reading generic/AI-generated ("no pitch"
phrasing, forced call-proposal language).

## Decision
Collapsed to a 3-step universal pattern:
1. **Connection request** — varies by signal (one intro line referencing
   what happened).
2. **First message** — ONE qualifying question tied to the specific signal
   (not a generic "still open?"). Includes an optional deeper-qualification
   callout (decision-maker check, role priority, timeline) for clearly-
   engaged replies — explicitly excludes budget/comp (reserved for the
   actual call).
3. **Propose a call** — fully universal text, identical for every signal
   type, sent only after a substantive reply to step 2.
Plus one shared follow-up nudge template (max 1-2 nudges, 4-5 day cadence).
Only steps 1-2 vary per signal (6 simplified signal types, down from the
original 11 combinations); step 3 and the follow-up are always the same.

## Consequences
- `pipeline/config/copy_templates.json` was NOT updated in this pass — it
  still carries the old per-signal-type `li_first_message` field structure
  from before this redesign. The HTML playbook (built for direct human
  reading) and the JSON (read by the pipeline code) diverged — a real
  open item, tracked for the ADR-009 frontend work to resolve by porting
  this structure into the JSON as the single source of truth.
- Email reply-handling was reframed to mirror the same qualify-then-
  propose-call shape (was: jump straight to a pitch) — but the EMAIL A/B/C
  variants in `copy_templates.json` were NOT touched in this redesign
  (only `li_connection_note`/`li_first_message` fields were), per
  TODO.txt's 2026-07-18 status note. Still open.
