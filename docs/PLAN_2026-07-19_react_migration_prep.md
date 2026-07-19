# React Migration Prep — 2026-07-19

Prep work before the real React/Next.js rebuild of the frontend against
`mockups/signals_v2_concept.html`. Written for a **future, separate
implementation session** — this doc is research + decisions, not code.

---

## 0. FOR FABLE — 2 open questions this prep did NOT resolve

These are the two hardest architectural calls surfaced by this audit. Leo
explicitly deferred both to a Fable session rather than deciding blind — read
the relevant sections below first (§2's "Open question" and the
`event_summary` row in §2's detail-panel table), then decide.

**Q1 — Where does per-contact CRM status live?**
The mockup's `statusState` (new/sent/replied/meeting/pass, per contact) has
no clean home in the current schema:
- `app_state` is scoped to `(client_id, company_id)` — wrong grain, one row
  per company not per contact.
- `channel_actions` has a `contact_id` column but a *different* status
  vocabulary describing outreach mechanics (`validated/pushed/skipped_*` for
  email, `queued/exported/done/skipped` for LinkedIn), not CRM funnel stage.

Options on the table (not a recommendation, Fable should weigh with full
schema context): (a) new migration widening `app_state` to be
`contact_id`-scoped instead of `company_id`-scoped, (b) derive a CRM-stage
label from `channel_actions.status` via a mapping function instead of storing
one at all, (c) something else once Fable sees the full picture. This blocks
the Leads detail panel's per-contact status buttons from being real.

**Q2 — When does `events[].summary` get generated?**
The event drill-down's AI one-line synthesis (e.g. "DMK is investing €25m...")
has zero backing column today (blocks on Migration 007,
`signals.event_summary`) — the storage side is already decided. What's open
is the *generation trigger*: (a) synchronously in `rank_leads.mjs`'s weekly
run, whenever an `event_key` group gets ≥2 sources (cheap, but adds to the
pipeline run's wall-clock and OpenRouter spend even for events nobody looks
at), or (b) lazily from a Next.js API route the first time a user actually
expands that event's drill-down, caching the result into
`signals.event_summary` after the first call (never wasted on unopened
events, but the first open of any given event eats a visible API round-trip).
Depends on real OpenRouter per-call cost and how often new events actually
appear — Fable should pull real numbers before deciding.

---

## 1. Old React frontend — verdict: gut the UI, keep the data-fetching infra

Current `nextjs/src/` is small (17 files). Assessed each piece:

**Delete — superseded by the new IA, not adaptable:**
- `components/LeadCard.tsx`, `components/Sidebar.tsx`, `components/ContactCard.tsx`, `components/Header.tsx`
- `app/page.tsx` (the component tree it assembles is gone in the new concept)
- Reason: totally different information architecture (icon-rail + module tabs +
  grouped accordions vs. the old flat card list). Known bug already found in
  `LeadCard.tsx`: contacts hard-capped at `.slice(0, 2)` — the new mockup fixes
  this, no reason to carry the old component forward and re-fix it.

**Keep and adapt — real working infrastructure, not UI:**
- `lib/supabase.ts` — client setup, correct schema/RLS pattern, no reason to rewrite.
- `hooks/useLeads.ts` — the `Promise.all` fetch pattern (parallel queries scoped to
  `client_id`) is correct and reusable; the *assembly* logic (building the `Lead`
  shape) needs a rewrite since the new mockup needs `tier`/`rank`/`event_key`
  grouping/`channel_actions` that this hook doesn't fetch at all today. Reuse the
  fetch skeleton, not the assembly.
- `useNotes()` in the same file — realtime Postgres-changes subscription on
  `notes` insert. This is genuinely correct and works today; the new mockup's
  Notes panel is the same shape (`NotesLog.tsx` was explicitly used as the
  reference when the mockup's notes section was built). Reuse as-is.
- `lib/types.ts` — will need new types (tier, event grouping, channel_actions)
  but the file itself is the right place for them, not a rewrite target.
- `app/health/`, `app/api/health/`, `app/api/exa-webhook/` — untouched, unrelated
  to this migration, already real and live.

**Verdict: not a full "снести нахуй."** The Supabase-facing plumbing (client,
fetch pattern, realtime notes) is real, tested infrastructure — rebuilding it
from scratch would just reintroduce bugs already shaken out. The *rendering*
layer (every component under `components/`, plus `page.tsx`) gets replaced
wholesale because the IA itself changed, not because the old code is bad.

---

## 2. Data-source audit — mockup field → real source

Every element in `mockups/signals_v2_concept.html`, checked against
`docs/SCHEMA.md` and the actual pipeline stages. Legend: 🟢 real & live today,
🟡 real mechanism exists but needs a build step before production, 🔴 currently
mock/illustrative, no backing column or generation function yet.

### Leads sidebar (list, 32 companies)

| Field | Source | Status |
|---|---|---|
| `name`, `tier`, `employees`, `country` | `companies.name/tier/employees/hq_country` | 🟢 live, `tier` written by `rank_leads.mjs` |
| `sources` (signal count) | `count(signals)` per company | 🟢 |
| `contacts`, `withEmail` | `count(contacts)`, `count(contacts where email is not null)` | 🟢 |
| `origin` (exa / job_board) | `signals.source` per company, queried live 2026-07-19 | 🟢 confirmed via a real query (409 companies, only 4 overlap both) |
| `status` (new/sent/replied/meeting/pass) | *for DMK/BRATA only*: real per-contact `statusState` aggregated client-side via `aggregateStatus()`. *For the other 30*: **hardcoded illustrative value**, no `channel_actions` row backs it | 🟡/🔴 — mockup's own comment admits this at signals_v2_concept.html:549-550, 815-817 |
| `channel` (both/linkedin_only) | Same split — DMK/BRATA real, rest illustrative | 🔴 for 30/32 companies |

**Build implication:** the real per-company status chip needs a query that
aggregates `channel_actions` (or `app_state`, TBD — see open question below)
per company, not per contact-array-in-memory. `aggregateStatus()`'s logic
(most-advanced wins, `pass` only if *every* contact passed) is sound and
should be ported as-is, just fed by a real query instead of 2 hand-built objects.

### Company detail panel (DMK + BRATA fully wired; other 30 have list data only)

| Field | Source | Status |
|---|---|---|
| `industry`, `employees`, `country`, `domain`, `linkedin` | `companies.*` | 🟢 |
| `tier`, `rank`, `tier_reason` | `companies.tier/rank/tier_reason`, written by `rank_leads.mjs` A2 formula | 🟢 |
| `events[].sources[]` (dedup'd list of URLs/dates/labels) | `signals` rows grouped by `event_key` (migration 005, `eventGrouping.mjs`) | 🟢 grouping is real |
| `events[].summary` (AI one-line synthesis, e.g. "DMK is investing €25m...") | **No backing column.** `signals` has `narrative`/`angle`, not a cross-source event summary | 🔴 **needs Migration 007 (`signals.event_summary`) + a new `summarizeEvent()` function** — already flagged in TODO.txt, confirmed here as blocking this exact UI element |
| `events[].dupeNote` ("5 raw rows collapsed to 3 sources...") | Derivable from `raw_signal_id` fan-in per `event_key`, but not stored anywhere | 🔴 either compute at request time (re-run grouping) or persist a count — decide before building |
| `contacts[]` (name/title/linkedin/email/status/primary) | `contacts.*`, `is_primary` | 🟢 — note `is_primary` means "first hit in Blitz waterfall," not a seniority judgment (documented gotcha, don't re-derive meaning in the UI) |
| `outreach.{en,de}.connect` (LinkedIn connection-request hook line) | `copyEngine.mjs`'s `localizeHookLine()`, scoped exactly to short opening lines | 🟢 mechanism real, but copy_templates.json restructure (below) needed to key it per-contact-per-signal-type cleanly |
| `outreach.{en,de}.sent/replied/meeting` (longer follow-up messages) | **No generation function covers multi-line messages today** — `localizeHookLine()` is explicitly hook-line-only | 🔴 **needs `localizeMessage()` (already flagged in TODO.txt) — confirmed here as the actual blocking gap**, not just a nice-to-have |
| `emailState` (`no_campaign` / `no_email`) | Derivable from `channel_actions.status` + `contacts.email` presence | 🟡 real inputs exist, no query built yet |
| `notes[]` | `notes` table, real shape (mirrors old `NotesLog.tsx`) | 🟢 mechanism real; the *specific* note text shown for DMK is illustrative example content, not asserted as a real row — verify before reuse |

### Templates panel

| Field | Source | Status |
|---|---|---|
| `TEMPLATES[].li1/li2/em` per signal type | `pipeline/config/copy_templates.json`, read by `build_linkedin_queue.mjs` + `route_email.mjs` | 🟢 content real, 🟡 **file structure itself needs the migration already in TODO.txt** (`li_step1_connection`/`li_step2_qualify` per key, `li_step3_call`/`li_followup` promoted to top-level fields) before the mockup's per-key shape is literally 1:1 with the file |

### Activity tab

| Field | Source | Status |
|---|---|---|
| All rows | `channel_actions`, real snapshot from the 2026-07-15 `route_email.mjs` run (123 rows) | 🟢 real but a stale one-time snapshot — real build queries live, not a frozen array |

### Settings — ICP Filter panel

| Field | Source | Status |
|---|---|---|
| All values (industries, countries, headcount, exec keywords, blacklists, staleness windows) | `pipeline/config/icp_filter.json`, live, read by `filter_icp.mjs`/`rank_leads.mjs`/`lib/staleness.mjs` | 🟢 confirmed live this session (was previously wrongly believed unimplemented — see CHANGELOG [Unreleased]) |

### Health page

| Field | Source | Status |
|---|---|---|
| Pipeline stages, drill-down (7d rollup + last 5 runs) | `pipeline_runs` | 🟢 real, live, already deployed to `/health` this session |
| Database tables (last write per table) | Live `MAX(timestamp)` query per table | 🟢 real, live, already deployed this session |

### Open question this audit surfaced (not yet answered)

`companies.tier`/`rank` come from `rank_leads.mjs`. `app_state.status` is the
existing CRM status field (`new/sent/replied/meeting/pass`) written by the old
frontend's `setStatus()`. `channel_actions.status` is a *different* status
vocabulary (`validated/pushed/skipped_no_email/...` for email,
`queued/exported/done/skipped` for LinkedIn) describing outreach-*mechanics*,
not CRM funnel stage. **The mockup's per-contact `statusState` (new/sent/
replied/meeting/pass) doesn't map cleanly onto either table as-is** — decide
during implementation whether per-contact CRM status is a new column
(`app_state` scoped to `contact_id` instead of just `company_id`) or derived
from `channel_actions`. This wasn't resolved in the mockup phase and needs a
real decision before the Leads detail panel can be wired for real.

---

## 2.5. Reusable components from outreach-cockpit — don't rebuild these from scratch

Both projects share the same foundation (shadcn/ui + Radix + Tailwind) — the
build tool differs (Vite vs Next.js) but that's irrelevant to plain React
component code. Checked `outreach-cockpit/src/` for components that are
generic (not reply-agent-specific) and map onto pieces of
`signals_v2_concept.html`:

**Copy near-verbatim, just re-parametrize:**
- `src/components/shell/IconRail.tsx` — same icon-rail pattern as our mockup
  (avatar, module icons, spacer, Settings pinned to bottom). Swap the `ITEMS`
  array for our modules (Leads/Analytics/Settings) and the color tokens for
  ours; the component logic is untouched.
- `src/shared/ui/DateRangePicker.tsx` — a real, finished, parametrized
  date-range picker (presets + manual calendar range + Cancel/Apply), built
  on shadcn `Calendar` (range mode) + `Popover`. Its own comment says it was
  built explicitly to replace the mockup's "hand-rolled month-grid/rounding
  math... throwaway markup for approving the design, not meant to ship" —
  exactly our situation with the Activity tab's `dr-wrap`/`dr-menu` vanilla-JS
  date picker. Use this instead of porting our mockup's version.

**Copy the shadcn primitives we don't have yet** (plain shadcn files, not
cockpit-specific — cockpit already did the "add this shadcn component"
step for us): `calendar.tsx`, `popover.tsx`, `dropdown-menu.tsx`,
`dialog.tsx`, `select.tsx`, `checkbox.tsx`, `tabs.tsx`. Our `nextjs/` already
has `badge.tsx`/`button.tsx`/`textarea.tsx` plus the underlying Radix/CVA/
clsx/tailwind-merge deps — same shadcn setup, these just fill in the rest.

**No equivalent exists in cockpit, build fresh (small, low-risk):**
- The filter accordion (Tier / Channel readiness / Signal origin, collapsible
  sections with live counts) — cockpit has no accordion component. Not worth
  pulling in a third-party lib for this; a plain `useState`-driven
  expand/collapse per section is a few lines.
- The grouped Settings sidebar (group labels + nav items + active panel
  switch) — structurally simple, no reason to hunt for a match.

---

## 2.6. Performance — lazy loading, matches real-SaaS load times

Leo's explicit ask: the current live frontend loads noticeably slower than a
typical SaaS product, and the rebuild should fix that "in reasonable measure"
— not a rewrite-everything performance project, but real frontend hygiene
that a from-scratch Next.js build gets mostly for free if set up correctly
from the start rather than retrofitted:

- **Route-level code splitting is automatic in Next.js App Router** — each
  `app/*/page.tsx` is already its own chunk. The one thing to actually decide:
  whether Settings/Analytics become real routes (`app/settings/page.tsx`,
  `app/analytics/page.tsx`) instead of client-side view-switching inside one
  giant component (`signals_v2_concept.html`'s `switchView()` pattern) — real
  routes get real code-splitting + real URLs (shareable, back-button-correct)
  for free; a single mega-component doesn't.
- **`next/dynamic` for anything genuinely heavy and not needed on first
  paint** — the Exa Analytics charts (currently hand-rolled canvas/SVG bar
  charts in the mockup) are the obvious candidate: lazy-load that whole
  module only when the Analytics route is actually visited, not bundled into
  the initial Leads page load.
- **Don't over-fetch on the Leads list.** `useLeads.ts`'s current pattern
  pulls `companies`/`signals`/`contacts`/`app_state` *in full* for every
  company up front (§1 above) — fine at today's ~30-company scale, but worth
  deciding now whether the list view needs a slimmer `select()` (just the
  sidebar's fields) with the full detail fetched lazily per-company on click,
  matching the mockup's own "list-only vs. fully wired" distinction from §2.
  This is the single highest-leverage fetch change since the sidebar loads
  before anything else.
- **Images/avatars**: nothing in the mockup uses real images today (initials
  in colored circles, computed client-side) — no `next/image` migration
  needed unless that changes.
- Out of scope for this prep doc (Fable/implementation-session call, needs
  real profiling once there's a real build to profile): bundle-size budget,
  whether to add React Query/SWR for cache-and-revalidate instead of the
  current raw `useEffect` fetch, Supabase query-level pagination if the lead
  count grows well past today's ~30-400 range.

---

## 3. Lessons from outreach-cockpit's own HTML→React port

`C:\Users\79818\Desktop\outreach-cockpit` already did exactly this kind of
migration (`mockups/reply-agent/*.html` → `src/features/reply-agent/`).
Mined its CHANGELOG for concrete pitfalls, each with how to avoid it here:

1. **Reading a mockup "from memory" instead of line-by-line fails visual QA.**
   A session that built Inbox from general recollection of `inbox.html`
   shipped a "supersimplified" version — missing avatars, color tags, states —
   caught only by Leo's screenshot diff. Fixed next session by reading the
   full mockup file end-to-end before writing any component code.
   → **For this migration: read `signals_v2_concept.html` in full, section by
   section, immediately before building each corresponding React piece — not
   from this document's summary, not from memory of earlier sessions.**

2. **Skipping live browser verification lets visual bugs ship undetected.**
   A whole session's scope was just Leo manually finding bugs (reversed chat
   bubbles, un-stripped quoted text, a broken chart legend toggle) that a
   Chrome-extension visual pass would have caught immediately if it had run.
   → **Treat "verified in a real running browser against the mockup
   screenshots" as a mandatory step per page, not optional polish.**

3. **Display-path logic silently drifts from the "real" logic path.** A text
   sanitizer (`stripQuotedHistory`) was correctly wired into the AI prompt
   path but the UI display path called an older function directly, skipping
   the same cleanup — quoted history leaked into the UI while the LLM saw
   clean text.
   → **When porting `localizeHookLine()`/`localizeMessage()` output into the
   UI, make sure the UI renders the exact same function's output the pipeline
   uses for real sends — never a second, similar-but-different formatting path.**

4. **Tailwind class-override footgun with shadcn `DialogContent`.** Passing
   `className="max-w-[900px]"` silently no-ops because the component's default
   already has `sm:max-w-sm` and `tailwind-merge` treats differently-prefixed
   width utilities as separate "slots" — both stay in the DOM, the
   media-query one wins.
   → **Any override of a shadcn component's responsive default must match the
   same breakpoint prefix** (e.g. `sm:max-w-[900px]`, not `max-w-[900px]`).

5. **shadcn primitives can render "successfully" but completely unstyled** if
   `tailwind.config.ts` never maps their CSS variables — no error, just
   silently wrong colors.
   → **Verify the shadcn CSS-variable → Tailwind config mapping once, early,
   before porting any component that depends on it** (button/input/select/
   checkbox/dropdown/dialog all shared this one root cause).

6. **Don't transliterate mockup-era vanilla-JS DOM idioms into React.** The
   mockup's dropdown-close pattern (`event.stopPropagation()`, manual
   `innerHTML` re-render) doesn't map onto React — the correct port is an
   outside-click listener (`mousedown` + `ref.contains()`), not a literal copy.
   → **`signals_v2_concept.html` has this same pattern throughout**
   (`toggleAcc()`, `switchSettingsSection()`, accordion/dropdown state as raw
   DOM class toggles) — re-derive as React state + conditional rendering,
   don't port the DOM-manipulation functions verbatim.

7. **Mockup assumptions about backend data shape can be flatly wrong.** A
   mockup showed "Campaign email · Step N" bubbles; live data showed
   `step_number` was `NULL` on 100% of real rows — had to degrade gracefully
   instead of trusting the mockup's assumption.
   → **This is exactly what Section 2 above is for** — every field was
   checked against a real column or a real query before trusting it enough to
   build against.

No formal "how to port HTML to React" writeup exists there beyond a running
checklist (`docs/frontend-rewrite-plan.md`) and a pre-port UI-pattern audit
(`mockups/PATTERNS.md`, done *before* porting — worth replicating: list every
recurring interactive pattern in `signals_v2_concept.html` — accordions,
tooltips, drill-downs, date-range picker — once, before writing components,
so each pattern gets one correct React implementation instead of N slightly
different ones).

---

## 4. Skill check

No existing Claude Code skill (global `~/.claude/skills/` or project-level
`.claude/skills/`) covers HTML-mockup-to-React conversion. Checked both;
nothing named or scoped to this exists today. Not proposing one be built —
this doc + the outreach-cockpit lessons above serve the same purpose for this
one migration. Revisit only if this becomes a recurring task across multiple
projects.

---

## 5. Suggested order for the real implementation session

Not a task breakdown (that's for the implementation session itself), just
sequencing logic based on the dependency chain this audit surfaced:

1. **Fable session**: resolve the two open questions in Section 0 (per-contact
   status storage, event-summary generation trigger) — blocks the detail
   panel's status chip, Activity tab, and the event drill-down respectively.
2. Migration 007 (`event_summary`) + `summarizeEvent()`, built per Q2's
   decision — blocks the event drill-down, one of the most-used UI elements.
3. Migration 008 (`channel_actions` contact_id in the unique constraint) —
   blocks per-contact outreach state being real instead of colliding.
4. `copy_templates.json` restructure — blocks Templates panel + real
   LinkedIn/email copy generation matching the mockup's per-key shape.
5. `localizeMessage()` + `/api/translate` — blocks the DE-language toggle on
   anything beyond the initial connection hook line.
6. Pull in the reusable components from Section 2.5 (`IconRail`,
   `DateRangePicker`, missing shadcn primitives) before writing any new
   component that would duplicate them — cheap to do early, avoids a
   find-and-replace pass later.
7. Decide the routing question from Section 2.6 (real `/settings` +
   `/analytics` routes vs. single-page view-switching) — affects how every
   subsequent component is structured, expensive to change after the fact.
8. The React rebuild itself, with the Section 2.6 fetch/lazy-load choices
   applied from the start (slim list-view `select()`, `next/dynamic` for the
   Analytics charts) rather than retrofitted after — by this point every
   field in Section 2 is either 🟢 or has its 🔴/🟡 gap closed, so the build
   isn't blocked mid-flight discovering a missing column.
