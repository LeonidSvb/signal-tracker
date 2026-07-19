"use client";
import dynamic from "next/dynamic";
import "../app-shell.css";
import Rail from "@/components/Rail";

// Charts loaded via next/dynamic (§2.6, docs/PLAN_2026-07-19_react_migration_prep.md)
// so the Analytics module — SVG chart rendering, the date-range picker's calendar
// dependency — never enters the initial Leads-page bundle.
const AnalyticsClient = dynamic(() => import("@/components/analytics/AnalyticsClient"), {
  ssr: false,
  loading: () => <div style={{ padding: 40, color: "var(--muted)" }}>Loading analytics…</div>,
});

export default function AnalyticsPage() {
  return (
    <div className="app-shell">
      <Rail />
      <div className="main" style={{ overflowY: "auto" }}>
        <AnalyticsClient />
      </div>
    </div>
  );
}
