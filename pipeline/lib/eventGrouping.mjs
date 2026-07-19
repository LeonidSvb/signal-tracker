// Event grouping + tier/rank math for rank_leads.mjs (B2/A1/A2 in
// docs/HANDOFF_2026-07-15_scoring_two_channel.md). Pure functions, no I/O — the
// stage owns DB reads/writes and the sameEvent() LLM calls; this module owns the
// algorithm so it stays unit-testable (test/eventGrouping.test.mjs).
//
// An EVENT is the union of three groupings over one company's signals (A1):
//   (1) same source_url — migration-004 cross-monitor duplication;
//   (2) same normalized title — different monitors, byte-identical headline
//       (news only: two DIFFERENT job postings can share a title, so HIRING
//       signals never merge by title — one posting = one event);
//   (3) same Q6 near-dup cluster — Jaccard >= 0.3 over title words + pub_date
//       within 7 days (wider than classify_company's 4: outlets lag each other
//       more than monitors do), confirmed by ONE sameEvent() LLM call per
//       cluster. The stage supplies verdicts (cache-first); unconfirmed clusters
//       stay UNMERGED (conservative: a missed merge overcounts events, a wrong
//       merge silently deletes one).
// event_key = lowest member signal uuid at grouping time (deterministic, stable
// as long as the lowest member survives; late-arriving duplicates re-fold on the
// next run per A1).

import { eventClass } from './eventClass.mjs';
import { isStale, stalenessDays } from './staleness.mjs';

// ── text utils (same normalization family as score_signals.mjs / classify_company.mjs) ──

const ACCENT_MAP = { é:'e',è:'e',ê:'e',ë:'e',à:'a',â:'a',ü:'u',ö:'o',ä:'a',ß:'ss',ç:'c',û:'u',î:'i',ï:'i',ô:'o',œ:'oe',æ:'ae',ø:'o',å:'a' };
export function normTitle(s) {
  return String(s || '').toLowerCase()
    .replace(/[éèêëàâüöäßçûîïôœæøå]/g, c => ACCENT_MAP[c] || c)
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

const STOPWORDS = new Set(['the','and','for','with','from','into','over','company','food','group','gmbh','sa','nv','bv']);
export function titleWordSet(title) {
  return new Set(normTitle(title).split(' ').filter(w => w.length > 3 && !STOPWORDS.has(w)));
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter(w => b.has(w)).length;
  return shared / (a.size + b.size - shared);
}

export function isHiringType(signalType) {
  return String(signalType || '').toUpperCase().startsWith('HIRING');
}

// ── union-find ────────────────────────────────────────────────────────────────

export class UnionFind {
  constructor(ids) { this.parent = new Map(ids.map(i => [i, i])); }
  find(x) {
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(x) !== root) { const next = this.parent.get(x); this.parent.set(x, root); x = next; }
    return root;
  }
  union(a, b) { this.parent.set(this.find(a), this.find(b)); }
  groups() {
    const out = new Map();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      if (!out.has(root)) out.set(root, []);
      out.get(root).push(id);
    }
    return out;
  }
}

// ── grouping rules 1 + 2 (free, deterministic) ───────────────────────────────

// signals: one company's rows [{id, signal_type, title, source_url, pub_date}]
export function buildInitialGroups(signals) {
  const uf = new UnionFind(signals.map(s => s.id));
  const firstByUrl = new Map(), firstByTitle = new Map();
  for (const s of signals) {
    if (s.source_url) {
      if (firstByUrl.has(s.source_url)) uf.union(s.id, firstByUrl.get(s.source_url));
      else firstByUrl.set(s.source_url, s.id);
    }
    if (!isHiringType(s.signal_type)) { // one job posting = one event; titles never merge postings
      const t = normTitle(s.title);
      if (t) {
        if (firstByTitle.has(t)) uf.union(s.id, firstByTitle.get(t));
        else firstByTitle.set(t, s.id);
      }
    }
  }
  return uf;
}

// ── rule 3 candidates (free) — clusters that need one sameEvent() verdict each ──
//
// 2026-07-17 (Leo): dropped the Jaccard word-overlap pre-filter that used to gate
// which same-company pairs even got a sameEvent() call. Found live on DMK Group:
// "DMK Group invests €25m in lactoferrin production..." and "DMK Group invests in
// German dairy plant" are almost certainly the same investment story, but share so
// few significant words the old jaccard>=0.3 gate never sent them to the LLM at
// all — a silent recall miss, not a wrong verdict. Leo's call: accuracy over
// OpenRouter cost here (cents), so the free filter is gone — every same-company
// pair inside the date window becomes a cluster candidate and sameEvent() decides.
// windowDays is now the ONLY free gate (time-adjacency, not a text heuristic) —
// still needed so a company's whole multi-month signal history doesn't become one
// giant cluster.

