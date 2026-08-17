"use client";
import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { resolveCompanyStatus } from "@/lib/status";
import type {
  Company, Signal, Contact, AppState, ContactState, Note, CompanyEvent, CompanyListItem, ContactStatus,
} from "@/lib/types";

const SM = "signal_monitoring" as const;

// ── Company list — slim select (§2.6, docs/PLAN_2026-07-19_react_migration_prep.md):
// only the fields the sidebar needs, full detail is fetched lazily per-company on
// click via useCompanyDetail() below. Keeps the sidebar's first paint fast even as
// the lead count grows well past today's ~30-400 range. ──

export function useCompanyList(clientSlug: string) {
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const sb = createClient();
    let cancelled = false;

    async function load() {
      const sm = sb.schema(SM);
      const { data: client } = await sm.from("clients").select("id").eq("slug", clientSlug).single();
      if (!client || cancelled) return;
      setClientId(client.id);

      // companies FIRST, then filter the other 4 tables to just those company_ids (2026-08-03,
      // found live: this page took 20-30s to load — measured each of the 5 parallel queries
      // directly against the self-hosted Supabase, contacts alone was 189KB in 12.4s, ~15KB/s,
      // because the server sends REST responses uncompressed (no gzip/br despite the browser
      // requesting it — a Traefik/PostgREST config gap, separate infra fix, not done here).
      // Every row below only ever gets used for a company that HAS a tier (the .filter() a few
      // lines down already drops everything else) — companies without a tier are the vast
      // majority (762/954 live) and were being fetched into signals/contacts/etc. for nothing.
      // Filtering by company_id up front cuts those payloads ~5x without touching server config.
      const { data: companyRows } = await sm.from("companies")
        .select("id,name,tier,employees,hq_country").eq("client_id", client.id).not("tier", "is", null);
      if (cancelled) return;
      const tieredIds = (companyRows ?? []).map((c: any) => c.id);

      // company_id list is passed as a URL query param (.in()) — with 150+ UUIDs
      // (36 chars each) the GET URL exceeds the server's URI length limit and the
      // CORS preflight itself 414s, so every one of these 4 queries silently
      // returns nothing (found live 2026-08-17: sidebar showed "0 companies"
      // while the header count read from a separate, unfiltered query still
      // showed real numbers). Chunking keeps each request's URL short.
      const CHUNK = 50;
      const chunks: string[][] = [];
      for (let i = 0; i < tieredIds.length; i += CHUNK) chunks.push(tieredIds.slice(i, i + CHUNK));

      const [signalRows, contactRows, contactStateRows, appStateRows] = await Promise.all([
        fetchChunked(chunks, (ids) => sm.from("signals").select("company_id,source,status,signal_type,pub_date,created_at").eq("client_id", client.id).in("company_id", ids)),
        fetchChunked(chunks, (ids) => sm.from("contacts").select("id,company_id,email,linkedin_url").eq("client_id", client.id).in("company_id", ids)),
        fetchChunked(chunks, (ids) => sm.from("contact_state").select("company_id,contact_id,status").eq("client_id", client.id).in("company_id", ids)),
        fetchChunked(chunks, (ids) => sm.from("app_state").select("company_id,status").eq("client_id", client.id).in("company_id", ids)),
      ]);
      if (cancelled) return;

      const signalsByCompany = groupBy(signalRows, (s: any) => s.company_id);
      const contactsByCompany = groupBy(contactRows, (c: any) => c.company_id);
      const contactStateByCompany = groupBy(contactStateRows, (s: any) => s.company_id);
      const appStateByCompany = new Map(appStateRows.map((a: any) => [a.company_id, a.status as ContactStatus]));

      const items: CompanyListItem[] = (companyRows ?? [])
        .filter((c: any) => (signalsByCompany.get(c.id)?.length ?? 0) > 0)
        .map((c: any): CompanyListItem => {
          const signals = signalsByCompany.get(c.id) ?? [];
          const contacts = contactsByCompany.get(c.id) ?? [];
          const contactStates = contactStateByCompany.get(c.id) ?? [];
          const origins = new Set<"exa" | "job_board">(signals.map((s: any) => (s.source === "exa" ? "exa" : "job_board")));
          const withEmail = contacts.filter((c2: any) => c2.email).length;
          const hasLinkedinOnly = withEmail === 0 && contacts.some((c2: any) => c2.linkedin_url);
          const origin: "exa" | "job_board" | "both" | null =
            origins.size === 2 ? "both" : origins.size === 1 ? Array.from(origins)[0] : null;

          // "Latest signal" for the card = most recent by pub_date (falls back to
          // created_at for signals with no pub_date), preferring active over stale.
          // pub_date drives the age shown (what actually decays the outreach angle,
          // see docs/SIGNALS_REGISTRY.md); created_at is kept alongside so the UI can
          // flag when OUR pipeline caught it much later than it was actually published.
          const active = signals.filter((s: any) => s.status === "active");
          const pool = active.length ? active : signals;
          const latest = pool.reduce((best: any, s: any) => {
            const sd = new Date(s.pub_date || s.created_at).getTime();
            const bd = best ? new Date(best.pub_date || best.created_at).getTime() : -Infinity;
            return sd > bd ? s : best;
          }, null);

          return {
            id: c.id,
            name: c.name,
            tier: c.tier,
            employees: c.employees,
            hq_country: c.hq_country,
            sourceCount: signals.length,
            contactCount: contacts.length,
            withEmailCount: withEmail,
            origin,
            hasLinkedinOnly,
            latestSignalType: latest?.signal_type ?? null,
            latestSignalPubDate: latest?.pub_date ?? null,
            latestSignalCaughtAt: latest?.created_at ?? null,
            status: resolveCompanyStatus(
              contactStates.map((s: any) => s.status as ContactStatus),
              appStateByCompany.get(c.id) ?? null
            ),
          };
        })
        .sort((a, b) => (a.tier ?? "T9").localeCompare(b.tier ?? "T9"));

      setCompanies(items);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [clientSlug, reloadKey]);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);
  // Local-only status patch, no network round-trip — found live 2026-08-17: every
  // status-button click was calling refetch() (all 216 tiered companies, ~20
  // chunked requests) just to update ONE row's status chip, which is why the
  // buttons felt laggy. The caller already knows the new aggregate status (it
  // just computed it from the contact statuses it's holding), so just patch it in.
  const patchStatus = useCallback((companyId: string, status: ContactStatus) => {
    setCompanies((prev) => prev.map((c) => (c.id === companyId ? { ...c, status } : c)));
  }, []);
  return { companies, clientId, loading, refetch, patchStatus };
}

