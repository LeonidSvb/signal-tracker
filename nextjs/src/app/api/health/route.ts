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

export async function GET() {
  try {
    const [clients] = await Promise.all([sbGet(`clients?slug=eq.${CLIENT_SLUG}&select=id`)]);
    const clientId = clients?.[0]?.id;
    if (!clientId) return NextResponse.json({ error: 'client not found' }, { status: 404 });

    // Latest row per script — order by finished_at desc, then dedupe client-side
    // (PostgREST has no native "latest per group" without a view/RPC we don't have yet).
    const runs = await sbGet(
      `pipeline_runs?client_id=eq.${clientId}&order=started_at.desc&limit=200&select=script,source,status,started_at,finished_at,rows_scraped,rows_passed_icp,rows_pushed,stats,errors`
    );
    const latestByScript = new Map<string, any>();
    for (const r of runs) {
      if (!latestByScript.has(r.script)) latestByScript.set(r.script, r);
    }
    const stages = KNOWN_STAGES.map((script) => ({
      script,
      run: latestByScript.get(script) || null,
    }));

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

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      stages,
      validation,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
