"use client";
import { useState } from "react";
import { useLeads, useNotes } from "@/hooks/useLeads";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import LeadCard from "@/components/LeadCard";

const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG ?? "philippe-bosquillon";
const CURRENT_USER = "leo" as const;

export default function Home() {
  const { leads, states, loading, setStatus } = useLeads(CLIENT_SLUG);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  const selectedLead = leads.find((l) => l.id === selectedId) ?? leads[0] ?? null;
  const { notes, addNote } = useNotes(selectedLead?.id ?? null);

  const clientId = leads[0]?.client_id ?? "";

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-lg">Loading signals...</div>
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center text-white space-y-3">
          <div className="text-xl font-bold">No leads yet</div>
          <div className="text-slate-400 text-sm">Run push-to-supabase.cjs to import data</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        total={leads.length}
        states={states}
        onFilterChange={(f) => { setFilter(f); }}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          leads={leads}
          states={states}
          selectedId={selectedLead?.id ?? null}
          activeFilter={filter}
          onSelect={(id) => setSelectedId(id)}
          onFilter={setFilter}
        />
        <main className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {selectedLead ? (
            <LeadCard
              lead={selectedLead}
              state={states[selectedLead.id]}
              notes={notes}
              clientId={clientId}
              currentUser={CURRENT_USER}
              onStatusChange={setStatus}
              onAddNote={addNote}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              Select a company from the sidebar
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
