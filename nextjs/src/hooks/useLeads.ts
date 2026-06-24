"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";
import type { Lead, AppState, Note } from "@/lib/types";

const SM = "signal_monitoring" as const;

export function useLeads(clientSlug: string) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [states, setStates] = useState<Record<string, AppState>>({});
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState<string>("");

  useEffect(() => {
    const sb = createClient();
    async function load() {
      try {
        const sm = sb.schema(SM);

        const { data: client } = await sm
          .from("clients")
          .select("id")
          .eq("slug", clientSlug)
          .single();

        if (!client) return;

        setClientId(client.id);

        const [
          { data: companiesData },
          { data: signalsData },
          { data: contactsData },
          { data: statesData },
        ] = await Promise.all([
          sm.from("companies").select("*").eq("client_id", client.id),
          sm.from("signals").select("*").eq("client_id", client.id),
          sm.from("contacts").select("*").eq("client_id", client.id),
          sm.from("app_state").select("*").eq("client_id", client.id),
        ]);

        const companies = companiesData ?? [];
        const signals = signalsData ?? [];
        const contacts = contactsData ?? [];

        const signalsByCompany: Record<string, typeof signals> = {};
        signals.forEach((s) => {
          if (!signalsByCompany[s.company_id]) signalsByCompany[s.company_id] = [];
          signalsByCompany[s.company_id].push(s);
        });

        const contactsByCompany: Record<string, typeof contacts> = {};
        contacts.forEach((c) => {
          if (!contactsByCompany[c.company_id]) contactsByCompany[c.company_id] = [];
          contactsByCompany[c.company_id].push(c);
        });

        const assembled: Lead[] = companies.map((company) => {
          const compSignals = (signalsByCompany[company.id] ?? [])
            .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
          const primary = compSignals[0];
          const compContacts = contactsByCompany[company.id] ?? [];

          return {
            id: company.id,
            client_id: company.client_id,
            company_name: company.name,
            company_linkedin_url: company.linkedin_url ?? "",
            company_domain: company.domain ?? "",
            company_industry: company.industry ?? "",
            company_employees: company.employees ?? 0,
            company_hq_country: company.hq_country ?? "",
            company_about: company.about ?? "",
            company_snapshot: "",
            signal_title: primary?.title ?? "",
            signal_source: primary?.source ?? "",
            signal_pub_date: primary?.pub_date ?? "",
            signal_days_ago: primary?.days_ago ?? 0,
            signal_country: primary?.country ?? "",
            signal_url: primary?.source_url ?? "",
            signal_narrative: primary?.narrative ?? "",
            angle: primary?.angle ?? "",
            icp_score: 0,
            score: primary?.score ?? 0,
            contacts: compContacts.map((c: any) => ({
              full_name: c.full_name ?? "",
              title: c.title ?? "",
              email: c.email ?? "",
              email_status: c.email_status ?? "pending",
              linkedin_url: c.linkedin_url ?? "",
              source_level: c.source ?? "",
            })),
            all_signals: compSignals.map((s: any) => ({
              title: s.title ?? "",
              days_ago: s.days_ago ?? 0,
              source: s.source ?? "",
              country: s.country ?? "",
              url: s.source_url ?? "",
            })),
            created_at: company.created_at ?? "",
            updated_at: company.updated_at ?? "",
          };
        }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

        setLeads(assembled);

        const stateMap: Record<string, AppState> = {};
        (statesData ?? []).forEach((s: any) => { stateMap[s.company_id] = s; });
        setStates(stateMap);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [clientSlug]);

  async function setStatus(companyId: string, status: string, author = "leo") {
    const sb = createClient();
    await sb.schema(SM).from("app_state").upsert(
      { company_id: companyId, client_id: clientId, status, updated_by: author, updated_at: new Date().toISOString() },
      { onConflict: "client_id,company_id" }
    );
    setStates((prev) => ({
      ...prev,
      [companyId]: { ...prev[companyId], company_id: companyId, client_id: clientId, status: status as AppState["status"], updated_by: author, updated_at: new Date().toISOString() } as AppState,
    }));
  }

  return { leads, states, loading, setStatus };
}

export function useNotes(companyId: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (!companyId) return;
    const sb = createClient();
    sb.schema(SM).from("notes").select("*").eq("company_id", companyId).order("created_at").then(({ data }) => {
      setNotes(data ?? []);
    });
    const channel = sb
      .channel(`notes-${companyId}`)
      .on("postgres_changes", { event: "INSERT", schema: SM, table: "notes", filter: `company_id=eq.${companyId}` },
        (payload) => setNotes((prev) => [...prev, payload.new as Note])
      )
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [companyId]);

  async function addNote(companyId: string, clientId: string, author: "leo" | "philippe", body: string) {
    const sb = createClient();
    await sb.schema(SM).from("notes").insert({ company_id: companyId, client_id: clientId, author, body });
  }

  return { notes, addNote };
}
