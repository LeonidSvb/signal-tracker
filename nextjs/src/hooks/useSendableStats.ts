"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";

// Real "N/M sendable" sidebar stat — contacts.email_status is written by
// validate_contacts.mjs / route_email.mjs's MV+BounceBan cascade (docs/SCHEMA.md).
// "Sendable" = verified; "checked" = has ever been validated (email_validated_at set).
export function useSendableStats(clientId: string) {
  const [stats, setStats] = useState<{ sendable: number; checked: number } | null>(null);

  useEffect(() => {
    if (!clientId) return;
    const sb = createClient();
    sb.schema("signal_monitoring")
      .from("contacts")
      .select("email_status,email_validated_at")
      .eq("client_id", clientId)
      .not("email", "is", null)
      .then(({ data }) => {
        if (!data) return;
        const checked = data.filter((c: any) => c.email_validated_at).length;
        const sendable = data.filter((c: any) => c.email_status === "verified").length;
        setStats({ sendable, checked });
      });
  }, [clientId]);

  return stats;
}
