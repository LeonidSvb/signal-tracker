"use client";
import type { Lead, AppState } from "@/lib/types";

interface Props {
  total: number;
  states: Record<string, AppState>;
  onFilterChange: (f: string) => void;
}

export default function Header({ total, states, onFilterChange }: Props) {
  const values = Object.values(states);
  const newCount = total - values.filter((s) => s.status !== "new").length;
  const activeCount = values.filter((s) => s.status === "sent" || s.status === "replied").length;
  const meetingCount = values.filter((s) => s.status === "meeting").length;
  const passCount = values.filter((s) => s.status === "pass").length;

  return (
    <div className="bg-[#0f172a] text-white px-7 py-3.5 flex items-center justify-between gap-5 shrink-0">
      <div>
        <div className="text-[15px] font-semibold">Signal Leads</div>
        <div className="text-[12px] text-slate-400 mt-0.5">
          Philippe Bosquillon · Food Executive Search · {total} companies
        </div>
      </div>
      <div className="flex gap-5">
        <StatBox label="New" value={newCount} color="text-slate-400" onClick={() => onFilterChange("new")} />
        <StatBox label="Active" value={activeCount} color="text-blue-400" onClick={() => onFilterChange("active")} />
        <StatBox label="Meeting" value={meetingCount} color="text-green-400" onClick={() => onFilterChange("meeting")} />
        <StatBox label="Pass" value={passCount} color="text-red-400" onClick={() => onFilterChange("pass")} />
      </div>
    </div>
  );
}

function StatBox({ label, value, color, onClick }: { label: string; value: number; color: string; onClick: () => void }) {
  return (
    <div className="text-center cursor-pointer" onClick={onClick}>
      <div className={`text-[20px] font-bold leading-none ${color}`}>{value}</div>
      <div className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}
