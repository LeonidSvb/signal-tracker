"use client";
import { useState, useEffect } from "react";
import DateRangePicker, { type DateRangeValue, type DateRangePreset } from "@/components/DateRangePicker";

// Real Exa/pipeline analytics client (Stage 8). Loaded via next/dynamic
// (app/analytics/page.tsx) so this — and its chart rendering — never enters
// the initial Leads-page bundle (§2.6, docs/PLAN_2026-07-19_react_migration_prep.md).
//
// Charts are simpler than mockups/exa-analytics.html's hand-rolled versions
// (no ctrl+zoom, no cumulative-to-exclusive-delta funnel math, no smoothed
// spline interpolation) — real SVG/CSS bars and straight-line polylines
// instead, real data throughout, same visual language (tokens from
// app-shell.css). The interaction fidelity was traded down deliberately to
// keep this stage's real-data plumbing (the actual point of the rebuild)
// correct and shippable rather than spending the remaining time matching
// pixel-for-pixel zoom/tooltip physics.

interface AnalyticsData {
  stats: { total: number; passed: number; filteredOut: number; pending: number; newestSignal: string | null };
  funnelDaily: { date: string; raw: number; passed: number }[];
  volumeDaily: Record<string, number | string>[];
  byType: { type: string; count: number }[];
  byCountry: { country: string; count: number }[];
  monitors: { label: string; results: number; passed: number; country: string | null }[];
  actors: { source: string; results: number; passed: number; lastScraped: string | null }[];
}

const SOURCE_META: Record<string, { color: string; label: string }> = {
  exa: { color: "#4F5FD1", label: "Exa" },
  linkedin: { color: "#0F8FA8", label: "LinkedIn" },
  indeed: { color: "#9B5FE0", label: "Indeed" },
  stepstone: { color: "#D6478E", label: "StepStone" },
  xing: { color: "#3F8F5C", label: "Xing" },
  cadremploi: { color: "#C05A2C", label: "Cadremploi" },
};

const PRESETS: DateRangePreset[] = [
  { id: "7d", label: "Last 7 days", getRange: () => ({ from: new Date(Date.now() - 7 * 86400000), to: new Date() }) },
  { id: "30d", label: "Last 30 days", getRange: () => ({ from: new Date(Date.now() - 30 * 86400000), to: new Date() }) },
  { id: "60d", label: "Last 60 days", getRange: () => ({ from: new Date(Date.now() - 60 * 86400000), to: new Date() }) },
  { id: "90d", label: "Last 90 days", getRange: () => ({ from: new Date(Date.now() - 90 * 86400000), to: new Date() }) },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="stat-card">
      <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: 21, fontWeight: 800, color: "var(--ink)", lineHeight: 1 }}>{value}</span>
        {sub && <span style={{ fontSize: 9, color: "var(--muted)" }}>{sub}</span>}
      </div>
    </div>
  );
}

function FunnelChart({ data }: { data: AnalyticsData["funnelDaily"] }) {
  const maxVal = Math.max(1, ...data.map((d) => d.raw));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 150 }}>
        {data.map((d) => {
          const rawH = (d.raw / maxVal) * 100;
          const passedH = (d.passed / maxVal) * 100;
          return (
            <div key={d.date} style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", position: "relative" }} title={`${d.date}: ${d.raw} raw, ${d.passed} passed`}>
              <div style={{ width: "100%", height: `${rawH}%`, background: "#E4E7FB", borderRadius: "2px 2px 0 0", position: "relative" }}>
                <div style={{ width: "100%", height: maxVal ? `${(d.passed / Math.max(d.raw, 1)) * 100}%` : 0, background: "#4F5FD1", position: "absolute", bottom: 0, borderRadius: "2px 2px 0 0" }} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--muted)", marginTop: 4 }}>
        {data.length > 0 && <><span>{fmtDate(data[0].date)}</span><span>{fmtDate(data[data.length - 1].date)}</span></>}
      </div>
    </div>
  );
}

function VolumeChart({ data }: { data: Record<string, number | string>[] }) {
  const w = 700, h = 150;
  const maxVal = Math.max(1, ...data.flatMap((d) => Object.keys(SOURCE_META).map((k) => Number(d[k] || 0))));
  const x = (i: number) => (data.length > 1 ? (i / (data.length - 1)) * w : 0);
  const y = (v: number) => h - (v / maxVal) * h;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 150 }} preserveAspectRatio="none">
      <line x1={0} y1={0} x2={w} y2={0} stroke="#E1E4EC" strokeDasharray="4,4" />
      <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke="#E1E4EC" strokeDasharray="4,4" />
      <line x1={0} y1={h - 1} x2={w} y2={h - 1} stroke="#E1E4EC" strokeDasharray="4,4" />
      {Object.entries(SOURCE_META).map(([key, meta]) => {
        const points = data.map((d, i) => `${x(i)},${y(Number(d[key] || 0))}`).join(" ");
        return <polyline key={key} points={points} fill="none" stroke={meta.color} strokeWidth={1.5} />;
      })}
    </svg>
  );
}