async function fetchChunked<T>(chunks: string[][], query: (ids: string[]) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  if (!chunks.length) return [];
  const results = await Promise.all(chunks.map((ids) => query(ids)));
  return results.flatMap((r) => r.data ?? []);
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(row);
  }
  return m;
}

// ── Company detail — fetched lazily on click (§2.6) ──

export interface CompanyDetail {
  company: Company;
  events: CompanyEvent[];
  contacts: Contact[];
  contactStatuses: Record<string, ContactStatus>; // contact_id -> status (resolved: contact_state, else 'new')
  appStateFallback: ContactStatus | null; // used only when contactStatuses is empty for every contact
  latestEmailAction: { status: string } | null; // most recent channel_actions row, channel='email', for the Email section
}

function groupSignalsIntoEvents(signals: Signal[]): CompanyEvent[] {
  const byKey = groupBy(signals.filter((s) => s.event_key), (s) => s.event_key as string);
  const events: CompanyEvent[] = Array.from(byKey.entries()).map(([eventKey, members]) => {
    const sorted = [...members].sort((a, b) => new Date(b.pub_date || 0).getTime() - new Date(a.pub_date || 0).getTime());
    const status: "active" | "stale" = members.some((m) => m.status === "active") ? "active" : "stale";
    return {
      eventKey,
      memberIds: members.map((m) => m.id),
      members,
      pubDate: sorted[0]?.pub_date ?? null,
      baseType: sorted[0]?.signal_type ?? "",
      title: sorted[0]?.title ?? null,
      summary: members.find((m) => m.event_summary)?.event_summary ?? null,
      status,
    };
  });
  return events.sort((a, b) => (b.pubDate ? new Date(b.pubDate).getTime() : 0) - (a.pubDate ? new Date(a.pubDate).getTime() : 0));
}

