"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";

export interface ActivityRow {
  id: string;
  created_at: string;
  channel: "email" | "linkedin";
  status: string;
  company_name: string;
  company_tier: string | null;
  contact_name: string;
  detail: Record<string, unknown> | null;
}

// Real channel_actions query (Activity tab, Stage 7) — replaces the mockup's
// frozen ACTIVITY array with a live query, joined to company/contact names via
// Supabase's nested select (both are real FKs per docs/SCHEMA.md).
export function useActivity(clientId: string, range: { from: Date; to: Date } | null) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    const sb = createClient();
    let q = sb
      .schema("signal_monitoring")
      .from("channel_actions")
      .select("id,created_at,channel,status,detail,companies(name,tier),contacts(full_name)")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (range) {
      q = q.gte("created_at", range.from.toISOString()).lte("created_at", range.to.toISOString());
    }
    q.then(({ data }) => {
      const mapped: ActivityRow[] = (data ?? []).map((r: any) => ({
        id: r.id,
        created_at: r.created_at,
        channel: r.channel,
        status: r.status,
        detail: r.detail,
        company_name: r.companies?.name ?? "(unknown company)",
        company_tier: r.companies?.tier ?? null,
        contact_name: r.contacts?.full_name ?? "(unknown contact)",
      }));
      setRows(mapped);
      setLoading(false);
    });
  }, [clientId, range?.from?.getTime(), range?.to?.getTime()]);

  return { rows, loading };
}
