"use client";
import { useState, useEffect } from "react";
import {
  ComposedChart, Bar, Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import DateRangePicker, { type DateRangeValue, type DateRangePreset } from "@/components/DateRangePicker";

// Real Exa/pipeline analytics client (Stage 8, reworked in the Stage 9 Chrome
// pass). Loaded via next/dynamic (app/analytics/page.tsx) so this — and its
// chart rendering — never enters the initial Leads-page bundle (§2.6,
// docs/PLAN_2026-07-19_react_migration_prep.md).
//
// Charts now use recharts (same library outreach-cockpit's own analytics run
// on — src/components/overview/ComboChart.tsx, src/features/reply-agent/
// DetailedAnalytics.tsx) with the same interactive-legend pattern cockpit
// uses: a row of clickable swatches above the chart toggling a useState
// boolean per series, animation is recharts' own default mount animation,
// no hand-rolled keyframes. Ported the pattern, not literal files — cockpit's
// chart components are plain hex-literal Tailwind/inline-style JSX with no
// Tailwind-v4-only syntax, so this was a clean, non-fragile port (unlike its
// calendar.tsx — see app-shell.css's comment on that).

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

function LegendSwatch({ color, label, active, onClick, round }: { color: string; label: string; active: boolean; onClick: () => void; round?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 600, background: "none", border: "none",
        cursor: "pointer", padding: "3px 6px", borderRadius: 5, opacity: active ? 1 : 0.4,
        color: active ? "var(--ink)" : "var(--muted)",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: round ? "50%" : 2, background: color, display: "inline-block", flexShrink: 0 }} />
      {label}
    </button>
  );
}

function FunnelTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const raw = payload.find((p: any) => p.dataKey === "filteredOnly")?.payload;
  if (!raw) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #E1E4EC", borderRadius: 8, padding: "8px 10px", fontSize: 11, boxShadow: "0 4px 14px rgba(30,34,51,.1)" }}>
      <div style={{ fontWeight: 700, marginBottom: 3 }}>{fmtDate(label)}</div>
      <div style={{ color: "#4F5FD1" }}>Passed ICP: <b>{raw.passed}</b></div>
      <div style={{ color: "#B4B9C8" }}>Filtered/pending: <b>{raw.raw - raw.passed}</b></div>
    </div>
  );
}

function FunnelChart({ data }: { data: AnalyticsData["funnelDaily"] }) {
  const [showPassed, setShowPassed] = useState(true);
  const [showFiltered, setShowFiltered] = useState(true);
  const chartData = data.map((d) => ({ ...d, filteredOnly: d.raw - d.passed }));
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        <LegendSwatch color="#4F5FD1" label="Passed ICP" active={showPassed} onClick={() => setShowPassed((v) => !v)} />
        <LegendSwatch color="#E4E7FB" label="Filtered / pending" active={showFiltered} onClick={() => setShowFiltered((v) => !v)} />
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barCategoryGap={1}>
          <CartesianGrid vertical={false} stroke="#E1E4EC" strokeDasharray="4 4" />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 9, fill: "#8B92A6" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis hide />
          <Tooltip content={<FunnelTooltip />} cursor={{ fill: "#F7F8FC" }} />
          <Bar dataKey="passed" stackId="s" fill="#4F5FD1" radius={[0, 0, 0, 0]} isAnimationActive hide={!showPassed} />
          <Bar dataKey="filteredOnly" stackId="s" fill="#E4E7FB" radius={[2, 2, 0, 0]} isAnimationActive hide={!showFiltered} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function VolumeChart({ data }: { data: Record<string, number | string>[] }) {
  const [visible, setVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(Object.keys(SOURCE_META).map((k) => [k, true]))
  );
  return (
    <div>
      <div style={{ display: "flex", gap: 2, flexWrap: "wrap", marginBottom: 8 }}>
        {Object.entries(SOURCE_META).map(([key, meta]) => (
          <LegendSwatch key={key} color={meta.color} label={meta.label} round active={visible[key]} onClick={() => setVisible((v) => ({ ...v, [key]: !v[key] }))} />
        ))}
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#E1E4EC" strokeDasharray="4 4" />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 9, fill: "#8B92A6" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis hide />
          <Tooltip
            labelFormatter={(l) => fmtDate(String(l))}
            contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E1E4EC" }}
          />
          {Object.entries(SOURCE_META).map(([key, meta]) =>
            visible[key] ? (
              <Line key={key} type="monotone" dataKey={key} name={meta.label} stroke={meta.color} strokeWidth={1.5} dot={false} isAnimationActive />
            ) : null
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
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
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>Analytics</div>
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
              Daily Signal Quality (Exa)
            </div>
            <FunnelChart data={data.funnelDaily} />
          </div>

          <div className="icp-card" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>Signal Volume by Source</div>
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
