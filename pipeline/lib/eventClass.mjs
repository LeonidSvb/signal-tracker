// Event-class table (A2, docs/HANDOFF_2026-07-15_scoring_two_channel.md) — maps a
// signal_type to Class A/B/C, which drives BOTH the PlusVibe campaign a lead lands
// in (A6: SIG-A/SIG-B/SIG-C, one evergreen campaign per class) and — separately —
// rank_leads.mjs's company tier math (Fable's build, not duplicated here).
//
// Class A — MA, CLEVEL, HIRING_EXEC, HIRING_SURGE
// Class B — EXPAND, INVEST, HIRING_MID
// Class C — CONTRACT, NICHE, SECTOR, HIRING_STALE
//
// HIRING_RECRUITER isn't in A2's class table (the section reuses HIRING_MID's
// sequence per 1E, "SEQUENCE: такой же как 1B") — treated as Class B here to match
// that reuse; flag to Leo if that assumption turns out wrong once real volume flows
// through it.

const CLASS_A = new Set(['MA', 'CLEVEL', 'HIRING_EXEC', 'HIRING_SURGE']);
const CLASS_B = new Set(['EXPAND', 'INVEST', 'HIRING_MID', 'HIRING_RECRUITER']);
const CLASS_C = new Set(['CONTRACT', 'NICHE', 'SECTOR', 'HIRING_STALE']);

export function eventClass(signalType) {
  const t = String(signalType || '').toUpperCase();
  if (CLASS_A.has(t)) return 'A';
  if (CLASS_B.has(t)) return 'B';
  if (CLASS_C.has(t)) return 'C';
  return 'C'; // unknown types default to the lightest sequence, never the hottest
}
