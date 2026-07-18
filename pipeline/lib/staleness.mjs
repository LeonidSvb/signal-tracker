// Per-signal-type staleness windows — single source of truth is
// pipeline/config/icp_filter.json's staleness_days block. Replaces
// score_signals.mjs's old calcExpires(), which hardcoded 30d for every news
// signal (and 90d for hiring) regardless of signal_type — F4 in
// docs/HANDOFF_2026-07-15_scoring_two_channel.md.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ICP_CFG = JSON.parse(readFileSync(join(__dir, '../config/icp_filter.json'), 'utf8'));

const DEFAULT_DAYS = 30;

// signalType: 'HIRING' | 'MA' | 'CLEVEL' | 'EXPAND' | 'INVEST' | 'CONTRACT' | 'NICHE' | 'SECTOR'
// (icp_filter.json has no per-HIRING_EXEC/HIRING_MID/... breakdown yet — all hiring
// sub-classes share the HIRING window until that's added to the config.)
export function stalenessDays(signalType) {
  return ICP_CFG.staleness_days[signalType] ?? DEFAULT_DAYS;
}

export function expiresAt(signalType, pubDate) {
  const base = pubDate ? new Date(pubDate) : new Date();
  const days = stalenessDays(signalType);
  return new Date(base.getTime() + days * 86_400_000).toISOString();
}

export function isStale(signalType, pubDate, now = Date.now()) {
  const base = pubDate ? new Date(pubDate).getTime() : now;
  const days = stalenessDays(signalType);
  return now > base + days * 86_400_000;
}
