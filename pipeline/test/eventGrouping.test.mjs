// Run: node --test signals/pipeline/test/eventGrouping.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normTitle, titleWordSet, jaccard, isHiringType, UnionFind,
  buildInitialGroups, findCandidateClusters, applySameEventGroups,
  finalizeEvents, classifyEvent, hiringExecBand, tierCompany,
} from '../lib/eventGrouping.mjs';

const NOW = new Date('2026-07-15T00:00:00.000Z').getTime();
let seq = 0;
function sig(over = {}) {
  return { id: `id-${String(++seq).padStart(3, '0')}`, signal_type: 'EXPAND', title: 't', source_url: null, pub_date: '2026-07-10', ...over };
}
function groupCount(signals, uf) {
  return new Set(signals.map(s => uf.find(s.id))).size;
}

// ── grouping rules 1+2 ────────────────────────────────────────────────────────

test('DMK scenario: same source_url across monitors collapses to one event', () => {
  // one €25m plant investment caught by 4 monitor categories + 2 more via identical title
  const url = 'https://outlet.de/dmk-25m';
  const signals = [
    sig({ signal_type: 'SECTOR', source_url: url, title: 'DMK invests 25m in plant' }),
    sig({ signal_type: 'EXPAND', source_url: url, title: 'DMK invests 25m in plant' }),
    sig({ signal_type: 'INVEST', source_url: url, title: 'DMK invests 25m in plant' }),
    sig({ signal_type: 'NICHE', source_url: url, title: 'DMK invests 25m in plant' }),
    sig({ signal_type: 'INVEST', source_url: 'https://other.de/x', title: 'DMK invests 25m in plant' }), // same title, other outlet
  ];
  const uf = buildInitialGroups(signals);
  assert.equal(groupCount(signals, uf), 1);
  const events = finalizeEvents(signals, uf);
  assert.equal(events.length, 1);
  assert.equal(events[0].memberIds.length, 5);
  // strongest member type wins: EXPAND before INVEST before NICHE/SECTOR
  assert.equal(events[0].baseType, 'EXPAND');
  // event_key = lowest member id
  assert.equal(events[0].eventKey, events[0].memberIds[0]);
});

test('two different job postings never merge by title', () => {
  const signals = [
    sig({ signal_type: 'HIRING', source_url: 'https://board/a', title: 'Plant Manager' }),
    sig({ signal_type: 'HIRING', source_url: 'https://board/b', title: 'Plant Manager' }),
  ];
  const uf = buildInitialGroups(signals);
  assert.equal(groupCount(signals, uf), 2); // one posting = one event
});

test('same posting re-listed at same url merges', () => {
  const signals = [
    sig({ signal_type: 'HIRING', source_url: 'https://board/a', title: 'Plant Manager' }),
    sig({ signal_type: 'HIRING', source_url: 'https://board/a', title: 'Plant Manager (m/w/d)' }),
  ];
  assert.equal(groupCount(signals, buildInitialGroups(signals)), 1);
});

// ── rule 3: Q6 clusters + verdicts ───────────────────────────────────────────

test('near-dup titles cluster within the date window (no text pre-filter) and merge only on verdict', () => {
  // 2026-07-17: the Jaccard word-overlap gate is gone (DMK case — same story, too
  // few shared words to pass jaccard>=0.3). The candidate cluster is now purely
  // date-window based, so ALL three signals below land in one cluster (the
  // unrelated bakery included) — sameEvent() is the only thing that tells them
  // apart, via the verdict groups, not a free pre-filter.
  const signals = [
    sig({ title: 'Schouten Europe neemt Bobeldijk over', pub_date: '2026-07-08', source_url: 'https://nl/1' }),
    sig({ title: 'Schouten Europe buys plant-based peer Bobeldijk', pub_date: '2026-07-11', source_url: 'https://en/2' }),
    sig({ title: 'Unrelated bakery opens Antwerp site', pub_date: '2026-07-10', source_url: 'https://be/3' }),
  ];
  const uf = buildInitialGroups(signals);
  assert.equal(groupCount(signals, uf), 3); // free rules alone: no merge
  const clusters = findCandidateClusters(signals, uf, { windowDays: 7 });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].length, 3); // all three are date-adjacent candidates now
  // sameEvent() verdict does the real work: groups the two Schouten headlines,
  // leaves the bakery (index 3) alone.
  applySameEventGroups(uf, clusters[0], [[1, 2]]);
  assert.equal(groupCount(signals, uf), 2);
});

test('semantically-same headline with near-zero word overlap still becomes a cluster candidate (DMK case)', () => {
  const signals = [
    sig({ title: 'DMK Group invests €25m in lactoferrin production to expand functional ingredients portfolio', pub_date: '2026-05-28', source_url: 'https://a/1' }),
    sig({ title: 'DMK Group invests in German dairy plant', pub_date: '2026-05-27', source_url: 'https://b/2' }),
  ];
  assert.ok(jaccard(titleWordSet(signals[0].title), titleWordSet(signals[1].title)) < 0.3); // would have been filtered out before
  const uf = buildInitialGroups(signals);
  const clusters = findCandidateClusters(signals, uf, { windowDays: 7 });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].length, 2); // now reaches sameEvent() instead of being silently skipped
});

test('cluster candidates respect the pub_date window', () => {
  const signals = [
    sig({ title: 'Schouten Europe neemt Bobeldijk over', pub_date: '2026-06-01', source_url: 'https://nl/1' }),
    sig({ title: 'Schouten Europe buys plant-based peer Bobeldijk', pub_date: '2026-07-11', source_url: 'https://en/2' }),
  ];
  const uf = buildInitialGroups(signals);
  assert.equal(findCandidateClusters(signals, uf, { windowDays: 7 }).length, 0);
});

