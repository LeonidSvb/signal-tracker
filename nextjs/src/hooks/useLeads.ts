"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";
import type { Lead, AppState, Note } from "@/lib/types";

export function useLeads(clientSlug: string) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [states, setStates] = useState<Record<string, AppState>>({});
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState<string>("");

  useEffect(() => {
    const sb = createClient();
    async function load() {
      const { data: client } = await sb
        .from("clients")
        .select("id")
        .eq("slug", clientSlug)
        .single();
      if (!client) return;

      setClientId(client.id);

      const [{ data: leadsData }, { data: statesData }] = await Promise.all([
        sb.from("leads").select("*").eq("client_id", client.id).order("score", { ascending: false }),
        sb.from("app_state").select("*").eq("client_id", client.id),
      ]);

      setLeads(leadsData ?? []);
      const stateMap: Record<string, AppState> = {};
      (statesData ?? []).forEach((s) => { stateMap[s.lead_id] = s; });
      setStates(stateMap);
      setLoading(false);
    }
    load();
  }, [clientSlug]);

  async function setStatus(leadId: string, status: string, author = "leo") {
    const sb = createClient();
    await sb.from("app_state").upsert(
      { lead_id: leadId, client_id: clientId, status, updated_by: author, updated_at: new Date().toISOString() },
      { onConflict: "lead_id" }
    );
    setStates((prev) => ({
      ...prev,
      [leadId]: { ...prev[leadId], lead_id: leadId, client_id: clientId, status: status as AppState["status"], updated_by: author, updated_at: new Date().toISOString() } as AppState,
    }));
  }

  return { leads, states, loading, setStatus };
}

export function useNotes(leadId: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (!leadId) return;
    const sb = createClient();
    sb.from("notes").select("*").eq("lead_id", leadId).order("created_at").then(({ data }) => {
      setNotes(data ?? []);
    });
    const channel = sb
      .channel(`notes-${leadId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notes", filter: `lead_id=eq.${leadId}` },
        (payload) => setNotes((prev) => [...prev, payload.new as Note])
      )
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [leadId]);

  async function addNote(leadId: string, clientId: string, author: "leo" | "philippe", body: string) {
    const sb = createClient();
    await sb.from("notes").insert({ lead_id: leadId, client_id: clientId, author, body });
  }

  return { notes, addNote };
}
