"use client";
import { useState, useEffect, Fragment } from "react";

// Real Templates panel — reads /api/copy (GET), which mirrors
// pipeline/config/copy_templates.json exactly (Stage 7).
//
// Redesigned 2026-08-03 (Leo's feedback: the first table-per-row version, one full
// message per signal type, read as repetitive/robotic — because it genuinely IS
// repetitive: since the 2026-08-02/03 AI hook+bridge work, every single type shares the
// EXACT same wrapping skeleton for both LinkedIn fields and the email opener (greeting,
// "I place food operations leadership, {market_focus}", the offer/CTA close) — only the
// AI-generated hook+bridge fact pair actually varies per type. Showing the full wrapped
// message 12 times just repeated that fixed skeleton 12 times. Fix: show the skeleton
// ONCE (Universal block below, reviving mockups/signals_v2_concept.html's .tpl-universal
// pattern that was dropped in the original build because ITS content — a scripted step-3/
// follow-up — turned out not to be real; this skeleton IS real), then a lean per-type
// table with only what's actually unique: the trigger rule + example hook/bridge. Full
// assembled messages (and the static fallback text, for comparison) are one click away
// per row via the expand toggle, not repeated inline.

interface TemplateEntry {
  key: string;
  connect: string | null;
  qualify: string | null;
  emailA: string | null;
  hasAnyLi: boolean; // false for NICHE/SECTOR — no static fallback exists at all for LinkedIn
}

interface ExampleEntry {
  trigger?: string;
  hook?: string | null;
  bridge?: string | null;
  email_subject?: string;
  email_body_1?: string;
  li_connection_note?: string;
  li_first_message?: string;
  error?: string;
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
  const [examples, setExamples] = useState<Record<string, ExampleEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/copy")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        const entries: TemplateEntry[] = Object.entries(d.templates as Record<string, any>).map(([key, t]) => {
          const li = extractLi(t);
          const emailA = t.variants?.A ? (typeof t.variants.A === "string" ? t.variants.A : t.variants.A.body) : null;
          return { key, connect: li.connect, qualify: li.qualify, emailA, hasAnyLi: !!(li.connect || li.qualify) };
        });
        setRows(entries);
        setExamples(d.examples ?? null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="settings-panel active" id="settings-templates">
      <div className="settings-panel-head">
        <div className="settings-panel-title">Templates</div>
        <div className="settings-panel-sub">
          Reads directly from <code>pipeline/config/copy_templates.json</code> (the same file{" "}
          <code>build_linkedin_queue.mjs</code> and <code>route_email.mjs</code> use in production). LinkedIn is
          connection note + first message only — the real playbook has no scripted step-3/follow-up (any reply
          routes to Leo directly, not through a script).
        </div>
      </div>

      {error && <div className="cb-aside">Error loading templates: {error}</div>}

      <div className="tpl-universal">
        <div className="tpl-universal-label">Universal — same skeleton for every signal type (2026-08-02/03)</div>
        <div className="tpl-universal-grid">
          <div className="tpl-universal-item">
            <div className="k">LinkedIn — connection note (≤300 chars)</div>
            <div className="v">{"{first_name}, [AI hook — the real fact] - I place food operations leadership, {market_focus}. Connect?"}</div>
          </div>
          <div className="tpl-universal-item">
            <div className="k">LinkedIn — first message (after accept)</div>
            <div className="v">{"{first_name} — appreciate the connect.\n\n[AI hook] -\n[AI bridge — general mechanism]\n\n{relevant_case}\n\nWorth a quick chat if useful?"}</div>
          </div>
          <div className="tpl-universal-item">
            <div className="k">Email — opening (body_1, Leo-as-connector voice)</div>
            <div className="v">{"hey {first_name},\n\n[AI hook] -\n[AI bridge]\n\nI know someone who specifically does exec search for food companies in {market_focus} - places senior roles in 2-3 weeks.\n\nworth an intro?"}</div>
          </div>
        </div>
      </div>

      <div className="tpl-table-wrap">
        <table className="tpl">
          <thead>
            <tr>
              <th>Signal type</th>
              <th>When it fires</th>
              <th>Example hook</th>
              <th>Example bridge</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => {
              const ex = examples?.[r.key];
              const isOpen = openKey === r.key;
              return (
                <Fragment key={r.key}>
                  <tr className="tpl-row-clickable" onClick={() => setOpenKey(isOpen ? null : r.key)}>
                    <td className="key">
                      {r.key}
                      {!r.hasAnyLi && <div className="tpl-nofallback">no LinkedIn fallback</div>}
                    </td>
                    <td className="tpl-trigger">{ex?.trigger ?? "—"}</td>
                    <td className="copy">{ex?.hook ?? (ex?.error ? `[error: ${ex.error}]` : "—")}</td>
                    <td className="copy">{ex?.bridge ?? "—"}</td>
                    <td className="tpl-expand">{isOpen ? "▾" : "▸"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="tpl-row-detail">
                      <td colSpan={5}>
                        <div className="tpl-detail-grid">
                          <div className="tpl-detail-col">
                            <div className="tpl-detail-label">Full example — LinkedIn connection note</div>
                            <div className="tpl-detail-text">{ex?.li_connection_note ?? "—"}</div>
                            <div className="tpl-detail-label">Full example — LinkedIn first message</div>
                            <div className="tpl-detail-text">{ex?.li_first_message ?? "—"}</div>
                            <div className="tpl-detail-label">Full example — Email opening</div>
                            <div className="tpl-detail-text">{ex?.email_body_1 ?? "—"}</div>
                          </div>
                          <div className="tpl-detail-col">
                            <div className="tpl-detail-label">Static fallback (used only if AI generation fails)</div>
                            <div className="tpl-detail-text">LI connect: {r.connect ?? "—"}</div>
                            <div className="tpl-detail-text">LI first msg: {r.qualify ?? "—"}</div>
                            <div className="tpl-detail-text">Email variant A: {r.emailA ?? "—"}</div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
