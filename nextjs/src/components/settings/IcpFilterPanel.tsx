"use client";
import { useState, useEffect } from "react";

// Real ICP Filter panel — reads /api/icp-filter (GET), which mirrors
// pipeline/config/icp_filter.json exactly (Stage 7). Read-only preview, no
// editable inputs — nothing writes back to the file yet (same call made in
// mockups/settings.html's 2026-07-19 rebuild). Also displays staleness_days
// inline (folded into this same panel, not a separate nav item — both come
// from the same file, per the Settings IA review this session).

interface IcpConfig {
  countries: string[];
  min_employees: number;
  max_employees: number;
  industry_keywords: string[];
  hiring_exec_keywords: string[];
  hiring_blacklist_keywords: string[];
  company_blacklist: string[];
  news_signal_types: string[];
  staleness_days: Record<string, number>;
}

function TagChips({ items, neg }: { items: string[]; neg?: boolean }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {items.map((t) => <span key={t} className={`tag-chip ${neg ? "neg" : ""}`}>{t}</span>)}
    </div>
  );
}

export default function IcpFilterPanel() {
  const [cfg, setCfg] = useState<IcpConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/icp-filter")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setCfg(d)))
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="settings-panel active" id="settings-icpfilter">
      <div className="settings-panel-head">
        <div className="settings-panel-title">ICP Filter</div>
        <div className="settings-panel-sub">
          Single source of truth for targeting — <code>pipeline/config/icp_filter.json</code>, read by{" "}
          <code>filter_icp.mjs</code>, <code>rank_leads.mjs</code>, and <code>lib/staleness.mjs</code>. Read-only
          preview — editing here doesn't write back yet; change the file directly and re-run
          <code>filter_icp.mjs</code> to apply it.
        </div>
      </div>

      {error && <div className="cb-aside">Error loading ICP filter: {error}</div>}

      {cfg && (
        <>
          <div className="icp-card">
            <div className="field-label">Industry keywords</div>
            <TagChips items={cfg.industry_keywords} />
          </div>

          <div className="icp-grid-2" style={{ marginBottom: 12 }}>
            <div className="icp-card">
              <div className="field-label">Countries</div>
              <TagChips items={cfg.countries} />
            </div>
            <div className="icp-card">
              <div className="field-label">Headcount range</div>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                {cfg.min_employees.toLocaleString()} – {cfg.max_employees.toLocaleString()}{" "}
                <span style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 400 }}>employees</span>
              </div>
            </div>
          </div>

          <div className="icp-card">
            <div className="field-label">Hiring signal — exec-level keywords</div>
            <TagChips items={cfg.hiring_exec_keywords} />
          </div>

          <div className="icp-grid-2" style={{ margin: "12px 0" }}>
            <div className="icp-card">
              <div className="field-label">Blacklisted companies</div>
              <TagChips items={cfg.company_blacklist} neg />
            </div>
            <div className="icp-card">
              <div className="field-label">Blacklisted keywords</div>
              <TagChips items={cfg.hiring_blacklist_keywords} neg />
            </div>
          </div>

          <div className="icp-card" style={{ marginBottom: 12 }}>
            <div className="field-label">News signal — accepted types</div>
            <TagChips items={cfg.news_signal_types} />
          </div>

          <div className="icp-card">
            <div className="field-label">Staleness windows</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
              How long a signal stays &quot;active&quot; before it&apos;s marked stale — same file,{" "}
              <code>staleness_days</code>, enforced live in <code>filter_icp.mjs</code>/<code>rank_leads.mjs</code>.
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "4px 0", fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>Signal type</th>
                  <th style={{ textAlign: "left", padding: "4px 0", fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>Expires after</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(cfg.staleness_days).map(([type, days]) => (
                  <tr key={type} style={{ borderBottom: "1px solid #F4F4F5" }}>
                    <td className="mono" style={{ padding: "5px 0", fontSize: 10.5 }}>{type}</td>
                    <td style={{ padding: "5px 0", fontSize: 11.5 }}>{days} days</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
