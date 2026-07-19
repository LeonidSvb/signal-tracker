import { NextRequest, NextResponse } from 'next/server';

// Real Exa/pipeline analytics (Stage 8, docs/HANDOFF_2026-07-19_frontend_build.md).
// Replaces mockups/exa-analytics.html's frozen RAW/PASSED/SOURCE_RAW arrays with
// live queries against signal_monitoring.raw_signals — same direct-REST pattern
// as api/health/route.ts (service role key, no @supabase/supabase-js needed
// server-side).
//
// SCOPED DOWN from the mockup's 4-segment funnel (Raw -> Passed ICP -> Company
// Found -> Contact Found) to 2 real segments (Raw, Passed ICP). raw_signals has
// no company_id/contact_id — "Company Found"/"Contact Found" per RAW SIGNAL
// would require replicating resolve_companies.mjs's Blitz-backed name-matching
// logic (not a stored join anywhere), which is out of scope to build correctly
// in this route. Two honestly-computed segments beat four approximated ones.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SCHEMA = 'signal_monitoring';
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

function sbHeaders() {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Accept-Profile': SCHEMA };
}
async function sbGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`[analytics] ${path} -> ${res.status}`);
  return res.json();
}

function dayKey(iso: string | null): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    const clients = await sbGet(`clients?slug=eq.${CLIENT_SLUG}&select=id`);
    const clientId = clients?.[0]?.id;
    if (!clientId) return NextResponse.json({ error: 'client not found' }, { status: 404 });

    const rows = await sbGet(
      `raw_signals?client_id=eq.${clientId}&select=source,status,monitor_label,country,pub_date,scraped_at,filter_reason&limit=5000`
    );

    const inRange = (r: any) => {
      if (!fromParam || !toParam) return true;
      const d = r.pub_date || r.scraped_at;
      if (!d) return false;
      return d >= fromParam && d <= toParam;
    };
    const filtered = rows.filter(inRange);

    // Stat cards
    const total = filtered.length;
    const passed = filtered.filter((r: any) => r.status === 'passed_icp').length;
    const filteredOut = filtered.filter((r: any) => r.status === 'filtered_out').length;
    const pending = filtered.filter((r: any) => r.status === 'pending').length;
    const newestSignal = filtered.reduce((max: string | null, r: any) => {
      const d = r.pub_date;
      return d && (!max || d > max) ? d : max;
    }, null as string | null);

    // Daily 2-segment funnel (Raw / Passed ICP), Exa only, by pub_date
    const exaRows = filtered.filter((r: any) => r.source === 'exa');
    const byDay = new Map<string, { raw: number; passed: number }>();
    for (const r of exaRows) {
      const k = dayKey(r.pub_date);
      if (!k) continue;
      if (!byDay.has(k)) byDay.set(k, { raw: 0, passed: 0 });
      const entry = byDay.get(k)!;
      entry.raw++;
      if (r.status === 'passed_icp') entry.passed++;
    }
    const funnelDaily = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    // Volume by source, daily, all sources
    const sources = ['exa', 'linkedin', 'indeed', 'stepstone', 'xing', 'cadremploi'];
    const byDaySource = new Map<string, Record<string, number>>();
    for (const r of filtered) {
      const k = dayKey(r.pub_date || r.scraped_at);
      if (!k) continue;
      if (!byDaySource.has(k)) byDaySource.set(k, Object.fromEntries(sources.map((s) => [s, 0])));
      const entry = byDaySource.get(k)!;
      const src = sources.includes(r.source) ? r.source : null;
      if (src) entry[src]++;
    }
    const volumeDaily = Array.from(byDaySource.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    // By signal type (monitor_label prefix before '|', e.g. 'MA|DE' -> 'MA')
    const typeCounts = new Map<string, number>();
    for (const r of exaRows) {
      const type = (r.monitor_label || '').split('|')[0] || 'UNKNOWN';
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }
    const byType = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count }));

    // By country
    const countryCounts = new Map<string, number>();
    for (const r of exaRows) {
      const c = r.country || '(EU-wide)';
      countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
    }
    const byCountry = Array.from(countryCounts.entries()).sort((a, b) => b[1] - a[1]).map(([country, count]) => ({ country, count }));

    // Monitor performance (Exa monitor_label)
    const monitorCounts = new Map<string, { results: number; passed: number; country: string | null }>();
    for (const r of exaRows) {
      const label = r.monitor_label || '(unlabeled)';
      if (!monitorCounts.has(label)) monitorCounts.set(label, { results: 0, passed: 0, country: r.country });
      const entry = monitorCounts.get(label)!;
      entry.results++;
      if (r.status === 'passed_icp') entry.passed++;
    }
    const monitors = Array.from(monitorCounts.entries())
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.results - a.results);

    // Job board actors (non-exa sources)
    const actorCounts = new Map<string, { results: number; passed: number; lastScraped: string | null }>();
    for (const r of filtered) {
      if (r.source === 'exa') continue;
      if (!actorCounts.has(r.source)) actorCounts.set(r.source, { results: 0, passed: 0, lastScraped: null });
      const entry = actorCounts.get(r.source)!;
      entry.results++;
      if (r.status === 'passed_icp') entry.passed++;
      if (r.scraped_at && (!entry.lastScraped || r.scraped_at > entry.lastScraped)) entry.lastScraped = r.scraped_at;
    }
    const actors = Array.from(actorCounts.entries()).map(([source, v]) => ({ source, ...v }));

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      stats: { total, passed, filteredOut, pending, newestSignal },
      funnelDaily,
      volumeDaily,
      byType,
      byCountry,
      monitors,
      actors,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
