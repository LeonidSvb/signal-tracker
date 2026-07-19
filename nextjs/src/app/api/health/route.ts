import { NextResponse } from 'next/server';

// Read-only health snapshot (PLAN_2026-07-18_backend_hardening.md, C-D6 / Phase 1
// item 7). Answers Leo's "мне нужно знать, когда мы последний раз прогоняли" —
// pipeline_runs already gets a row per stage per run (lib/log.mjs); this route is
// a query, not new instrumentation. Same direct-REST pattern as exa-webhook/route.ts
// (no @supabase/supabase-js needed server-side, service role key + schema header).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SCHEMA       = 'signal_monitoring';
const CLIENT_SLUG  = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';

function sbHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Accept-Profile': SCHEMA,
  };
}

async function sbGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`[health] ${path} -> ${res.status}`);
  return res.json();
}

// Known pipeline stage scripts, in run order — used so the page always shows every
// stage (even ones that have literally never run) instead of only what's in the DB.
const KNOWN_STAGES = [
  'scrape_jobs', 'filter_icp', 'resolve_companies', 'find_contacts',
  'find_contacts_exa', 'classify_company', 'validate_contacts',
  'rank_leads', 'route_email', 'build_linkedin_queue', 'build_signal_report',
];

// Schema tables + their write-timestamp column, per docs/SCHEMA.md — reply-agent's
// Health concept (CONCEPTS.md §6.7/6.8) keeps a "Database tables" section separate
// from the sync-job drilldown, on purpose: tables have no "run" concept, just
// MAX(timestamp), so no drilldown belongs on this section (§6.8 explicitly declines
// a drilldown here — "no natural 'event' concept for a DB table row").
const SCHEMA_TABLES: { table: string; ts: string; usedBy: string }[] = [
  { table: 'clients', ts: 'created_at', usedBy: 'every page (client_id scope)' },
  { table: 'companies', ts: 'created_at', usedBy: 'Leads tracker' },
  { table: 'signals', ts: 'created_at', usedBy: 'Leads tracker (score, narrative, angle)' },
  { table: 'contacts', ts: 'created_at', usedBy: 'Leads tracker, contact rows' },
  { table: 'raw_signals', ts: 'scraped_at', usedBy: 'scrape_jobs / filter_icp input' },
  { table: 'pipeline_runs', ts: 'started_at', usedBy: 'Health (this page)' },
  { table: 'app_state', ts: 'updated_at', usedBy: 'Leads tracker (CRM status)' },
  { table: 'notes', ts: 'created_at', usedBy: 'Leads tracker (append-only notes)' },
  { table: 'channel_actions', ts: 'created_at', usedBy: 'Activity tab, route_email.mjs' },
];

export async function GET() {
  try {
    const [clients] = await Promise.all([sbGet(`clients?slug=eq.${CLIENT_SLUG}&select=id`)]);
    const clientId = clients?.[0]?.id;
    if (!clientId) return NextResponse.json({ error: 'client not found' }, { status: 404 });

    // Latest row per script — order by finished_at desc, then dedupe client-side
    // (PostgREST has no native "latest per group" without a view/RPC we don't have yet).
    // Also carries the last 5 runs + a 7-day rollup per stage (replaces the old separate
    // "Runs" settings panel — same pipeline_runs table, Health is now the one place that
    // reads it, matching the reply-agent Health/Runs merge pattern).
    const runs = await sbGet(
      `pipeline_runs?client_id=eq.${clientId}&order=started_at.desc&limit=200&select=script,source,status,started_at,finished_at,rows_scraped,rows_passed_icp,rows_pushed,stats,errors`
    );
    const byScript = new Map<string, any[]>();
    for (const r of runs) {
      if (!byScript.has(r.script)) byScript.set(r.script, []);
      byScript.get(r.script)!.push(r);
    }
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const stages = KNOWN_STAGES.map((script) => {
      const scriptRuns = byScript.get(script) || [];
      const last7d = scriptRuns.filter((r) => new Date(r.started_at).getTime() > sevenDaysAgo);
      const successCount = last7d.filter((r) => r.status === 'success').length;
      return {
        script,
        run: scriptRuns[0] || null,
        rollup7d: last7d.length ? { total: last7d.length, success: successCount } : null,
        last5: scriptRuns.slice(0, 5),
      };
    });

    // Email validation coverage — live counts, not a stale snapshot.
    const contacts = await sbGet(
      `contacts?client_id=eq.${clientId}&email=not.is.null&select=email_status,email_validated_at`
    );
    const validation = {
      totalWithEmail: contacts.length,
      validated: contacts.filter((c: any) => c.email_validated_at).length,
      neverValidated: contacts.filter((c: any) => !c.email_validated_at).length,
      invalid: contacts.filter((c: any) => c.email_status === 'invalid').length,
    };

    // Database tables — one MAX(timestamp) query per table, in parallel.
    const tables = await Promise.all(
      SCHEMA_TABLES.map(async ({ table, ts, usedBy }) => {
        try {
          const rows = await sbGet(
            `${table}?client_id=eq.${clientId}&select=${ts}&order=${ts}.desc.nullslast&limit=1`
          );
          return { table, usedBy, lastWrite: rows?.[0]?.[ts] ?? null };
        } catch {
          return { table, usedBy, lastWrite: null };
        }
      })
    );

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      stages,
      validation,
      tables,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
