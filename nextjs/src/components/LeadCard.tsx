"use client";
import { useState } from "react";
import type { Lead, AppState, Note } from "@/lib/types";
import ContactCard from "./ContactCard";
import NotesLog from "./NotesLog";

const STATUS_CONFIG = [
  { key: "new",     label: "New",     color: "bg-slate-500 border-slate-500" },
  { key: "sent",    label: "Sent",    color: "bg-blue-600 border-blue-600" },
  { key: "replied", label: "Replied", color: "bg-purple-700 border-purple-700" },
  { key: "meeting", label: "Meeting", color: "bg-green-700 border-green-700" },
  { key: "pass",    label: "Pass",    color: "bg-red-600 border-red-600" },
] as const;

const SCORE_COLOR = (s: number) =>
  s >= 8 ? "#ef4444" : s >= 6 ? "#f97316" : s >= 4 ? "#3b82f6" : "#9ca3af";

interface Props {
  lead: Lead;
  state: AppState | undefined;
  notes: Note[];
  clientId: string;
  currentUser: "leo" | "philippe";
  onStatusChange: (leadId: string, status: string, author?: string) => Promise<void>;
  onAddNote: (leadId: string, clientId: string, author: "leo" | "philippe", body: string) => Promise<void>;
}

export default function LeadCard({ lead, state, notes, clientId, currentUser, onStatusChange, onAddNote }: Props) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const status = state?.status ?? "new";
  const score = lead.score ?? 0;
  const contacts = (lead.contacts as any[]) ?? [];
  const allSignals = (lead.all_signals as any[]) ?? [];

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden max-w-[820px]">
      {/* Company Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
        <div>
          <div className="text-[22px] font-bold mb-1">{lead.company_name}</div>
          <div className="text-[13px] text-slate-400 flex gap-2 items-center flex-wrap">
            {lead.company_industry && <span>{lead.company_industry}</span>}
            {lead.company_employees ? <><Dot /><span>{lead.company_employees.toLocaleString()} emp.</span></> : null}
            {lead.company_hq_country ? <><Dot /><span>{lead.company_hq_country}</span></> : null}
            {lead.company_domain ? <><Dot /><a href={`https://${lead.company_domain}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-[12px]">{lead.company_domain} ↗</a></> : null}
            {lead.company_linkedin_url ? <><Dot /><a href={lead.company_linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-[12px]">LinkedIn ↗</a></> : null}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[22px] font-extrabold border-2 rounded-lg px-2.5 py-1 leading-none" style={{ color: SCORE_COLOR(score), borderColor: SCORE_COLOR(score) }}>
            {score || "—"}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">score</div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-1.5 flex-wrap">
        {STATUS_CONFIG.map((s, i) => (
          <span key={s.key} className="flex items-center gap-1.5">
            {i > 0 && (
              <span className="text-slate-300 text-[13px]">{s.key === "pass" ? "·" : "›"}</span>
            )}
            <button
              onClick={() => onStatusChange(lead.id, s.key, currentUser)}
              className={`px-3 py-1 rounded-md text-[12px] font-medium border transition-all ${
                status === s.key
                  ? `${s.color} text-white`
                  : s.key === "pass"
                  ? "bg-white text-red-600 border-red-200 hover:bg-red-50"
                  : "bg-white text-slate-400 border-slate-200 hover:opacity-80"
              }`}
            >
              {s.label}
            </button>
          </span>
        ))}
      </div>

      {/* Signal Section */}
      <div className="px-5 py-4 border-b border-slate-200">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">
          Signal{allSignals.length > 1 && (
            <span className="ml-2 bg-yellow-50 text-yellow-800 border border-yellow-300 rounded-full text-[9px] font-bold px-2 py-px uppercase tracking-wide">
              {allSignals.length} signals
            </span>
          )}
        </div>
        {allSignals.length > 0 ? (
          allSignals.map((sig: any, i: number) => (
            <div key={i} className={`flex items-center gap-1.5 mb-1.5 flex-wrap ${i > 0 ? "opacity-70" : ""}`}>
              {sig.source && (
                <span className="bg-green-50 text-green-800 border border-green-200 rounded text-[10px] font-bold uppercase px-1.5 py-px">{sig.source}</span>
              )}
              {sig.country && (
                <span className="bg-slate-100 text-slate-500 rounded text-[11px] px-1.5 py-px">{sig.country}</span>
              )}
              <span className={`font-semibold ${i === 0 ? "text-[15px]" : "text-[13px]"}`}>{sig.title}</span>
              <span className="text-[13px] text-slate-400">
                · {sig.days_ago}d
                {i === 0 && sig.url && (
                  <a href={sig.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-500 hover:underline">↗ source</a>
                )}
              </span>
            </div>
          ))
        ) : (
          lead.signal_title && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {lead.signal_source && (
                <span className="bg-green-50 text-green-800 border border-green-200 rounded text-[10px] font-bold uppercase px-1.5 py-px">{lead.signal_source}</span>
              )}
              {lead.signal_country && (
                <span className="bg-slate-100 text-slate-500 rounded text-[11px] px-1.5 py-px">{lead.signal_country}</span>
              )}
              <span className="text-[15px] font-semibold">{lead.signal_title}</span>
              <span className="text-[13px] text-slate-400">
                · {lead.signal_days_ago}d
                {lead.signal_url && (
                  <a href={lead.signal_url} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-500 hover:underline">↗ source</a>
                )}
              </span>
            </div>
          )
        )}
        {lead.signal_narrative && (
          <div className="mt-2 text-[13px] leading-relaxed text-slate-600 bg-slate-50 border-l-[3px] border-l-blue-500 px-3.5 py-2.5 rounded-r-md">
            {lead.signal_narrative}
          </div>
        )}
      </div>

      {/* Angle */}
      {lead.angle && (
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Reach-out angle</div>
          <div className="bg-amber-50 border border-amber-200 px-3.5 py-2.5 rounded-lg text-[13px] text-amber-900 leading-relaxed">
            {lead.angle}
          </div>
        </div>
      )}

      {/* Contacts */}
      {contacts.length > 0 && (
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">Contacts</div>
          <div className="grid grid-cols-2 gap-2.5">
            {contacts.slice(0, 2).map((c: any, i: number) => (
              <ContactCard key={i} contact={c} priority={i === 0 ? "primary" : "secondary"} />
            ))}
          </div>
        </div>
      )}

      {/* About (expandable) */}
      {(lead.company_about || lead.company_snapshot || lead.icp_score) && (
        <div className="px-5 py-3 border-b border-slate-200">
          <button
            onClick={() => setAboutOpen((o) => !o)}
            className="flex items-center gap-1.5 text-[12px] text-slate-400 hover:text-blue-600 select-none"
          >
            <span className={`transition-transform inline-block ${aboutOpen ? "rotate-90" : ""}`}>›</span>
            <span>About</span>
            {lead.icp_score && (
              <span className="ml-2 text-[11px] text-slate-400">
                ICP {lead.icp_score}/5 {"★".repeat(lead.icp_score)}{"☆".repeat(5 - lead.icp_score)}
              </span>
            )}
          </button>
          {aboutOpen && (
            <div className="mt-3 text-[13px] leading-relaxed text-slate-600 border-t border-slate-100 pt-2.5">
              {lead.company_snapshot || lead.company_about}
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      <div className="px-5 py-4">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">Notes</div>
        <NotesLog
          notes={notes}
          leadId={lead.id}
          clientId={clientId}
          currentUser={currentUser}
          onAdd={onAddNote}
        />
      </div>
    </div>
  );
}

function Dot() {
  return <span className="w-1 h-1 rounded-full bg-slate-300 inline-block" />;
}