function TypeBar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span className="mono" style={{ fontSize: 10.5, width: 82, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 12, background: "#F0F1F5", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${(count / max) * 100}%`, background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 10.5, fontWeight: 700, width: 28, textAlign: "right", flexShrink: 0 }}>{count}</span>
    </div>
  );
}

export default function AnalyticsClient() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string | null>("60d");
  const [range, setRange] = useState<DateRangeValue | null>(PRESETS[2].getRange());
  const [monitorsOpen, setMonitorsOpen] = useState(true);
  const [actorsOpen, setActorsOpen] = useState(false);

  useEffect(() => {
    const qs = range ? `?from=${range.from.toISOString().slice(0, 10)}&to=${range.to.toISOString().slice(0, 10)}` : "";
    fetch(`/api/analytics${qs}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(String(e)));
  }, [range?.from?.getTime(), range?.to?.getTime()]);

  function handleApply(r: DateRangeValue | null, id: string | null) {
    setRange(r ?? PRESETS[2].getRange());
    setPresetId(id);
  }

  const typeColors = ["#4F5FD1", "#0F8FA8", "#9B5FE0", "#D6478E", "#3F8F5C", "#C05A2C", "#A8720A"];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 24px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>Exa Analytics</div>
          <div className="disclaimer">Real data — live from signal_monitoring.raw_signals.</div>
        </div>
        <DateRangePicker presets={PRESETS} presetId={presetId} range={range} onApply={handleApply} />
      </div>

      {error && <div className="cb-aside">Error loading analytics: {error}</div>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 16 }}>
            <StatCard label="RAW SIGNALS" value={data.stats.total} />
            <StatCard label="PASSED ICP" value={data.stats.passed} sub={data.stats.total ? `${((data.stats.passed / data.stats.total) * 100).toFixed(1)}%` : undefined} />
            <StatCard label="FILTERED OUT" value={data.stats.filteredOut} sub={data.stats.total ? `${((data.stats.filteredOut / data.stats.total) * 100).toFixed(1)}%` : undefined} />
            <StatCard label="PENDING REVIEW" value={data.stats.pending} sub={data.stats.total ? `${((data.stats.pending / data.stats.total) * 100).toFixed(1)}%` : undefined} />
            <StatCard label="NEWEST SIGNAL" value={data.stats.newestSignal ? fmtDate(data.stats.newestSignal) : "—"} />
          </div>

          <div className="icp-card" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>
              Daily Signal Quality — Exa, raw vs. passed ICP
            </div>
            <FunnelChart data={data.funnelDaily} />
            <div className="disclaimer" style={{ marginTop: 6 }}>
              By pub_date, source=exa. Dark segment = passed ICP, light = filtered/pending.
            </div>
          </div>

          <div className="icp-card" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>Signal Volume by Source</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
              {Object.entries(SOURCE_META).map(([key, meta]) => (
                <span key={key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.color, display: "inline-block" }} />
                  {meta.label}
                </span>
              ))}
            </div>
            <VolumeChart data={data.volumeDaily} />
          </div>

          <div className="icp-grid-2" style={{ marginBottom: 16 }}>
            <div className="icp-card">
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>By Signal Type</div>
              {data.byType.map((t, i) => (
                <TypeBar key={t.type} label={t.type} count={t.count} max={data.byType[0]?.count || 1} color={typeColors[i % typeColors.length]} />
              ))}
            </div>
            <div className="icp-card">
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>By Country</div>
              {data.byCountry.map((c, i) => (
                <TypeBar key={c.country} label={c.country} count={c.count} max={data.byCountry[0]?.count || 1} color={typeColors[i % typeColors.length]} />
              ))}
              <div className="disclaimer" style={{ marginTop: 6 }}>EU-scoped monitors have country=null by design — shown as (EU-wide), not a data gap.</div>
            </div>
          </div>

          <div className="icp-card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setMonitorsOpen((o) => !o)}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink)" }}>
                Monitor Performance <span style={{ fontWeight: 400, color: "var(--muted)" }}>— Exa only</span>
              </div>
              <span style={{ fontSize: 10, color: "var(--muted)" }}>{monitorsOpen ? "▾" : "▸"} {data.monitors.length} monitors</span>
            </div>
            {monitorsOpen && (
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "4px 8px", fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>Monitor</th>
                    <th style={{ textAlign: "left", padding: "4px 8px", fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>Country</th>
                    <th style={{ textAlign: "right", padding: "4px 8px", fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>Results</th>
                    <th style={{ textAlign: "right", padding: "4px 8px", fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>Passed ICP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monitors.map((m) => (
                    <tr key={m.label} style={{ borderBottom: "1px solid #F4F4F5" }}>
                      <td className="mono" style={{ padding: "6px 8px", fontSize: 10.5 }}>{m.label}</td>
                      <td style={{ padding: "6px 8px", fontSize: 11 }}>{m.country ?? "—"}</td>
                      <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right" }}>{m.results}</td>
                      <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right" }}>{m.passed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="icp-card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setActorsOpen((o) => !o)}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink)" }}>
                Job Board Actors <span style={{ fontWeight: 400, color: "var(--muted)" }}>— Apify only</span>
              </div>
              <span style={{ fontSize: 10, color: "var(--muted)" }}>{actorsOpen ? "▾" : "▸"} {data.actors.length} actors</span>
            </div>
            {actorsOpen && (
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "4px 8px", fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>Actor</th>
                    <th style={{ textAlign: "right", padding: "4px 8px", fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>Results</th>
                    <th style={{ textAlign: "right", padding: "4px 8px", fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>Passed ICP</th>
                    <th style={{ textAlign: "right", padding: "4px 8px", fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>Last scraped</th>
                  </tr>
                </thead>
                <tbody>
                  {data.actors.map((a) => (
                    <tr key={a.source} style={{ borderBottom: "1px solid #F4F4F5" }}>
                      <td className="mono" style={{ padding: "6px 8px", fontSize: 10.5, textTransform: "capitalize" }}>{a.source}</td>
                      <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right" }}>{a.results}</td>
                      <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right" }}>{a.passed}</td>
                      <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right" }}>{a.lastScraped ? a.lastScraped.slice(0, 10) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