export function findCandidateClusters(signals, uf, { windowDays = 7 } = {}) {
  const repByRoot = new Map(); // one representative news signal per current group
  for (const s of signals) {
    if (isHiringType(s.signal_type)) continue;
    const root = uf.find(s.id);
    if (!repByRoot.has(root)) repByRoot.set(root, s);
  }
  const reps = [...repByRoot.values()];
  const used = new Set(), clusters = [];
  for (const s of reps) {
    if (used.has(s.id)) continue;
    const cluster = [s];
    for (const t of reps) {
      if (t.id === s.id || used.has(t.id)) continue;
      const da = new Date(s.pub_date || 0), db = new Date(t.pub_date || 0);
      if (Math.abs(da - db) > windowDays * 86_400_000) continue;
      cluster.push(t);
    }
    if (cluster.length > 1) { for (const c of cluster) used.add(c.id); clusters.push(cluster); }
  }
  return clusters;
}

// verdictGroups: sameEvent()'s {groups: [[1,2],[3]]} — 1-based indices into clusterSignals.
export function applySameEventGroups(uf, clusterSignals, verdictGroups) {
  let merged = 0;
  for (const g of verdictGroups || []) {
    if (!Array.isArray(g) || g.length < 2) continue;
    const members = g.map(i => clusterSignals[i - 1]).filter(Boolean);
    for (let i = 1; i < members.length; i++) { uf.union(members[0].id, members[i].id); merged++; }
  }
  return merged;
}

// ── events ────────────────────────────────────────────────────────────────────

// Strongest-first order inside the news family (A2 class order, then intra-class).
const NEWS_STRENGTH = ['MA', 'CLEVEL', 'EXPAND', 'INVEST', 'CONTRACT', 'NICHE', 'SECTOR'];
function strongestType(types) {
  const news = types.filter(t => !isHiringType(t));
  if (!news.length) return 'HIRING';
  return NEWS_STRENGTH.find(t => news.includes(t)) || news[0];
}

export function finalizeEvents(signals, uf) {
  const byRoot = new Map();
  for (const s of signals) {
    const root = uf.find(s.id);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(s);
  }
  return [...byRoot.values()].map(members => {
    const ids = members.map(m => m.id).sort(); // uuid string sort — deterministic
    const pubDates = members.map(m => m.pub_date).filter(Boolean).sort();
    return {
      eventKey: ids[0], // lowest member id at grouping time (A1)
      memberIds: ids,
      members,
      // Event date = LATEST coverage among members: outlets lag each other (that is
      // why the 7-day cluster window exists), and the freshness window measures how
      // long the story is still a warm door-opener — last coverage, not first.
      pubDate: pubDates.length ? pubDates[pubDates.length - 1] : null,
      baseType: strongestType(members.map(m => String(m.signal_type || '').toUpperCase())),
      title: members[0].title || null,
    };
  });
}

// ── event classification (B2 step 4) ─────────────────────────────────────────

// Top band per playbook БЛОК 1A: CEO / GF / MD / DG / PDG (+ spelled-out and
// language variants; General Manager included — subsidiary-level N1, same
// placement class per score_signals EXEC_HIGH). Word-boundary match so 'MD'/'DG'
// abbreviations don't fire inside words.
// NOTE: matched against normTitle() output — accents already folded (ä→a, ü→u,
// ß→ss, é→e), so the German/French alternations cover both folded and ae/ue
// spelled-out forms.
export const TOP_BAND_RE = /\b(ceo|chief executive(?: officer)?|gf|gesch(?:a|ae)ftsf(?:u|ue)hrer(?:in)?|managing director|md|dg|directeur general(?:e)?|directrice generale|pdg|pr(?:a|e|ae)sident directeur|algemeen directeur|general manager)\b/;

export function hiringExecBand(title) {
  return TOP_BAND_RE.test(normTitle(title));
}

// event -> { type, cls } (HIRING splits into EXEC/MID/STALE; news passes through A2 table)
export function classifyEvent(event, { now = Date.now() } = {}) {
  if (event.baseType !== 'HIRING') {
    return { type: event.baseType, cls: eventClass(event.baseType) };
  }
  const ageDays = event.pubDate ? (now - new Date(event.pubDate).getTime()) / 86_400_000 : 0;
  if (ageDays > 60) return { type: 'HIRING_STALE', cls: eventClass('HIRING_STALE') }; // posting >60d and still up
  const exec = event.members.some(m => hiringExecBand(m.title));
  const type = exec ? 'HIRING_EXEC' : 'HIRING_MID';
  return { type, cls: eventClass(type) };
}

// ── event summary gate (D3 in docs/adr/009-frontend-v2-concept.md; Q2 in
//    docs/PLAN_2026-07-19_react_migration_prep.md §0) ────────────────────────

