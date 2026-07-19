"use client";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Adapted from outreach-cockpit's src/shared/ui/DateRangePicker.tsx (Stage 5,
// docs/PLAN_2026-07-19_react_migration_prep.md §2.5 — reuse, don't rebuild the
// mockup's own hand-rolled date math). Two real incompatibilities found while
// porting, both fixed here rather than silently copied:
//   1. cockpit's popover.tsx depends on @base-ui/react, a different/newer
//      primitives library we don't have — this project's popover.tsx (see
//      components/ui/popover.tsx) is a standard classic-Radix rebuild instead.
//   2. cockpit's <PopoverTrigger render={<Button/>}> is Base UI's render-prop
//      API — classic Radix uses `asChild` + a Slot child instead, used below.
// Trigger styled with this app's own .dr-trigger/.dr-menu classes (ported from
// mockups/signals_v2_concept.html's Activity date picker) instead of shadcn
// Button, to match this app's design system rather than cockpit's Tailwind one.

export interface DateRangeValue { from: Date; to: Date; }

export interface DateRangePreset {
  id: string;
  label: string;
  group?: string;
  getRange: () => DateRangeValue | null;
}

interface Props {
  presets: DateRangePreset[];
  presetId: string | null;
  range: DateRangeValue | null;
  onApply: (range: DateRangeValue | null, presetId: string | null) => void;
}

function defaultLabel(range: DateRangeValue | null, presetId: string | null, presets: DateRangePreset[]): string {
  const preset = presets.find((p) => p.id === presetId);
  if (preset) return preset.label;
  if (range) {
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
    return `${fmt(range.from)} – ${fmt(range.to)}`;
  }
  return "All time";
}

export default function DateRangePicker({ presets, presetId, range, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [pendingPresetId, setPendingPresetId] = useState<string | null>(presetId);
  const [pendingRange, setPendingRange] = useState<DateRangeValue | null>(range);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) { setPendingPresetId(presetId); setPendingRange(range); }
  }

  function pickPreset(preset: DateRangePreset) {
    setPendingPresetId(preset.id);
    setPendingRange(preset.getRange());
  }

  function pickCalendarRange(next: DateRange | undefined) {
    setPendingPresetId(null);
    setPendingRange(next?.from ? { from: next.from, to: next.to ?? next.from } : null);
  }

  function apply() {
    onApply(pendingRange, pendingPresetId);
    setOpen(false);
  }

  const groups = Array.from(new Set(presets.map((p) => p.group).filter((g): g is string => !!g)));
  const ungrouped = presets.filter((p) => !p.group);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button className="dr-trigger">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" />
          </svg>
          <span>{defaultLabel(range, presetId, presets)}</span>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div style={{ display: "flex" }}>
          <div style={{ width: 150, flexShrink: 0, borderRight: "1px solid var(--border, #E1E4EC)", padding: 6 }}>
            {ungrouped.map((p) => (
              <PresetRow key={p.id} preset={p} active={p.id === pendingPresetId} onClick={() => pickPreset(p)} />
            ))}
            {groups.map((group) => (
              <div key={group}>
                <div style={{ padding: "8px 10px 2px", fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: "#8B92A6" }}>
                  {group}
                </div>
                {presets.filter((p) => p.group === group).map((p) => (
                  <PresetRow key={p.id} preset={p} active={p.id === pendingPresetId} onClick={() => pickPreset(p)} />
                ))}
              </div>
            ))}
          </div>
          <Calendar
            mode="range"
            numberOfMonths={1}
            captionLayout="dropdown"
            selected={pendingRange ? { from: pendingRange.from, to: pendingRange.to } : undefined}
            onSelect={pickCalendarRange}
            defaultMonth={pendingRange?.from ?? new Date()}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14, borderTop: "1px solid var(--border, #E1E4EC)", padding: "10px 14px" }}>
          <button onClick={() => setOpen(false)} style={{ fontSize: 11, fontWeight: 700, color: "#4F5FD1", background: "none", border: "none", cursor: "pointer" }}>Cancel</button>
          <button onClick={apply} className="btn btn-copy" style={{ padding: "5px 14px" }}>Apply</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PresetRow({ preset, active, onClick }: { preset: DateRangePreset; active: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`dr-menu-item ${active ? "active" : ""}`}
      style={{ margin: "2px 0" }}
    >
      {preset.label}
    </div>
  );
}