export function useCompanyDetail(companyId: string | null, clientId: string) {
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!companyId || !clientId) { setDetail(null); return; }
    const sb = createClient();
    let cancelled = false;
    setLoading(true);

    async function load() {
      const sm = sb.schema(SM);
      const [
        { data: companyRow },
        { data: signalRows },
        { data: contactRows },
        { data: contactStateRows },
        { data: appStateRow },
        { data: emailActionRows },
      ] = await Promise.all([
        sm.from("companies").select("*").eq("id", companyId).single(),
        sm.from("signals").select("*").eq("company_id", companyId).eq("client_id", clientId).in("status", ["active", "stale"]),
        sm.from("contacts").select("*").eq("company_id", companyId).eq("client_id", clientId),
        sm.from("contact_state").select("contact_id,status").eq("company_id", companyId).eq("client_id", clientId),
        sm.from("app_state").select("status").eq("company_id", companyId).eq("client_id", clientId).maybeSingle(),
        sm.from("channel_actions").select("status,created_at").eq("company_id", companyId).eq("client_id", clientId).eq("channel", "email").order("created_at", { ascending: false }).limit(1),
      ]);
      if (cancelled || !companyRow) return;

      const contactStatuses: Record<string, ContactStatus> = {};
      for (const row of contactStateRows ?? []) contactStatuses[row.contact_id] = row.status as ContactStatus;

      setDetail({
        company: companyRow as Company,
        events: groupSignalsIntoEvents((signalRows ?? []) as Signal[]),
        contacts: (contactRows ?? []) as Contact[],
        contactStatuses,
        appStateFallback: (appStateRow?.status as ContactStatus) ?? null,
        latestEmailAction: emailActionRows?.[0] ? { status: emailActionRows[0].status } : null,
      });
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [companyId, clientId, reloadKey]);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);
  // Local-only patch for one contact's status — same reasoning as useCompanyList's
  // patchStatus: a full refetch() here re-queries 6 tables just to reflect one
  // upsert the caller already knows the result of.
  const patchContactStatus = useCallback((contactId: string, status: ContactStatus) => {
    setDetail((prev) => (prev ? { ...prev, contactStatuses: { ...prev.contactStatuses, [contactId]: status } } : prev));
  }, []);
  return { detail, loading, refetch, patchContactStatus };
}

// ── Per-contact status write (migration 009, contact_state) ──

export function useSetContactStatus() {
  return useCallback(async (clientId: string, companyId: string, contactId: string, status: ContactStatus, author = "leo") => {
    const sb = createClient();
    await sb.schema(SM).from("contact_state").upsert(
      { client_id: clientId, company_id: companyId, contact_id: contactId, status, updated_by: author, updated_at: new Date().toISOString() },
      { onConflict: "client_id,contact_id" }
    );
  }, []);
}

// ── Notes — realtime subscription, kept exactly as the old useLeads.ts implemented
// it (§1, docs/PLAN_2026-07-19_react_migration_prep.md — genuinely correct working
// infrastructure, no reason to rewrite). ──

export function useNotes(companyId: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (!companyId) return;
    const sb = createClient();
    sb.schema(SM).from("notes").select("*").eq("company_id", companyId).order("created_at").then(({ data }) => {
      setNotes((data ?? []) as Note[]);
    });
    const channel = sb
      .channel(`notes-${companyId}`)
      .on("postgres_changes", { event: "INSERT", schema: SM, table: "notes", filter: `company_id=eq.${companyId}` },
        (payload) => setNotes((prev) => [...prev, payload.new as Note])
      )
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [companyId]);

  async function addNote(companyId: string, clientId: string, author: string, body: string) {
    const sb = createClient();
    await sb.schema(SM).from("notes").insert({ company_id: companyId, client_id: clientId, author, body });
  }

  return { notes, addNote };
}