// ── classification ────────────────────────────────────────────────────────────

test('hiring exec band: top band matches, mid does not', () => {
  assert.equal(hiringExecBand('Geschäftsführer (m/w/d) Molkerei'), true);
  assert.equal(hiringExecBand('CEO — Bakery Group'), true);
  assert.equal(hiringExecBand('Directeur Général adjoint'), true);
  assert.equal(hiringExecBand('PDG'), true);
  assert.equal(hiringExecBand('Vertriebsleiter Süßwaren'), false);
  assert.equal(hiringExecBand('HR Business Partner'), false);
  assert.equal(hiringExecBand('Commande de produits'), false); // 'md'/'dg' must not fire inside words
});

test('classifyEvent: HIRING splits into EXEC / MID / STALE', () => {
  const mk = (title, pub) => {
    const s = sig({ signal_type: 'HIRING', title, pub_date: pub, source_url: `https://b/${seq}` });
    const uf = buildInitialGroups([s]);
    return finalizeEvents([s], uf)[0];
  };
  assert.equal(classifyEvent(mk('Geschäftsführer Nachfolge', '2026-07-10'), { now: NOW }).type, 'HIRING_EXEC');
  assert.equal(classifyEvent(mk('Produktionsplaner', '2026-07-10'), { now: NOW }).type, 'HIRING_MID');
  const stale = classifyEvent(mk('Geschäftsführer Nachfolge', '2026-04-01'), { now: NOW }); // 105d... beyond 60d
  assert.equal(stale.type, 'HIRING_STALE');
  assert.equal(stale.cls, 'C');
});

// ── tier + rank (A2) ─────────────────────────────────────────────────────────

const ev = (type, cls, pubDate, key = `ek-${++seq}`) => ({ eventKey: key, type, cls, pubDate, memberIds: [key], members: [] });

test('fresh class A event → T1, rank = 5 + freshness + contact', () => {
  const t = tierCompany({ events: [ev('MA', 'A', '2026-07-12')], hasReadyContact: true, now: NOW });
  assert.equal(t.tier, 'T1');
  assert.equal(t.rank, 5 + 3 + 0 + 1); // 3d old → +3 fresh, no multi-event, +1 contact
});

test('two distinct events in 90d promote to T1 even without class A', () => {
  const t = tierCompany({ events: [ev('EXPAND', 'B', '2026-07-01'), ev('CONTRACT', 'C', '2026-06-01')], now: NOW });
  assert.equal(t.tier, 'T1');
  assert.equal(t.rank, 3 + 2 + 2 + 0); // best fresh EXPAND(B)=3, exactly 14d → +2, multi +2
  assert.ok(t.multiEvent);
});

test('single fresh class B → T2; single fresh class C → T3', () => {
  assert.equal(tierCompany({ events: [ev('INVEST', 'B', '2026-07-10')], now: NOW }).tier, 'T2');
  assert.equal(tierCompany({ events: [ev('SECTOR', 'C', '2026-07-10')], now: NOW }).tier, 'T3');
});

test('2+ open hiring events = HIRING_SURGE → T1 class A basis', () => {
  const t = tierCompany({ events: [ev('HIRING_MID', 'B', '2026-07-10'), ev('HIRING_MID', 'B', '2026-07-05')], now: NOW });
  assert.equal(t.tier, 'T1');
  assert.ok(t.surge);
  assert.equal(t.bestEvent.type, 'HIRING_SURGE');
  assert.equal(t.rank, 5 + 3 + 2 + 0); // A weight + <=7d + multi-event
});

test('only stale events, no multi-event window → no tier', () => {
  const t = tierCompany({ events: [ev('CLEVEL', 'A', '2026-05-01')], now: NOW }); // 75d > 30d CLEVEL window
  assert.equal(t.tier, null);
  assert.equal(t.tierReason, 'no_fresh_event');
});

test('stale CLEVEL pair inside 90d still promotes via multi-event (spec-literal)', () => {
  const t = tierCompany({ events: [ev('CLEVEL', 'A', '2026-05-20'), ev('NICHE', 'C', '2026-05-25')], now: NOW });
  assert.equal(t.tier, 'T1'); // both stale, both within 90d — A2 literal reading
  assert.equal(t.rank, 5 + 0 + 2 + 0); // basis = strongest in 90d (CLEVEL/A), freshness 0
});

// ── utils ─────────────────────────────────────────────────────────────────────

test('normTitle folds accents and case', () => {
  assert.equal(normTitle('Geschäftsführer — Süßwaren'), 'geschaftsfuhrer susswaren');
});

test('jaccard on word sets', () => {
  const a = titleWordSet('Schouten Europe neemt Bobeldijk over');
  const b = titleWordSet('Schouten Europe buys Bobeldijk');
  assert.ok(jaccard(a, b) >= 0.3);
});

test('UnionFind path compression basics', () => {
  const uf = new UnionFind(['a', 'b', 'c']);
  uf.union('a', 'b');
  uf.union('b', 'c');
  assert.equal(uf.find('a'), uf.find('c'));
  assert.equal(uf.groups().size, 1);
});

test('isHiringType covers subtypes', () => {
  assert.ok(isHiringType('HIRING'));
  assert.ok(isHiringType('HIRING_EXEC'));
  assert.ok(!isHiringType('MA'));
});
