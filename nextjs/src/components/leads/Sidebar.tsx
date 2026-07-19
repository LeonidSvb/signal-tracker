"use client";
import { useState, useMemo } from "react";
import type { CompanyListItem, ContactStatus, Tier } from "@/lib/types";
import { avatarColor, initials, formatEmployees } from "./helpers";
import { filterCompanies } from "@/lib/filters";

const STATUS_LABELS: Record<ContactStatus, string> = { new: "New", sent: "Sent", replied: "Replied", meeting: "Meeting", pass: "Pass" };
const STATUS_COLORS: Record<ContactStatus, string> = { new: "var(--muted-2)", sent: "var(--accent)", replied: "#7C3AED", meeting: "var(--pos)", pass: "var(--neg)" };
const TIER_DOT_COLOR: Record<string, string> = { T1: "var(--accent)", T2: "var(--accent-text)", T3: "var(--neutral-text)" };

interface Props {
  companies: CompanyListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  totalTiered: number;
  totalCompanies: number;
  sendableStats: { sendable: number; checked: number } | null;
}

export default function Sidebar({ companies, selectedId, onSelect, totalTiered, totalCompanies, sendableStats }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ContactStatus | "all">("all");
  const [statusNavOpen, setStatusNavOpen] = useState(false);
  const [tierFilters, setTierFilters] = useState<Set<Tier>>(new Set<Tier>(["T1", "T2", "T3"]));
  const [channelFilters, setChannelFilters] = useState<Set<"both" | "linkedin_only">>(new Set<"both" | "linkedin_only">(["both", "linkedin_only"]));
  const [originFilters, setOriginFilters] = useState<Set<"exa" | "job_board">>(new Set<"exa" | "job_board">(["exa", "job_board"]));
  const [accOpen, setAccOpen] = useState({ tier: false, channel: false, origin: false });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: companies.length };
    for (const key of Object.keys(STATUS_LABELS)) c[key] = companies.filter((co) => co.status === key).length;
    return c;
  }, [companies]);

  const tierCounts = useMemo(() => {
    const c: Record<string, number> = { T1: 0, T2: 0, T3: 0 };
    for (const co of companies) if (co.tier) c[co.tier]++;
    return c;
  }, [companies]);

  const originCounts = useMemo(() => {
    const c = { exa: 0, job_board: 0 };
    for (const co of companies) {
      if (co.origin === "exa" || co.origin === "both") c.exa++;
      if (co.origin === "job_board" || co.origin === "both") c.job_board++;
    }
    return c;
  }, [companies]);

  const channelCounts = useMemo(() => {
    const c = { both: 0, linkedin_only: 0 };
    for (const co of companies) (co.hasLinkedinOnly ? c.linkedin_only++ : c.both++);
    return c;
  }, [companies]);

  const filtered = filterCompanies(companies, { statusFilter, tierFilters, channelFilters, originFilters, search });

  function toggleSet<T>(set: Set<T>, setter: (s: Set<T>) => void, val: T) {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    if (next.size) setter(next);
  }

  function toggleAcc(name: "tier" | "channel" | "origin") {
    setAccOpen((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  const currentStatusItem = statusFilter === "all" ? null : { label: STATUS_LABELS[statusFilter], color: STATUS_COLORS[statusFilter] };

  return (
    <div className="sidebar">
      <div className="sb-header">
        <div className="sb-title">Leads</div>
        <div className="sb-subtitle">Philippe Bosquillon · Food Executive Search</div>
      </div>

      <div className="stat-strip">
        <span className="stat-item">
          <b>{totalTiered}</b> tiered
          <span className="tip-box">Companies with a tier assigned by rank_leads.mjs (T1+T2+T3) — out of {totalCompanies} total companies with any signal.</span>
        </span>
        {sendableStats && (
          <>
            <span className="stat-sep">·</span>
            <span className="stat-item">
              <b>{sendableStats.sendable}</b>/{sendableStats.checked} sendable
              <span className="tip-box">Contacts with an email whose latest validation verdict came back sendable.</span>
            </span>
          </>
        )}
      </div>

      <div className="search-wrap">
        <input className="search-input" placeholder="Search company name…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="status-nav">
        <button className="status-nav-head" onClick={() => setStatusNavOpen((o) => !o)}>
          <span className="status-nav-head-label">
            {currentStatusItem && <span className="nav-dot" style={{ background: currentStatusItem.color }} />}
            {currentStatusItem?.label ?? "All leads"}
          </span>
          <span className="cnt" style={{ marginLeft: "auto" }}>{counts[statusFilter]}</span>
          <span className={`acc-chev ${statusNavOpen ? "open" : ""}`}>▸</span>
        </button>
        {statusNavOpen && (
          <div className="status-nav-body open">
            <button className={`nav-item ${statusFilter === "all" ? "on" : ""}`} onClick={() => { setStatusFilter("all"); setStatusNavOpen(false); }}>
              All leads<span className="cnt">{counts.all}</span>
            </button>
            {(Object.keys(STATUS_LABELS) as ContactStatus[]).map((key) => (
              <button key={key} className={`nav-item ${statusFilter === key ? "on" : ""}`} onClick={() => { setStatusFilter(key); setStatusNavOpen(false); }}>
                <span className="nav-dot" style={{ background: STATUS_COLORS[key] }} />
                {STATUS_LABELS[key]}<span className="cnt">{counts[key]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="accordion">
        <button className="acc-head" onClick={() => toggleAcc("tier")}>
          <span className="acc-head-label">Tier</span>
          <span className="tier-mini">
            {(["T1", "T2", "T3"] as const).map((t) => (
              <span key={t}><span className="dot" style={{ background: TIER_DOT_COLOR[t] }} />{tierCounts[t]}</span>
            ))}
          </span>
          <span className={`acc-chev ${accOpen.tier ? "open" : ""}`}>▸</span>
        </button>
        {accOpen.tier && (
          <div className="acc-body open">
            {(["T1", "T2", "T3"] as const).map((t) => (
              <label key={t} className="acc-row">
                <input type="checkbox" checked={tierFilters.has(t)} onChange={() => toggleSet(tierFilters, setTierFilters, t)} />
                <span className="lbl">{t}</span><span className="cnt">{tierCounts[t]}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="accordion">
        <button className="acc-head" onClick={() => toggleAcc("channel")}>
          <span className="acc-head-label">Channel readiness</span>
          <span className={`acc-chev ${accOpen.channel ? "open" : ""}`}>▸</span>
        </button>
        {accOpen.channel && (
          <div className="acc-body open">
            <label className="acc-row">
              <input type="checkbox" checked={channelFilters.has("both")} onChange={() => toggleSet(channelFilters, setChannelFilters, "both")} />
              <span className="lbl">Has email + LinkedIn</span><span className="cnt">{channelCounts.both}</span>
            </label>
            <label className="acc-row">
              <input type="checkbox" checked={channelFilters.has("linkedin_only")} onChange={() => toggleSet(channelFilters, setChannelFilters, "linkedin_only")} />
              <span className="lbl">LinkedIn only — no email</span><span className="cnt">{channelCounts.linkedin_only}</span>
            </label>
          </div>
        )}
      </div>

      <div className="accordion">
        <button className="acc-head" onClick={() => toggleAcc("origin")}>
          <span className="acc-head-label">Signal origin</span>
          <span className="tip">
            <svg className="info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            <span className="tip-box">Exa (news monitors) and job boards mostly don't overlap — two largely separate populations, not duplicates.</span>
          </span>
          <span className={`acc-chev ${accOpen.origin ? "open" : ""}`}>▸</span>
        </button>
        {accOpen.origin && (
          <div className="acc-body open">
            <label className="acc-row">
              <input type="checkbox" checked={originFilters.has("exa")} onChange={() => toggleSet(originFilters, setOriginFilters, "exa")} />
              <span className="lbl">Exa (news monitors)</span><span className="cnt">{originCounts.exa}</span>
            </label>
            <label className="acc-row">
              <input type="checkbox" checked={originFilters.has("job_board")} onChange={() => toggleSet(originFilters, setOriginFilters, "job_board")} />
              <span className="lbl">Job boards</span><span className="cnt">{originCounts.job_board}</span>
            </label>
          </div>
        )}
      </div>

      <div className="list-scroll">
        <div className="list-note">{filtered.length} companies</div>
        <div>
          {filtered.map((c) => {
            const isActive = c.id === selectedId;
            const meta = [c.hq_country, formatEmployees(c.employees), `${c.sourceCount} src`].filter(Boolean).join(" · ");
            return (
              <div key={c.id} className={`row ${isActive ? "active" : ""}`} onClick={() => onSelect(c.id)}>
                <div className="row-avatar" style={{ background: avatarColor(c.name) }}>{initials(c.name)}</div>
                <div className="row-body">
                  <div className="row-top"><span className="row-name">{c.name}</span></div>
                  <div className="row-meta">{meta}</div>
                  <div className="row-tags">
                    {c.tier && <span className={`chip chip-${c.tier}`}>{c.tier}</span>}
                    <span className="chip chip-status tip">
                      {STATUS_LABELS[c.status]}
                      <span className="tip-box">Most advanced status across {c.contactCount} contacts (pass only shown if every contact passed).</span>
                    </span>
                    {c.hasLinkedinOnly ? (
                      <span className="chip chip-channel warn">LinkedIn only</span>
                    ) : (
                      <span className="chip chip-channel">{c.withEmailCount}/{c.contactCount} email</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
