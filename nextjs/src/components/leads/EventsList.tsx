"use client";
import { useState } from "react";
import type { CompanyEvent } from "@/lib/types";
import { hostnameLabel } from "./helpers";

// Ported from mockups/signals_v2_concept.html's renderEvents()/toggleEvent() —
// events deduped by source_url server-side (rank_leads.mjs's event grouping),
// summary comes from signals.event_summary (migration 007, Stage 2) with a
// title fallback for single-source events (no LLM spend on those, by design).

function EventRow({ event }: { event: CompanyEvent }) {
  const [open, setOpen] = useState(false);
  const summary = event.summary || event.title || event.baseType;
  // Dedupe by source_url for the drill-down link list (D3 — raw signal count
  // often overcounts real distinct sources).
  const uniqueSources = Array.from(
    new Map(event.members.map((m) => [m.source_url || m.id, m])).values()
  );
  const rawCount = event.members.length;
  const dupeNote =
    rawCount > uniqueSources.length
      ? `${rawCount} raw signal rows collapsed to ${uniqueSources.length} unique source${uniqueSources.length === 1 ? "" : "s"}.`
      : null;

  return (
    <div className="event-row">
      <div className="event-head" onClick={() => setOpen((o) => !o)}>
        <span className={`event-dot ${event.status}`} />
        <span className="event-summary" title={summary}>{summary}</span>
        <span className={`event-badge ${event.status === "active" ? "badge-active" : "badge-stale"}`}>{event.status}</span>
        <span className={`event-chev ${open ? "open" : ""}`}>▸</span>
      </div>
      {open && (
        <div className="event-body">
          <div className="event-summary-full">
            {event.summary && <span className="ai-tag">AI summary</span>}
            {summary}
          </div>
          <div className="event-sources">
            {uniqueSources.map((m) =>
              m.source_url ? (
                <a key={m.id} className="src-link" href={m.source_url} target="_blank" rel="noopener noreferrer">
                  ↗ {hostnameLabel(m.source_url)} · {m.pub_date ?? "n/a"}
                </a>
              ) : (
                <span key={m.id} className="src-link">{m.title} · {m.pub_date ?? "n/a"}</span>
              )
            )}
          </div>
          {dupeNote && <div className="dupe-note">{dupeNote}</div>}
        </div>
      )}
    </div>
  );
}

export default function EventsList({ events }: { events: CompanyEvent[] }) {
  return (
    <div className="section">
      <div className="section-label">
        Signals
        <span className="tip">
          <svg className="info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          <span className="tip-box">
            Deduped by source URL, then AI-summarized into one line per real-world event — a story
            caught by multiple monitor categories still counts as 1 signal.
          </span>
        </span>
      </div>
      <div className="events-list">
        {events.map((e) => <EventRow key={e.eventKey} event={e} />)}
      </div>
    </div>
  );
}
