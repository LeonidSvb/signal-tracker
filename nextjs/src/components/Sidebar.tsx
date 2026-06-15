"use client";
import type { Lead, AppState } from "@/lib/types";

const STATUS_DOT: Record<string, string> = {
  new: "bg-slate-300",
  sent: "bg-blue-500",
  replied: "bg-purple-600",
  meeting: "bg-green-600",
  pass: "bg-red-600",
};

const SCORE_COLOR = (s: number) =>
  s >= 8 ? "text-red-500 font-bold" :
  s >= 6 ? "text-orange-500 font-bold" :
  s >= 4 ? "text-blue-500 font-semibold" : "text-slate-400";

const FILTERS = ["all", "new", "active", "done"] as const;

interface Props {
  leads: Lead[];
  states: Record<string, AppState>;
  selectedId: string | null;
  activeFilter: string;
  onSelect: (id: string) => void;
  onFilter: (f: string) => void;
}

export default function Sidebar({ leads, states, selectedId, activeFilter, onSelect, onFilter }: Props) {
  const filtered = leads.filter((l) => {
    const status = states[l.id]?.status ?? "new";
    if (activeFilter === "all") return true;
    if (activeFilter === "new") return status === "new";
    if (activeFilter === "active") return status === "sent" || status === "replied";
    if (activeFilter === "done") return status === "meeting" || status === "pass";
    return true;
  });

  return (
    <div className="w-[272px] border-r border-slate-200 bg-white flex flex-col shrink-0 overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-slate-200 flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => onFilter(f)}
            className={`px-2.5 py-1 rounded-full text-[12px] font-medium border transition-all capitalize ${
              activeFilter === f
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="overflow-y-auto flex-1">
        {filtered.map((lead) => {
          const status = states[lead.id]?.status ?? "new";
          const src = lead.signal_source;
          return (
            <div
              key={lead.id}
              onClick={() => onSelect(lead.id)}
              className={`px-3.5 py-2.5 border-b border-slate-100 cursor-pointer transition-colors ${
                selectedId === lead.id
                  ? "bg-blue-50 border-l-[3px] border-l-blue-500"
                  : "hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[14px] font-semibold truncate pr-2">{lead.company_name}</span>
                <span className={`text-[14px] shrink-0 ${SCORE_COLOR(lead.score ?? 0)}`}>
                  {lead.score ?? "—"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                {src && (
                  <span className="bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-px text-[10px] font-bold uppercase">
                    {src}
                  </span>
                )}
                <span>
                  {lead.signal_country} · {lead.signal_days_ago != null ? `${lead.signal_days_ago}d` : ""}
                </span>
                <span
                  className={`w-2 h-2 rounded-full ml-auto shrink-0 ${STATUS_DOT[status] ?? "bg-slate-300"}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
