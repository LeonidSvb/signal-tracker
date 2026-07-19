"use client";
import { useState, useEffect } from "react";

// Real Templates panel — reads /api/copy (GET), which mirrors
// pipeline/config/copy_templates.json exactly (Stage 7). Table shape matches
// mockups/signals_v2_concept.html's tpl table (signal type | LI step 1 | LI
// step 2 | Email variant A), but with the REAL field names
// (li_connection_note/li_first_message) instead of the mockup's illustrative
// li1/li2 shorthand, and WITHOUT the mockup's "Universal — Step 3 / Follow-up
// nudge" block: Stage 3 established the real playbook has no such content
// (copy_templates.json genuinely has no li_step3_call/li_followup field to
// read one from — see ADR-009 D4, TODO.txt).

interface TemplateEntry {
  key: string;
  connect: string | null;
  qualify: string | null;
  emailA: string | null;
}

function extractLi(t: any): { connect: string | null; qualify: string | null } {
  if (t.li_connection_note !== undefined) {
    return { connect: t.li_connection_note ?? null, qualify: t.li_first_message ?? null };
  }
  const variant = t.li_variant_1_appointee;
  return { connect: variant?.li_connection_note ?? null, qualify: variant?.li_first_message ?? null };
}

export default function TemplatesPanel() {
  const [rows, setRows] = useState<TemplateEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/copy")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        const entries: TemplateEntry[] = Object.entries(d.templates as Record<string, any>).map(([key, t]) => {
          const li = extractLi(t);
          const emailA = t.variants?.A ? (typeof t.variants.A === "string" ? t.variants.A : t.variants.A.body) : null;
          return { key, connect: li.connect, qualify: li.qualify, emailA };
        });
        setRows(entries);
      })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="settings-panel active" id="settings-templates">
      <div className="settings-panel-head">
        <div className="settings-panel-title">Templates</div>
        <div className="settings-panel-sub">
          One row per signal type — reads directly from <code>pipeline/config/copy_templates.json</code> (the
          same file <code>build_linkedin_queue.mjs</code> and <code>route_email.mjs</code> use in production).
          LinkedIn is connection note + first message only — the real playbook has no scripted step-3/follow-up
          message (any reply routes to Leo directly, not through a script).
        </div>
      </div>

      {error && <div className="cb-aside">Error loading templates: {error}</div>}

      <div className="tpl-table-wrap">
        <table className="tpl">
          <thead>
            <tr>
              <th>Signal type</th>
              <th className="li-col">LinkedIn — connection note</th>
              <th className="li-col">LinkedIn — first message</th>
              <th className="em-col">Email — variant A</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.key}>
                <td className="key">{r.key}</td>
                <td className="copy li">{r.connect ?? "—"}</td>
                <td className="copy li">{r.qualify ?? "—"}</td>
                <td className="copy">{r.emailA ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
