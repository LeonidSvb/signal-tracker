"use client";
import { useState } from "react";
import { useActivity } from "@/hooks/useActivity";
import DateRangePicker, { type DateRangeValue, type DateRangePreset } from "@/components/DateRangePicker";

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued for LinkedIn",
  exported: "Exported to LinkedIn queue",
  done: "Done",
  skipped: "Skipped",
  validated: "Validated, about to be pushed",
  pushed: "Pushed to PlusVibe campaign",
  skipped_no_campaign: "Skipped — no PlusVibe campaign configured yet",
  skipped_validation: "Skipped — email validation pending or failed",
  skipped_no_email: "Skipped — no email on file",
};

const PRESETS: DateRangePreset[] = [
  { id: "all", label: "All time", getRange: () => null },
  { id: "today", label: "Today", getRange: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return { from: d, to: new Date() }; } },
  { id: "7d", label: "Last 7 days", getRange: () => ({ from: new Date(Date.now() - 7 * 86400000), to: new Date() }) },
  { id: "30d", label: "Last 30 days", getRange: () => ({ from: new Date(Date.now() - 30 * 86400000), to: new Date() }) },
  { id: "90d", label: "Last 90 days", getRange: () => ({ from: new Date(Date.now() - 90 * 86400000), to: new Date() }) },
];

export default function ActivityTab({ clientId }: { clientId: string }) {
  const [presetId, setPresetId] = useState<string | null>("all");
  const [range, setRange] = useState<DateRangeValue | null>(null);
  const [channelSeg, setChannelSeg] = useState<"all" | "linkedin" | "email">("all");
  const [search, setSearch] = useState("");
  const { rows } = useActivity(clientId, range);

  function handleApply(r: DateRangeValue | null, id: string | null) {
    setRange(r);
    setPresetId(id);
  }

  const filtered = rows.filter((r) =>
    (channelSeg === "all" || r.channel === channelSeg) &&
    (!search || r.company_name.toLowerCase().includes(search.toLowerCase()) || r.contact_name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="activity-wrap">
      <div className="activity-toolbar">
        <div>
          <div className="activity-title">Outreach activity</div>
          <div className="activity-sub">Every write to <code>channel_actions</code> — live</div>
        </div>
        <DateRangePicker presets={PRESETS} presetId={presetId} range={range} onApply={handleApply} />
        <div className="seg">
          {(["all", "linkedin", "email"] as const).map((k) => (
            <button key={k} className={`seg-btn ${channelSeg === k ? "on" : ""}`} onClick={() => setChannelSeg(k)}>
              {k === "all" ? "All" : k === "linkedin" ? "LinkedIn" : "Email"}
            </button>
          ))}
        </div>
        <input className="activity-search" placeholder="Search company or contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="activity-table-wrap">
        <table className="act">
          <thead>
            <tr>
              <th style={{ width: 20 }} />
              <th style={{ width: 130 }}>Date</th>
              <th>Company</th>
              <th>Contact</th>
              <th style={{ width: 90 }}>Channel</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td><span className={`act-dot ${r.status}`} /></td>
                <td className="act-status-text">{r.created_at.slice(0, 16).replace("T", " ")}</td>
                <td>{r.company_tier && <span className={`chip chip-${r.company_tier}`} style={{ marginRight: 6 }}>{r.company_tier}</span>}{r.company_name}</td>
                <td>{r.contact_name}</td>
                <td><span className={`act-channel-pill ${r.channel}`}>{r.channel}</span></td>
                <td className="act-status-text">{STATUS_LABEL[r.status] ?? r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
