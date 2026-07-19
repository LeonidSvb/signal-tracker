# HANDOFF — Frontend v2.0 Real Build (Sonnet execution session)

Written by Fable 2026-07-19. Same split as the backend-hardening handoff:
Fable decided the architecture, Sonnet executes stage by stage. Every open
question is already resolved — if something here seems to need a new
architectural decision, re-read `docs/PLAN_2026-07-19_react_migration_prep.md`
first; it is probably already decided there.

## Required reading, in order, before any code

1. `docs/PLAN_2026-07-19_react_migration_prep.md` — the whole thing. §0 has
   both resolved architecture decisions (contact_state table; eager
   event_summary). §2 is the field-by-field data-source audit. §2.5 lists
   what to copy from outreach-cockpit. §2.6 is the performance requirements.
   §3 is the pitfall list from cockpit's own HTML→React port — treat it as
   binding, especially #1 (read the mockup line-by-line immediately before
   building each piece, never from memory) and #2 (browser verification is a
   real step, not polish).
2. `mockups/signals_v2_concept.html` — the source of truth for every screen.
   Do NOT skim it now and recall it later; re-read the relevant section at
   the start of each UI stage.
3. `docs/adr/009-frontend-v2-concept.md` — why the design is the way it is.

## Rules of engagement

- **One stage = one commit.** A stage is not done until its gates (below) are
  green. Commit messages follow the repo's existing style (see `git log`),
  via `git commit -F <scratchpad file>` to avoid the bash-parentheses bug.
- **Gates for every stage:** `npx tsc --noEmit` in `nextjs/` + `npm run build`
  in `nextjs/` (when frontend was touched) + `node --test pipeline/test/*.test.mjs`
  (when pipeline was touched; use the GLOB form — directory form false-fails
  on Windows). All green before commit, no exceptions, failures reported to
  Leo verbatim if stuck.
- **Unit tests where logic is pure, nowhere else.** Pipeline side: node --test
  next to the existing five test files. Frontend side: add `vitest` to
  `nextjs/` devDependencies at the first pure-logic test (cockpit precedent —
  it uses vitest too). Mandatory test targets are listed per stage below; do
  not write render/snapshot tests for simple markup.
