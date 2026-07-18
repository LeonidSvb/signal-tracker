"use client";
import { useEffect, useState } from "react";

// Minimal Health page — real data behind mockups/settings.html's Health tab markup
// (PLAN_2026-07-18_backend_hardening.md, C-D6 / Phase 1 item 7). Scoped inline CSS
// mirrors the mockup's token system (bg #EEF1F7, accent #4F5FD1) rather than the
// app's shadcn theme — this page is explicitly a small approved exception to the
// "no frontend work" rule, not the start of a redesign, so it stays self-contained.

type StageRun = {
  script: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_scraped: number;
  rows_passed_icp: number;
  rows_pushed: number;
  stats: Record<string, unknown> | null;
  errors: unknown[];
} | null;

type HealthData = {
  generatedAt: string;
  stages: { script: string; run: StageRun }[];
  validation: { totalWithEmail: number; validated: number; neverValidated: number; invalid: number };
};

function pillClass(run: StageRun) {
  if (!run) return "pill-missing";
  if (run.status === "success") return "pill-ok";
  if (run.status === "partial") return "pill-warn";
  return "pill-missing";
}

function pillLabel(run: StageRun) {
  if (!run) return "never run";
  return run.status;
}

function fmt(dt: string | null) {
  if (!dt) return "—";
  return dt.slice(0, 16).replace("T", " ") + " UTC";
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="health-page">
      <style>{`
        .health-page { background:#EEF1F7; min-height:100vh; padding:24px; font-family:-apple-system,'Lato',sans-serif; color:#2A2E3D; }
        .health-page .card { background:#fff; border:1px solid #E4E7EF; border-radius:10px; overflow:hidden; margin-bottom:20px; }
        .health-page h1 { font-size:18px; font-weight:700; margin-bottom:2px; }
        .health-page .sub { font-size:11.5px; color:#8A8FA3; margin-bottom:18px; }
        .health-page h2 { font-size:12.5px; font-weight:700; padding:14px 14px 8px; }
        .health-page table { width:100%; border-collapse:collapse; }
        .health-page th { text-align:left; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; color:#8A8FA3; padding:8px 14px; background:#FAFBFD; border-bottom:1px solid #E4E7EF; }
        .health-page td { padding:8px 14px; font-size:11.5px; border-bottom:1px solid #F4F4F5; }
        .health-page tr:last-child td { border-bottom:none; }
        .health-page .mono { font-family:ui-monospace,monospace; font-size:10.5px; }
        .health-page .muted { color:#8A8FA3; }
        .health-page .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700; }
        .pill-ok { background:#E4F5E9; color:#1E8A4C; }
        .pill-warn { background:#FDF3D8; color:#A8720A; }
        .pill-missing { background:#F1EBFB; color:#7A5FC7; }
        .health-page .err { color:#C0392B; font-size:10.5px; }
      `}</style>

      <h1>Health</h1>
      <div className="sub">
        signal_monitoring.pipeline_runs, live — {data ? `generated ${fmt(data.generatedAt)}` : "loading..."}
      </div>

      {error && <div className="err">Error: {error}</div>}

      {data && (
        <>
          <div className="card">
            <h2>Email validation coverage</h2>
            <table>
              <thead>
                <tr>
                  <th>Contacts with email</th>
                  <th>Validated</th>
                  <th>Never validated</th>
                  <th>Invalid</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{data.validation.totalWithEmail}</td>
                  <td>{data.validation.validated}</td>
                  <td className={data.validation.neverValidated > 0 ? "muted" : ""}>{data.validation.neverValidated}</td>
                  <td>{data.validation.invalid}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Pipeline stages (signal_monitoring/pipeline)</h2>
            <table>
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Last run</th>
                  <th>Status</th>
                  <th>Scraped / Passed / Pushed</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {data.stages.map(({ script, run }) => (
                  <tr key={script}>
                    <td className="mono">{script}</td>
                    <td className="muted">{run ? fmt(run.started_at) : "—"}</td>
                    <td><span className={`pill ${pillClass(run)}`}>{pillLabel(run)}</span></td>
                    <td className="muted">{run ? `${run.rows_scraped} / ${run.rows_passed_icp} / ${run.rows_pushed}` : "—"}</td>
                    <td className="err">{run?.errors?.length ? `${run.errors.length} errors` : ""}</td>
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