// Dedupe an event's members by source_url — the whole point of D3: raw signal
// count (multiple Exa monitors catching the identical URL) != real distinct
// source count. A signal with no source_url can't be deduped against another
// one, so each counts as its own source.
export function uniqueSourceCount(members) {
  const urls = new Set();
  let noUrl = 0;
  for (const m of members) {
    if (m.source_url) urls.add(m.source_url);
    else noUrl++;
  }
  return urls.size + noUrl;
}

// True when event_summary should be (re)generated for this event's members:
// either none of them have one yet (never generated), or they disagree (a
// late-arriving signal re-folded into an already-summarized event — cheapest
// possible "member set changed" detector, no separate timestamp needed).
// False when every member already carries the SAME non-null summary — already
// correct, no LLM call needed.
export function needsEventSummary(members) {
  const summaries = new Set(members.map(m => m.event_summary || null));
  if (summaries.size === 1) return summaries.has(null); // all null = never generated; all-same-non-null = up to date
  return true; // disagreement = re-fold happened, regenerate
}

// ── tier + rank (A2) ──────────────────────────────────────────────────────────

// staleness window lookup: HIRING_* sub-classes share the HIRING window
export function windowTypeOf(type) {
  return isHiringType(type) ? 'HIRING' : type;
}

export function isEventFresh(ev, now = Date.now()) {
  return !isStale(windowTypeOf(ev.type), ev.pubDate, now);
}

const CLASS_WEIGHT = { A: 5, B: 3, C: 1 };

function freshnessBonus(ev, now) {
  if (!ev.pubDate) return 3; // undated = just seen, treat as freshest
  const ageDays = (now - new Date(ev.pubDate).getTime()) / 86_400_000;
  if (ageDays <= 7) return 3;
  if (ageDays <= 14) return 2;
  if (ageDays <= stalenessDays(windowTypeOf(ev.type))) return 1;
  return 0;
}

// events: classified [{eventKey, type, cls, pubDate}]
// Returns { tier, rank, tierReason, bestEvent, surge, multiEvent } — tier null when
// nothing is actionable (ICP gating happens in the STAGE before this is called).
export function tierCompany({ events, hasReadyContact = false, now = Date.now() }) {
  if (!events.length) return { tier: null, rank: null, tierReason: 'no_fresh_event', bestEvent: null, surge: false, multiEvent: false };

  const fresh = events.filter(e => isEventFresh(e, now));

  // HIRING_SURGE (A2/B2.4): 2+ distinct OPEN hiring events → Class A regardless of band.
  const openHiring = fresh.filter(e => e.type === 'HIRING_EXEC' || e.type === 'HIRING_MID');
  const surge = openHiring.length >= 2;

  const in90d = events.filter(e => e.pubDate && (now - new Date(e.pubDate).getTime()) <= 90 * 86_400_000);
  const multiEvent = in90d.length >= 2;

  const byStrength = (a, b) =>
    (CLASS_WEIGHT[b.cls] - CLASS_WEIGHT[a.cls]) ||
    (new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

  let bestFresh = fresh.length ? [...fresh].sort(byStrength)[0] : null;
  if (surge && (!bestFresh || bestFresh.cls !== 'A')) {
    // synthetic company-level event: the surge itself is the Class-A signal
    const newestOpen = [...openHiring].sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))[0];
    bestFresh = { eventKey: newestOpen.eventKey, type: 'HIRING_SURGE', cls: 'A', pubDate: newestOpen.pubDate };
  }

  let tier = null;
  if ((bestFresh && bestFresh.cls === 'A') || multiEvent) tier = 'T1';
  else if (bestFresh && bestFresh.cls === 'B') tier = 'T2';
  else if (bestFresh && bestFresh.cls === 'C') tier = 'T3';

  if (!tier) return { tier: null, rank: null, tierReason: 'no_fresh_event', bestEvent: null, surge, multiEvent };

  // rank basis: best fresh event; T1-via-multi-event with zero fresh events falls
  // back to the strongest event in the 90d window (freshness bonus then lands 0).
  const basis = bestFresh || [...in90d].sort(byStrength)[0];
  const rank = CLASS_WEIGHT[basis.cls]
    + freshnessBonus(basis, now)
    + (multiEvent ? 2 : 0)
    + (hasReadyContact ? 1 : 0);

  const ageDays = basis.pubDate ? Math.round((now - new Date(basis.pubDate).getTime()) / 86_400_000) : 0;
  const parts = [];
  if (bestFresh && bestFresh.cls === 'A') parts.push(`fresh class A: ${basis.type} (${ageDays}d)`);
  else if (bestFresh) parts.push(`best fresh event ${basis.type} (class ${basis.cls}, ${ageDays}d)`);
  if (multiEvent) parts.push(`multi-event: ${in90d.length} events in 90d`);
  if (surge) parts.push(`hiring surge: ${openHiring.length} open postings`);

  return { tier, rank, tierReason: parts.join('; '), bestEvent: basis, surge, multiEvent };
}