- **Browser checks:** after each UI stage (5-8), a quick Claude-in-Chrome
  smoke pass on the touched pages if the extension is connected (cockpit
  lesson #2: skipping this once cost a whole bugfix session). The FULL
  debugging pass is Stage 9 — Leo's explicit structure.
- **Migrations are applied by Leo** through the SSH tunnel (see CLAUDE.md
  "DB — как применять миграции"). Write the SQL, hand Leo the exact psql
  command, wait for confirmation, then verify live via a REST query before
  proceeding. Never assume a migration landed.
- **Paid APIs (OpenRouter etc.):** describe + wait for "да запускай" per
  CLAUDE.md, as always. Exception already granted by precedent: cache-first
  sameEvent()-style calls during a dry-run Leo has approved.
- **Leo's standing asks for this build:** fast loading like a real SaaS
  (prep doc §2.6 — slim list select, lazy detail fetch, real routes for
  code-splitting, next/dynamic for charts) — build it in from the start, do
  not retrofit.
- There are ~8 unpushed commits on main. Pushing (= Coolify prod rebuild) is
  Leo's call — ask before the first push, don't assume.

## Stages

### Stage 0 — Baseline
Read the required reading. `npm install` + dev server boots + `tsc --noEmit`
green + `node --test pipeline/test/*.test.mjs` → 39/39 (verified green at
handoff time). No commit unless something needed fixing.

### Stage 1 — Migrations 007 + 009 + 008
Write three SQL files in `db/migrations/` following 005's file style
(header comment: what/why/how-to-apply):
- **007** `signals.event_summary text` (+ nothing else — column only).
- **008** `channel_actions`: fold `contact_id` into the unique constraint →
  `unique(client_id, company_id, contact_id, channel, event_key)`; update
  `channelActionKey()` in `pipeline/lib/channelActions.mjs` to match
  (`${companyId}::${contactId}::${eventKey}`), and every caller/indexer of it.
- **009** `contact_state` — exact DDL is in prep doc §0 Q1 (check constraint
  on status, `unique(client_id, contact_id)`, updated_at trigger like 005).
Hand Leo the psql commands, wait, verify all three live. Update
`docs/SCHEMA.md` (it still says "005 not applied" — check reality first).
**Tests:** none new (DDL). Gate: live verification queries. Commit.

### Stage 2 — summarizeEvent() + rank_leads wiring
Per prep doc §0 Q2: `summarizeEvent()` next to `sameEvent()` in
`pipeline/lib/companyClassifier.mjs`, same model, same fetch helper. New
file-cache `exa/cache/event_summary_cache.json` keyed by sorted member ids.
Wire into `rank_leads.mjs`: events with ≥2 unique source_urls only; write to
`signals.event_summary` on all member rows; regenerate when a member row has
NULL summary inside an event that has one.
**Tests (mandatory):** node --test for the pure parts — member-set-change
detector, ≥2-unique-source gate, prompt construction. LLM call itself: one
real run with Leo's "да запускай".
Gate: tests + a dry-run against real data showing sane summaries. Commit.

### Stage 3 — copy_templates.json restructure
Per TODO.txt: `li_step1_connection`/`li_step2_qualify` PER key (9 keys),
`li_step3_call`/`li_followup` promoted to top-level. Update the consumers
(`build_linkedin_queue.mjs`; TODO says `route_email.mjs` untouched — verify
that claim against its actual reads before trusting it).
**Tests:** existing suite must stay green; add a shape-validation test for
the new structure (every key has both li_ steps, top-level fields exist).
Commit.

### Stage 4 — localizeMessage() + /api/translate
`localizeMessage()` in `copyEngine.mjs` — sibling of `localizeHookLine()`,
its own prompt for full multi-line messages (do NOT stretch the hook-line
prompt — explicit prior decision). `/api/translate` Next.js route calling it
server-side (OpenRouter key stays server-side, same pattern as
api/health using env on the server).
**Tests:** node --test for prompt construction + response parsing;
copyEngine.test.mjs stays green. One real translation call with permission.
Commit.

### Stage 5 — Frontend foundation
- Copy from `C:\Users\79818\Desktop\outreach-cockpit`: `IconRail.tsx`
  (re-parametrize ITEMS to Leads/Analytics/Settings + our tokens),
  `DateRangePicker.tsx`, and the missing shadcn primitives (`calendar`,
  `popover`, `dropdown-menu`, `dialog`, `select`, `checkbox`, `tabs`).
- Verify the shadcn CSS-variable → tailwind.config mapping FIRST (cockpit
  pitfall #5 — silently unstyled components) and remember pitfall #4
  (breakpoint-prefixed overrides like `sm:max-w-*`).
- Real routes per §2.6: `/` (Leads module with Leads/Activity tabs),
  `/settings`, `/analytics`, `/health` (exists). Delete the old components
  listed in prep doc §1 (LeadCard/Sidebar/ContactCard/Header + old page.tsx
  body); keep `lib/supabase.ts`, `useNotes()`, the fetch skeleton.
**Tests:** tsc + build. Chrome smoke: rail renders, routes switch. Commit.

### Stage 6 — Leads module (the big one)
Sidebar (search, status accordion, Tier/Channel/Origin accordions with live
counts, company row-list) + detail panel (header, events drill-down with
event_summary, contacts row-list — ALL contacts, never slice(0,2) —
per-contact outreach with status buttons writing to `contact_state`, notes
via existing `useNotes()`). Data per §2.6: slim list `select()`, full detail
fetched lazily on company click. Company chip = `aggregateStatus()` over
contact_state with app_state fallback (§0 Q1).
**Tests (mandatory, vitest):** `aggregateStatus()` (port mockup logic:
most-advanced wins, pass only if ALL pass), app_state-fallback selector,
filter predicate logic. Chrome smoke against the mockup side-by-side. Commit
— this stage may split into 2 commits (sidebar / detail) if large, each gated.

### Stage 7 — Activity tab + Settings + Templates
Activity: live `channel_actions` query, DateRangePicker (from Stage 5),
channel segment filter, search. Settings: grouped sidebar, Templates panel
reading `copy_templates.json` shape from Stage 3, ICP Filter read-only panel
reading `icp_filter.json`, Health link. **Tests:** date-preset math (vitest)
if hand-written; tsc/build; Chrome smoke. Commit.

### Stage 8 — Analytics page
Port `mockups/exa-analytics.html` content into `/analytics`, loaded via
`next/dynamic` so charts never enter the initial bundle (§2.6). Real queries
against `raw_signals` replacing the mockup's frozen arrays where they exist;
anything the mockup computed from a live query at capture time gets the same
query for real. **Tests:** tsc/build; Chrome smoke. Commit.

### Stage 9 — Full Claude-in-Chrome debugging pass (Leo's explicit final stage)
Page by page against `signals_v2_concept.html` opened side-by-side: visual
diff, every click path (accordions, drill-downs, status buttons, language
toggle, date picker, copy buttons, cross-page rail nav), console errors,
network failures, loading states on slow fetch. Fix everything found; each
fix batch = its own commit. Then, with Leo's explicit go: push (Coolify
rebuild) — and note pipeline changes (stages 2-4) also need the VPS pipeline
copy at `/opt/apps/projects/philippe-signals-pipeline/` refreshed, same
rsync/scp path as the backend-hardening deploy.

## Done means
Every mockup element either works against real data or visibly degrades per
the audit's fallback rules (NULL event_summary → signal title; no
contact_state rows → app_state status). No 🔴 item from prep doc §2 remains
unimplemented without Leo explicitly deferring it. CHANGELOG + TODO updated,
ADR-009 amended if any design decision shifted during the build.
